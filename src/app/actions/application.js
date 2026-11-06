'use server';

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { isDuplicate, query, queryOne } from '@/lib/db';
import { encryptField } from '@/lib/fieldCrypto';
import { verifyOtp } from '@/lib/otpStore';
import { createSession } from '@/lib/session';
import { applicationReceivedEmail, sendMail } from '@/lib/mailer';
import { BRAND } from '@/lib/brand';
import { emailError, firstStepWithError, readApplication, validateAll, validateStep } from '@/lib/application';

/**
 * Client application, the five-step KYC journey (src/app/components/LiveApplicationForm.jsx, fields in src/lib/application.js):
 *   emailAvailable    → before the form asks POST /api/otp-smtp for a code: is the e-mail still free?
 *   checkApplication  → step 1 (personal information): validates it and the e-mailed code (src/lib/otpStore.js); nothing saved
 *   submitApplication → last step: every step again; uses up the code, saves the client as one row of `client_applications`
 *                       (MySQL, db/schema.sql: bcrypt password, ID number and TIN encrypted), signs the client in (session
 *                       cookie, for the Sumsub verification that follows, which collects the documents) and e-mails a
 *                       confirmation.
 *                       → { ok, email, reference } or { step (0-based), errors } / { error }
 */
const emailTaken = async (email) => Boolean(await queryOne('SELECT id FROM client_applications WHERE email = ?', [email]));

const TAKEN = 'An application with this email already exists.';
const CODE_ERRORS = {
  invalid: 'That code is not correct. Please check the email we sent you.',
  expired: 'This code has expired. Please request a new one.'
};

// e.g. "GTC-7K2M9QXA": 8 characters without look-alikes (0/O, 1/I/L), random so references don't reveal volumes
const REF_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const newReference = () => `GTC-${Array.from(randomBytes(8), (b) => REF_CHARS[b % REF_CHARS.length]).join('')}`;

export async function emailAvailable(email) {
  email = String(email ?? '').trim().toLowerCase();
  const bad = emailError(email);
  if (bad) return { error: bad };
  try {
    return (await emailTaken(email)) ? { error: TAKEN } : { ok: true };
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
    if (await emailTaken(v.email)) return { errors: { email: TAKEN } };
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

  let id;
  let reference;
  try {
    if (await emailTaken(v.email)) return { step: 0, errors: { email: TAKEN } };
    const code = await verifyOtp(v.email, v.code, { consume: true });
    if (!code.success) return { step: 0, errors: { code: CODE_ERRORS[code.reason] } };

    const now = new Date();
    const row = {
      firstName: v.firstName,
      lastName: v.lastName,
      dateOfBirth: v.dateOfBirth,
      country: v.country,
      email: v.email,
      emailVerifiedAt: now,
      passwordHash: await bcrypt.hash(v.password, 10),
      phone: v.phone,
      partnerCode: v.partnerCode || null,
      nationality: v.nationality,
      idType: v.idType,
      idLastName: v.idLastName,
      idFirstName: v.idFirstName,
      idNumberEncrypted: encryptField(v.idNumber),
      poaCountry: v.poaCountry,
      postalCode: v.postalCode,
      address: v.address,
      proofDate: v.proofDate || null,
      education: v.education,
      employment: v.employment,
      industry: v.industry,
      industryOther: v.industry === 'Other' ? v.industryOther : null,
      occupation: v.occupation,
      occupationOther: v.occupation === 'Other' ? v.occupationOther : null,
      employer: v.employer || null,
      previousEmployment: v.previousEmployment || null,
      experienceYears: v.experienceYears,
      income: v.income,
      sourceOfFunds: v.sourceOfFunds,
      investmentExperience: v.investmentExperience,
      marketExperience: v.marketExperience,
      usCitizen: v.usCitizen,
      tinEncrypted: v.tin ? encryptField(v.tin) : null,
      pep: v.pep ? 1 : 0,
      // what was signed and when (the checkbox text is the same for both, see AGREEMENT_TEXT)
      agreements: JSON.stringify(
        BRAND.agreements.map((a, i) => ({ title: a.title, url: a.url || null, accepted: Boolean(v[`agreement${i + 1}`]), acceptedAt: now.toISOString() }))
      )
    };
    const cols = Object.keys(row);
    const insert = `INSERT INTO client_applications (applicationReference, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`;

    // a clash on the random reference is very unlikely; try a new one a few times
    for (let attempt = 0; ; attempt++) {
      reference = newReference();
      try {
        ({ insertId: id } = await query(insert, [reference, ...Object.values(row)]));
        break;
      } catch (err) {
        if (isDuplicate(err) && /applicationReference|_reference/.test(err.sqlMessage ?? '') && attempt < 4) continue;
        throw err;
      }
    }
  } catch (err) {
    // two submissions with the same e-mail at once: the unique key on email lets only one through
    if (isDuplicate(err)) return { step: 0, errors: { email: TAKEN } };
    console.error('[application] submit:', err);
    return { error: 'We could not save your application. Please try again.' };
  }

  // signed in from here on: the identity verification that follows (actions/verification.js) is tied to this client
  await createSession({ id: String(id), name: `${v.firstName} ${v.lastName}` });

  // confirmation e-mail; a failure doesn't undo the application
  await sendMail({ to: v.email, ...applicationReceivedEmail({ name: v.firstName, reference }) }).catch((err) =>
    console.error(`[application] confirmation e-mail for ${reference}:`, err.message)
  );

  return { ok: true, email: v.email, reference };
}
