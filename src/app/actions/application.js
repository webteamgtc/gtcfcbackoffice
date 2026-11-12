'use server';

import { randomBytes } from 'node:crypto';
import { isDuplicate, query, queryOne } from '@/lib/db';
import { encryptField } from '@/lib/fieldCrypto';
import { createSession } from '@/lib/session';
import { phoneKey, verifyOtp } from '@/lib/otpStore';
import { BRAND } from '@/lib/brand';
import { storeSignedAgreements } from '@/lib/signedAgreement';
import { FILE_FIELDS, STEPS, e164, emailError, firstStepWithError, isCorporate, needsBackSide, readApplication, showsStep, validateAll, validateStep } from '@/lib/application';


/**
 * Client application, the KYC journey (src/app/components/LiveApplicationForm.jsx, fields in src/lib/application.js).
 * Saved in MySQL (Alibaba Cloud RDS, src/lib/db.js; tables in db/schema.sql, `npm run db:migrate`):
 *   emailAvailable        → is the e-mail still free?
 *   checkContact          → "Contact details" step: the WhatsApp code correct (not used up yet), and, when the e-mail
 *                           already has an application, the e-mail code too (→ { errors, existing: true } until it is):
 *                           the client proves the e-mail is theirs and continues with that application
 *   uploadApplicationFile → stores one picked file (business license; ID photos / proof of address when those steps are
 *                           shown) in `application_files` under the form's draft id, before the client exists; picking
 *                           again replaces it. → { ok, id } / { error }
 *   submitApplication     → last step: validates every step and that the uploaded files are there, inserts one row of
 *                           `client_applications` (ID number and TIN encrypted; columns of steps Sumsub collects stay
 *                           empty; a corporate client also `company`), links the files to it, and signs the client in
 *                           (session cookie) for the Sumsub verification that follows. Uses up the WhatsApp code, so the
 *                           mobile saved is the one the client proved they own. For an e-mail that already has an
 *                           application, the e-mail code is used up too and that application is updated instead (same
 *                           id and reference, so its Sumsub verification and MAX account carry on).
 *                           → { ok, reference } or { step (0-based), errors } / { error }
 */

// kept under Vercel's 4.5MB request limit; the form shrinks large photos before sending them
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const DRAFT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STEP_INDEX = Object.fromEntries(STEPS.map((x, i) => [x.key, i]));
const TAKEN = 'An application with this email already exists.';
const CONFIRM_EMAIL = 'Send a code to this email first.'; // the form explains why (the e-mail already has an application)
const CODE_ERRORS = {
  email: { invalid: 'That code is not correct. Please check the email we sent you.', expired: 'This code has expired. Please request a new one.' },
  phone: { invalid: 'That code is not correct. Please check the WhatsApp message we sent you.', expired: 'This code has expired. Please request a new one.' }
};
const existingApplication = (email) => queryOne('SELECT id, applicationReference FROM client_applications WHERE email = ?', [email]);
const emailTaken = async (email) => Boolean(await existingApplication(email));

// e.g. "GTC-7K2M9QXA": 8 characters without look-alikes (0/O, 1/I/L), random so references don't reveal volumes
const REF_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const newReference = () => `GTC-${Array.from(randomBytes(8), (b) => REF_CHARS[b % REF_CHARS.length]).join('')}`;

/**
 * Checks the codes of the contact step against their signed tokens (src/lib/otpStore.js, no database): the WhatsApp code,
 * and the e-mail code when `existing` (the e-mail already has an application). `consume` uses them up (only on submit).
 * → field errors
 */
async function checkCodes(v, consume, existing) {
  const errors = {};
  if (existing) {
    if (!v.emailToken) errors.emailCode = CONFIRM_EMAIL;
    else if (!/^\d{6}$/.test(v.emailCode)) errors.emailCode = v.emailCode ? 'The code has 6 digits.' : 'Enter the 6-digit code we emailed you.';
    else {
      const mail = await verifyOtp(v.email, v.emailCode, v.emailToken, { consume });
      if (!mail.success) errors.emailCode = CODE_ERRORS.email[mail.reason];
    }
  }
  const phone = await verifyOtp(phoneKey(e164(v.phoneCountry, v.phone)), v.phoneCode, v.phoneToken, { consume });
  if (!phone.success) errors.phoneCode = CODE_ERRORS.phone[phone.reason];
  return errors;
}

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

export async function checkContact(input) {
  const v = readApplication(input);
  const errors = validateStep('contact', v);
  if (Object.keys(errors).length) return { errors };
  try {
    const existing = Boolean(await existingApplication(v.email));
    const codeErrors = await checkCodes(v, false, existing);
    return Object.keys(codeErrors).length ? { errors: codeErrors, existing } : { ok: true, existing };
  } catch (err) {
    console.error('[application] contact check:', err);
    return { error: 'Could not reach the server. Please try again.' };
  }
}

