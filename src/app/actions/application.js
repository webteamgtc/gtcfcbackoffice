'use server';

import { headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/mongodb';
import { verifyOtp } from '@/lib/otpStore';
import { createSession } from '@/lib/session';
import { applicationReceivedEmail, sendMail } from '@/lib/mailer';
import { emailError, firstStepWithError, fullPhone, readApplication, validateAll, validateStep } from '@/lib/application';

/**
 * Client application, the five-step KYC journey (src/app/components/LiveApplicationForm.jsx, fields in src/lib/application.js):
 *   emailAvailable    → before the form asks POST /api/otp-smtp for a code: is the e-mail still free?
 *   checkApplication  → step 1 (personal information): validates it and the e-mailed code (src/lib/otpStore.js); nothing saved
 *   submitApplication → last step: every step again; uses up the code, saves the client to `user_record` (bcrypt password,
 *                       answers under `kyc`), signs the client in (session cookie, for the Sumsub verification that follows,
 *                       which collects the documents) and e-mails a confirmation.
 *                       → { ok, email, reference } or { step (0-based), errors } / { error }
 */
async function emailTaken(db, email) {
  return Boolean(await db.collection('user_record').findOne({ email }, { projection: { _id: 1 } }));
}

const TAKEN = 'An application with this email already exists.';
const CODE_ERRORS = {
  invalid: 'That code is not correct. Please check the email we sent you.',
  expired: 'This code has expired. Please request a new one.'
};

export async function emailAvailable(email) {
  email = String(email ?? '').trim().toLowerCase();
  const bad = emailError(email);
  if (bad) return { error: bad };
  try {
    return (await emailTaken(await getDb(), email)) ? { error: TAKEN } : { ok: true };
  } catch (err) {
    console.error('[application] email check:', err);
    return { error: 'Could not reach the server. Please try again.' };
  }
}

export async function checkApplication(input) {
  const v = readApplication(input);
  const errors = validateStep('personal', v);
  if (Object.keys(errors).length) return { errors };

  try {
    const db = await getDb();
    if (await emailTaken(db, v.email)) return { errors: { email: TAKEN } };
    const code = await verifyOtp(v.email, v.code);
    if (!code.success) return { errors: { code: CODE_ERRORS[code.reason] } };
    return { ok: true };
  } catch (err) {
    console.error('[application] check:', err);
    return { error: 'Could not reach the server. Please try again.' };
  }
}

export async function submitApplication(input) {
  const v = readApplication(input);
  const errors = validateAll(v);
  if (Object.keys(errors).length) return { step: firstStepWithError(errors), errors };

  let db;
  let insertedId;
  const now = new Date();
  try {
    db = await getDb();
    if (await emailTaken(db, v.email)) return { step: 0, errors: { email: TAKEN } };
    const code = await verifyOtp(v.email, v.code, { consume: true });
    if (!code.success) return { step: 0, errors: { code: CODE_ERRORS[code.reason] } };

    const h = await headers();
    ({ insertedId } = await db.collection('user_record').insertOne({
      name: `${v.firstName} ${v.lastName}`,
      firstName: v.firstName,
      lastName: v.lastName,
      email: v.email,
      emailVerified: true,
      password: await bcrypt.hash(v.password, 10),
      dateOfBirth: v.dateOfBirth,
      country: v.country,
      nationality: v.nationality,
      phone: fullPhone(v.country, v.phone),
      partnerCode: v.partnerCode,
      kyc: {
        identity: { documentType: v.idType, firstName: v.idFirstName, lastName: v.idLastName, idNumber: v.idNumber, nationality: v.nationality },
        address: { country: v.poaCountry, postalCode: v.postalCode, address: v.address, proofDate: v.proofDate || null },
        questionnaire: {
          education: v.education,
          employment: v.employment,
          industry: v.industry === 'Other' ? `Other: ${v.industryOther}` : v.industry,
          occupation: v.occupation === 'Other' ? `Other: ${v.occupationOther}` : v.occupation,
          employer: v.employer,
          previousEmployment: v.previousEmployment,
          experienceYears: v.experienceYears,
          annualIncome: v.income,
          sourceOfFunds: v.sourceOfFunds,
          investmentExperience: v.investmentExperience,
          marketExperience: v.marketExperience,
          usCitizen: v.usCitizen === 'Yes',
          tin: v.tin,
          pepDeclarationAccepted: true
        },
        agreements: { clientAgreement1: { accepted: true, acceptedAt: now }, clientAgreement2: { accepted: true, acceptedAt: now } },
        status: 'submitted',
        submittedAt: now
      },
      applicationStatus: 'submitted',
      source: 'web-application',
      ip: (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '').split(',')[0].trim(),
      userAgent: (h.get('user-agent') ?? '').slice(0, 300),
      createdAt: now
    }));
  } catch (err) {
    console.error('[application] submit:', err);
    return { error: 'We could not save your application. Please try again.' };
  }
  const userId = String(insertedId);

  // signed in from here on: the identity verification that follows (actions/verification.js) is tied to this client
  await createSession({ id: userId, name: `${v.firstName} ${v.lastName}` });

  // confirmation e-mail; a failure doesn't undo the application (confirmationEmailSent: false on the record)
  const reference = userId.slice(-8).toUpperCase();
  const sent = await sendMail({ to: v.email, ...applicationReceivedEmail({ name: v.firstName, reference }) }).then(
    () => true,
    (err) => (console.error('[application] confirmation e-mail:', err.message), false)
  );
  await db.collection('user_record').updateOne({ _id: insertedId }, { $set: { applicationReference: reference, confirmationEmailSent: sent } }).catch(() => {});

  return { ok: true, email: v.email, reference };
}
