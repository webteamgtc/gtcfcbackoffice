import 'server-only';
import { randomInt } from 'node:crypto';
import countries from 'i18n-iso-countries';
import { query, queryOne } from '@/lib/db';
import { decryptField, encryptField } from '@/lib/fieldCrypto';
import { countryByCode } from '@/lib/countries';
import { BRAND } from '@/lib/brand';
import { accountOpenedEmail, sendMail } from '@/lib/mailer';
import { downloadApplicantFile, getApplicantByUserId, getApplicantFiles } from '@/lib/sumsub';
import { agreementPdf } from '@/lib/agreementPdf';
import { Cat5Error, cat5Configured, onboardCustomer, uploadFile } from '@/lib/cat5';
import { demoApplicant, demoApplicantFiles, demoMode, downloadDemoFile, simulatedMax } from '@/lib/demo';

/**
 * Opens the client's account in MAX once Sumsub has approved them (called from /success, src/app/actions/account.js).
 * Data: our application (client_applications) + the approved Sumsub applicant (ID document, proof of address, address,
 * questionnaire). Files are copied from Sumsub to MAX; the two agreements are sent as signature-record PDFs.
 * The password is generated here, sent to MAX and e-mailed to the client. Until that e-mail has gone out it is kept
 * encrypted in max_onboarding, so a retry sends MAX (and the client) the same one; then it is erased.
 *
 * max_onboarding.status: new → processing → done | failed (retried on the next visit, up to MAX_ATTEMPTS) | blocked
 * (our team has to look: duplicate e-mail/phone, data MAX refused, missing proof of address, corporate client).
 * MAX's external_customer_id is our application reference, so retries are idempotent on their side too.
 * Demo mode (CAT5_DEMO_MODE, src/lib/demo.js) swaps Sumsub for a made-up approved applicant, and MAX for simulated
 * answers when CAT5_API_BASE_URL isn't set.
 */
const MAX_ATTEMPTS = 5;
const STALE_MINUTES = 10; // a "processing" row older than this was interrupted and may be taken again

// Sumsub questionnaire (KYB_2) answers MAX needs; the first key found in any section wins
const QUESTIONS = {
  occupation: ['jobTiltleProfession', 'jobTitleProfession', 'occupation', 'profession'],
  title: ['title', 'jobTitle', 'position'],
  industry: ['businessActivity', 'industry'],
  tin: ['tin', 'tinNumber', 'taxIdentificationNumber', 'taxIdNumber', 'taxNumber'],
  noTinReason: ['pleaseExplain'],
  pep: ['iDeclareThatIAmAPoli', 'iDeclareThatIAmClose']
};
const ID_TYPES = { ID_CARD: 'id_card', DRIVERS: 'driver_license', RESIDENCE_PERMIT: 'residence_permit', PASSPORT: 'passport' };
const POA_TYPES = ['PROOF_OF_RESIDENCE', 'PROOF_OF_RESIDENCE2', 'UTILITY_BILL', 'UTILITY_BILL2', 'BANK_STATEMENT', 'BANK_STATEMENT2'];
// codes after which a retry cannot help: our team has to check the client
const BLOCKING_CODES = [33602, 33603, 33606];

// fixed KYC values (MAX only checks they are filled in); change them in .env
const kycDefaults = () => ({
  approvers: String(process.env.CAT5_APPROVERS || 'Sumsub automated review').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20),
  risk_rating: process.env.CAT5_RISK_RATING || 'Low',
  member_classification: process.env.CAT5_MEMBER_CLASSIFICATION || 'Retail',
  aml_screening_result: process.env.CAT5_AML_RESULT || 'Clear (Sumsub GREEN)'
});

class Blocked extends Error {}

const alpha3 = (code) => (code ? countries.alpha2ToAlpha3(String(code).toUpperCase()) : undefined);
const cut = (s, n) => String(s ?? '').trim().slice(0, n);

function ageOn(birthday, now = new Date()) {
  const [y, m, d] = birthday.split('-').map(Number);
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age--;
  return age;
}