export async function uploadApplicationFile(formData) {
  const draftId = String(formData.get('draftId') ?? '');
  const field = String(formData.get('field') ?? '');
  const file = formData.get('file');

  if (!DRAFT_RE.test(draftId) || !FILE_FIELDS[field]) return { error: 'Please reload the page and try again.' };
  if (!file || typeof file === 'string' || file.size === 0) return { error: 'Please choose a file.' };
  if (!ALLOWED_TYPES.includes(file.type)) return { error: 'Only PDF, JPG or PNG files are allowed.' };
  if (file.size > MAX_BYTES) return { error: 'The file is too large. Please use a file of 4 MB or less.' };

  try {
    // replace an earlier upload for the same field of this (not yet submitted) application
    await query('DELETE FROM application_files WHERE draft_id = ? AND field = ? AND application_id IS NULL', [draftId, field]);
    const { insertId } = await query(
      'INSERT INTO application_files (draft_id, field, filename, content_type, size, content) VALUES (?, ?, ?, ?, ?, ?)',
      [draftId, field, file.name.slice(0, 255), file.type, file.size, Buffer.from(await file.arrayBuffer())]
    );
    return { ok: true, id: String(insertId) };
  } catch (err) {
    console.error('[application] upload:', err);
    return { error: 'Upload failed. Please try again.' };
  }
}

export async function submitApplication(input) {
  const v = readApplication(input);
  const errors = validateAll(v);
  if (Object.keys(errors).length) return { step: firstStepWithError(errors), errors };
  if (!DRAFT_RE.test(v.draftId)) return { error: 'Please reload the page and try again.' };

  const now = new Date();
  const corporate = isCorporate(v);
  const shows = (key) => showsStep(v, key);
  // only the uploads of the steps this client was shown (steps Sumsub collects are hidden, see HIDDEN_STEPS)
  const wanted = Object.keys(FILE_FIELDS).filter((k) => shows(FILE_FIELDS[k].step) && (k !== 'idBack' || needsBackSide(v.idType)));
  let id;
  let reference;
  let signedAgreements;
  try {
    // the contact step: WhatsApp code correct, and the e-mail code when the e-mail already has an application; used up here
    const contactStep = STEP_INDEX.contact;
    const existing = await existingApplication(v.email);
    const codeErrors = await checkCodes(v, true, Boolean(existing));
    if (Object.keys(codeErrors).length) return { step: contactStep, errors: codeErrors, existing: Boolean(existing) };

    // every uploaded file must still be there, belong to this draft and not to another client
    const missing = {};
    for (const k of wanted) {
      const ok = /^\d+$/.test(v[k]) && (await queryOne('SELECT id FROM application_files WHERE id = ? AND draft_id = ? AND field = ? AND application_id IS NULL', [v[k], v.draftId, k]));
      if (!ok) missing[k] = `Please upload the ${FILE_FIELDS[k].label} again.`;
    }
    if (Object.keys(missing).length) return { step: firstStepWithError(missing), errors: missing };

    const identity = shows('identity');
    const address = shows('address');
    const questionnaire = shows('questionnaire');
    const agreedAt = now.toISOString();
    // 2.5 (and 2.8) what was signed and when
    signedAgreements = [
      ...BRAND.agreements.map((a, i) => ({ title: a.title, url: a.url || null, accepted: Boolean(v[`agreement${i + 1}`]), read: Boolean(v[`agreement${i + 1}Read`]), acceptedAt: agreedAt })),
      ...(corporate ? [{ title: BRAND.corporateAgreement?.title ?? 'Client Agreement (Corporate)', url: BRAND.corporateAgreement?.url || null, accepted: true, acceptedAt: agreedAt }] : [])
    ];
    const row = {
      // 2.1 personal information
      accountType: v.accountType,
      firstName: v.firstName,
      lastName: v.lastName,
      dateOfBirth: v.dateOfBirth,
      country: v.country,
      nationality: v.nationality,
      partnerCode: v.partnerCode || null,
      // contact details (the mobile is verified by WhatsApp; the e-mail only when it already had an application)
      email: v.email,
      emailVerifiedAt: existing ? now : null,
      passwordHash: null, // no password in the form yet
      phone: v.phone,
      phoneCountry: v.phoneCountry,
      phoneVerifiedAt: now,
      // only when the identity step is shown; otherwise Sumsub reads it from the document
      idNumberEncrypted: v.idNumber ? encryptField(v.idNumber) : null,
      // 2.2 identity: from the form when that step is shown, otherwise collected by Sumsub
      idType: identity ? v.idType : null,
      idFirstName: identity ? v.idFirstName : null,
      idLastName: identity ? v.idLastName : null,
      // 2.3 proof of address
      poaCountry: address ? v.poaCountry : null,
      postalCode: address ? v.postalCode : null,
      address: address ? v.address : null,
      proofDate: address ? v.proofDate || null : null,
      // 2.4 questionnaire
      education: questionnaire ? v.education : null,
      employment: questionnaire ? v.employment : null,
      industry: questionnaire ? v.industry : null,
      industryOther: questionnaire && v.industry === 'Other' ? v.industryOther : null,
      occupation: questionnaire ? v.occupation : null,
      occupationOther: questionnaire && v.occupation === 'Other' ? v.occupationOther : null,
      employer: questionnaire ? v.employer || null : null,
      previousEmployment: questionnaire ? v.previousEmployment || null : null,
      experienceYears: questionnaire ? v.experienceYears : null,
      income: questionnaire ? v.income : null,
      sourceOfFunds: questionnaire ? v.sourceOfFunds : null,
      investmentExperience: questionnaire ? v.investmentExperience : null,
      marketExperience: questionnaire ? v.marketExperience : null,
      usCitizen: questionnaire ? v.usCitizen : null,
      tinEncrypted: questionnaire && v.tin ? encryptField(v.tin) : null,
      pep: questionnaire ? (v.pep ? 1 : 0) : null,
      agreements: JSON.stringify(signedAgreements),
      // 2.6–2.7 corporate clients
      company: corporate
        ? JSON.stringify({
            name: v.companyName,
            registrationNumber: v.regNumber,
            registrationDate: v.regDate,
            registrationCountry: v.regCountry,
            registrationCity: v.regCity,
            postalCode: v.regPostalCode,
            registrationAddress: v.regAddress,
            secondaryPhone: v.secondaryPhone || null,
            authorisedPerson: {
              name: v.repName,
              passport: v.repPassport,
              nationality: v.repNationality,
              shareholdingRatio: Number(v.repRatio),
              residentialAddress: v.repAddress,
              email: v.repEmail,
              phone: v.repPhone,
              occupation: v.repOccupation
            },
            shareholders: v.shareholders.map((x) => ({ ...x, ratio: Number(x.ratio) })),
            license: { companyName: v.licenseCompanyName, registrationNumber: v.licenseRegNumber, fileId: v.licenseFile || null }
          })
        : null
    };
    const cols = Object.keys(row);
    if (existing) {
      // the client proved the e-mail is theirs: their application takes the new answers, its uploads are replaced
      ({ id, applicationReference: reference } = existing);
      await query(`UPDATE client_applications SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...Object.values(row), id]);
      if (wanted.length) await query(`DELETE FROM application_files WHERE application_id = ? AND field IN (${wanted.map(() => '?').join(', ')})`, [id, ...wanted]);
    } else {
      const insert = `INSERT INTO client_applications (applicationReference, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`;
      // a clash on the random reference is very unlikely; try a new one a few times
      for (let attempt = 0; ; attempt++) {
        reference = newReference();
        try {
          ({ insertId: id } = await query(insert, [reference, ...Object.values(row)]));
          break;
        } catch (err) {
          if (isDuplicate(err) && /reference/i.test(err.sqlMessage ?? '') && attempt < 4) continue;
          throw err;
        }
      }
    }

    // the files now belong to the client (document type as Sumsub names it; the ID photos use the chosen ID type)
    for (const k of wanted) {
      const { docType, side } = FILE_FIELDS[k];
      await query('UPDATE application_files SET application_id = ?, doc_type = ?, side = ? WHERE id = ?', [id, docType ?? v.idType, side ?? null, v[k]]);
    }
  } catch (err) {
    // two submissions with the same e-mail at once: the unique key on email lets only one through
    if (isDuplicate(err)) return { step: STEP_INDEX.contact, errors: { email: TAKEN } };
    console.error('[application] submit:', err);
    return { error: 'We could not save your application. Please try again.' };
  }

  // the signed copies of the agreements (name, signature and date filled in) go to OSS; their keys are kept with the
  // agreements. Not fatal: without them, a copy is made when the account is opened (src/lib/accountOpening.js)
  try {
    const signed = await storeSignedAgreements({ applicationId: id, agreements: signedAgreements, name: `${v.firstName} ${v.lastName}`, email: v.email, reference });
    if (signed.some((a) => a.file)) await query('UPDATE client_applications SET agreements = ? WHERE id = ?', [JSON.stringify(signed), id]);
  } catch (err) {
    console.error('[application] signed agreements:', err?.message || err);
  }

  // signed in from here on: the identity verification that follows (actions/verification.js) is tied to this client
  await createSession({ id: String(id), name: `${v.firstName} ${v.lastName}` });

  return { ok: true, reference };
}