// 16 characters, at least one lower case letter, upper case letter, digit and symbol; no look-alike characters
function generatePassword() {
  const sets = ['abcdefghjkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#%*-_+'];
  const all = sets.join('');
  const chars = sets.map((s) => s[randomInt(s.length)]);
  while (chars.length < 16) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function questionnaire(applicant) {
  const flat = {};
  for (const q of applicant.questionnaires ?? [])
    for (const section of Object.values(q.sections ?? {}))
      for (const [key, item] of Object.entries(section.items ?? {})) flat[key] = item.value ?? (item.values ?? []).join(', ');
  const pick = (name) => QUESTIONS[name].map((k) => flat[k]).find((v) => v != null && String(v).trim() !== '');
  return { pick, yes: (name) => QUESTIONS[name].some((k) => String(flat[k] ?? '').toLowerCase() === 'yes') };
}

// files the review accepted (rejected or replaced uploads are left out)
const usable = (f) => !f.deactivated && f.reviewResult?.reviewAnswer !== 'RED';

// where the KYC data comes from and where it goes: Sumsub and MAX, or their demo stand-ins
const sumsub = () =>
  demoMode()
    ? { applicant: (app) => demoApplicant(app), files: demoApplicantFiles, download: downloadDemoFile }
    : { applicant: (app) => getApplicantByUserId(String(app.id)), files: getApplicantFiles, download: downloadApplicantFile };
const max = () => (demoMode() && !cat5Configured() ? simulatedMax : { uploadFile, onboardCustomer });

async function copyFromSumsub(applicant, file, email, name) {
  const { buffer, contentType } = await sumsub().download(applicant.inspectionId, file.id);
  return max().uploadFile(email, { buffer, contentType, name });
}

/** Everything MAX needs, uploads included → the onboarding request body. Exported for testing. */
export async function buildRequest(app, applicant, password) {
  const email = app.email.trim().toLowerCase();
  const info = applicant.info ?? {};
  const answers = questionnaire(applicant);
  const files = (await sumsub().files(applicant.id)).filter(usable);

  const idDoc = (info.idDocs ?? []).find((d) => ID_TYPES[d.idDocType]);
  const idFiles = files.filter((f) => ID_TYPES[f.idDocDef?.idDocType]);
  const front = idFiles.find((f) => f.idDocDef.idDocSubType !== 'BACK_SIDE');
  const back = idFiles.find((f) => f.idDocDef.idDocSubType === 'BACK_SIDE') ?? front; // a passport has one side
  if (!front) throw new Blocked('Sumsub has no accepted identity document image for this client.');

  const poaFiles = files.filter((f) => POA_TYPES.includes(f.idDocDef?.idDocType)).slice(0, 15);
  const address = (info.addresses ?? applicant.fixedInfo?.addresses ?? [])[0];
  if (!poaFiles.length || !address) throw new Blocked('Sumsub has no proof of address for this client: add the proof-of-residence step to the Sumsub level.');

  const birthday = info.dob || app.dateOfBirth;
  const agreements = Array.isArray(app.agreements) ? app.agreements : JSON.parse(app.agreements ?? '[]');
  const signed = BRAND.agreements.map((a, i) => agreements.find((x) => x.title === a.title) ?? agreements[i]);
  if (signed.length < 2 || signed.some((a) => !a?.accepted)) throw new Blocked('The client has not accepted both agreements.');
  const name = `${app.firstName} ${app.lastName}`;

  // uploads (one at a time, as MAX expects)
  const frontUrl = await copyFromSumsub(applicant, front, email, 'id-front');
  const backUrl = back === front ? frontUrl : await copyFromSumsub(applicant, back, email, 'id-back');
  const poaUrls = [];
  for (const [i, f] of poaFiles.entries()) poaUrls.push(await copyFromSumsub(applicant, f, email, `proof-of-address-${i + 1}`));
  const agreementUrls = [];
  for (const [i, a] of signed.entries()) {
    const pdf = await agreementPdf({ title: a.title, name, email, reference: app.applicationReference, acceptedAt: a.acceptedAt ?? app.submittedAt });
    agreementUrls.push(await max().uploadFile(email, { buffer: pdf, contentType: 'application/pdf', name: `agreement-${i + 1}` }));
  }

  const tin = answers.pick('tin') || (app.tinEncrypted ? decryptField(app.tinEncrypted) : '') || `Not available (${answers.pick('noTinReason') || 'not provided'})`;
  const street = address.formattedAddress || [address.flatNumber, address.buildingNumber, address.street, address.subStreet, address.town, address.state].filter(Boolean).join(', ');
  const dial = countryByCode(app.phoneCountry || app.country)?.dial;

  return {
    external_customer_id: app.applicationReference,
    email,
    password,
    first_name: cut(info.firstNameEn || app.firstName, 49),
    last_name: cut(info.lastNameEn || app.lastName, 49),
    phone: String(app.phone).replace(/\D/g, '').replace(/^0+/, ''),
    d_code: dial ? `+${dial}` : '',
    // referral (agent / IB) the account is opened under: the client's partner code from the link (?ref, ?code, …),
    // otherwise CAT5_REFERRAL_CODE
    // invitation_code: cut(app.partnerCode || process.env.CAT5_REFERRAL_CODE, 64),
    kyc: {
      identity: cut(idDoc?.number || decryptField(app.idNumberEncrypted), 50),
      id_type: ID_TYPES[idDoc?.idDocType ?? front.idDocDef.idDocType],
      country: address.country || alpha3(app.country),
      nationality: info.nationality || alpha3(app.nationality),
      birthday,
      age: ageOn(birthday),
      address: cut(street, 255),
      tin: cut(tin, 100),
      occupation: cut(answers.pick('occupation') || app.occupation || 'Not provided', 100),
      title: cut(answers.pick('title') || 'Not provided', 100),
      industry: cut(answers.pick('industry') || app.industry || 'Not provided', 100),
      accept_terms: true,
      // from Sumsub's PEP questions (our form's `pep` is the "I am NOT a PEP" declaration, so it can't say yes)
      is_pep: answers.yes('pep'),
      ...kycDefaults(),
      forms: {
        base: {},
        identity: { front_img: frontUrl, back_img: backUrl },
        address: { proof_ddress: poaUrls, zipcode: cut(address.postCode || '', 32) },
        contract: { agreement: agreementUrls[0], agreement2: agreementUrls[1] }
      }
    }
  };
}

/** The stored result for the success page → { status, memberId, message } | null */
export async function accountStatus(applicationId) {
  const row = await queryOne('SELECT status, member_id, attempts FROM max_onboarding WHERE application_id = ?', [applicationId]);
  if (!row) return null;
  return { status: row.status === 'failed' && row.attempts >= MAX_ATTEMPTS ? 'blocked' : row.status, memberId: row.member_id };
}

const save = (id, fields) =>
  query(`UPDATE max_onboarding SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE application_id = ?`, [...Object.values(fields), id]);

/**
 * Opens the account if it isn't open yet. Only for an application Sumsub approved (the caller checks).
 * → { status: 'done' | 'processing' | 'failed' | 'blocked' }
 */
export async function openAccount(applicationId) {
  if (!cat5Configured() && !demoMode()) {
    console.warn('[max] CAT5_API_BASE_URL / CAT5_SIGN_KEY are not set; account not opened');
    return { status: 'failed' };
  }
  await query("INSERT IGNORE INTO max_onboarding (application_id, status) VALUES (?, 'new')", [applicationId]);
  // take the job: only one request at a time works on it
  const claim = await query(
    `UPDATE max_onboarding SET status = 'processing', attempts = attempts + 1
      WHERE application_id = ? AND attempts < ? AND (status IN ('new', 'failed') OR (status = 'processing' AND updated_at < NOW() - INTERVAL ${STALE_MINUTES} MINUTE))`,
    [applicationId, MAX_ATTEMPTS]
  );
  if (claim.affectedRows !== 1) return { status: (await accountStatus(applicationId))?.status ?? 'failed' };

  try {
    const app = await queryOne('SELECT * FROM client_applications WHERE id = ?', [applicationId]);
    if (app.accountType === 'corporate') throw new Blocked('Corporate clients are opened by our team (the MAX import is for individuals).');
    const applicant = await sumsub().applicant(app);
    if (applicant?.review?.reviewResult?.reviewAnswer !== 'GREEN') throw new Blocked('The Sumsub applicant is not approved.');

    // the same password on every try until the client has it
    const job = await queryOne('SELECT password_encrypted FROM max_onboarding WHERE application_id = ?', [applicationId]);
    let password = job.password_encrypted ? decryptField(job.password_encrypted) : null;
    if (!password) {
      password = generatePassword();
      await save(applicationId, { password_encrypted: encryptField(password) });
    }

    const result = await max().onboardCustomer(await buildRequest(app, applicant, password));
    await save(applicationId, {
      member_id: result.member_id ?? null,
      result_code: result.code,
      message: result.code === 33601 ? 'Created; same name and nationality as existing MAX customers' : 'Created',
      duplicate_member_ids: JSON.stringify(result.duplicate_member_ids ?? [])
    });

    await sendMail({ to: app.email, ...accountOpenedEmail({ name: app.firstName, email: app.email.trim().toLowerCase(), password, reference: app.applicationReference }) });
    await save(applicationId, { status: 'done', password_encrypted: null, password_emailed_at: new Date() });
    console.info(`[max] application ${applicationId} → member ${result.member_id} (code ${result.code})`);
    return { status: 'done' };
  } catch (err) {
    const blocked = err instanceof Blocked || (err instanceof Cat5Error && BLOCKING_CODES.includes(err.code));
    console.error(`[max] application ${applicationId}: ${err.message}`, err.data ?? '');
    await save(applicationId, {
      status: blocked ? 'blocked' : 'failed',
      result_code: err.code ?? null,
      message: cut(err.message, 500),
      ...(err.data?.duplicate_member_ids ? { duplicate_member_ids: JSON.stringify(err.data.duplicate_member_ids) } : {})
    });
    return { status: blocked ? 'blocked' : 'failed' };
  }
}
