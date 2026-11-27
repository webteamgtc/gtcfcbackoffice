import 'server-only';
import { randomInt } from 'node:crypto';
import countries from 'i18n-iso-countries';
import { query, queryOne } from '@/lib/db';
import { decryptField, encryptField } from '@/lib/fieldCrypto';
import { countryByCode } from '@/lib/countries';
import { publicIp } from '@/lib/clientIp';
import { BRAND } from '@/lib/brand';
import { accountOpenedEmail, sendMail } from '@/lib/mailer';
import { downloadProof, getStatus } from '@/lib/shufti';
import { agreementPdf } from '@/lib/agreementPdf';
import { signedAgreementPdf, storedAgreement } from '@/lib/signedAgreement';
import { Cat5Error, cat5Configured, onboardCustomer, uploadFile } from '@/lib/cat5';
import { demoKycRecord, demoMode, simulatedMax } from '@/lib/demo';


/**
 * Opens the client's account in MAX once Shufti Pro has accepted their verification (called from /success,
 * src/app/actions/account.js, and the back office). Data: our application (client_applications) + the accepted Shufti
 * request (document data read by OCR, the document and proof of address images). Images are copied from Shufti to MAX;
 * the two agreements are sent as the client's signed copies (src/lib/signedAgreement.js).
 * The password is generated here, sent to MAX and e-mailed to the client. Until that e-mail has gone out it is kept
 * encrypted in max_onboarding, so a retry sends MAX (and the client) the same one; then it is erased.
 *
 * max_onboarding.status: new → processing → done | failed (retried on the next visit, up to MAX_ATTEMPTS) | blocked
 * (our team has to look: duplicate e-mail/phone, data MAX refused, missing ID document, corporate client).
 * MAX's external_customer_id is our application reference, so retries are idempotent on their side too.
 * Demo mode (CAT5_DEMO_MODE, src/lib/demo.js) swaps Shufti for a made-up accepted verification, and MAX for simulated
 * answers when CAT5_API_BASE_URL isn't set.
 */
const MAX_ATTEMPTS = 5;
const STALE_MINUTES = 10; // a "processing" row older than this was interrupted and may be taken again

// Shufti's document types → MAX's id_type
const ID_TYPES = { id_card: 'id_card', passport: 'passport', driving_license: 'driver_license' };
// codes after which a retry cannot help: our team has to check the client
const BLOCKING_CODES = [33602, 33603, 33606];

// fixed KYC values (MAX only checks they are filled in); change them in .env
const LEVELS = ['high', 'medium', 'low'];
const level = (name, fallback) => {
  const v = String(process.env[name] || fallback).trim().toLowerCase();
  if (!LEVELS.includes(v)) throw new Error(`${name} must be high, medium or low`);
  return v;
};
const score = (name, fallback) => {
  const v = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(v)) throw new Error(`${name} must be a number`);
  return v;
};
const kycDefaults = () => ({
  approvers: String(process.env.CAT5_APPROVERS || 'Shufti Pro automated review').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20),
  risk_rating: process.env.CAT5_RISK_RATING || 'Low',
  member_classification: process.env.CAT5_MEMBER_CLASSIFICATION || 'Retail',
  aml_screening_result: process.env.CAT5_AML_RESULT || 'Clear (Shufti Pro verification accepted)',
  // the UAE suitability and risk tolerance assessment (MAX takes them as they are)
  suitability_level: level('CAT5_SUITABILITY_LEVEL', 'medium'),
  suitability_score: score('CAT5_SUITABILITY_SCORE', 0),
  risk_tolerance_level: level('CAT5_RISK_TOLERANCE_LEVEL', 'medium'),
  risk_tolerance_score: score('CAT5_RISK_TOLERANCE_SCORE', 0)
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

// a Shufti value that may be a string, a list or missing → its first non-empty string
const first = (v) => (Array.isArray(v) ? v.map(first).find(Boolean) : typeof v === 'string' && v.trim() ? v.trim() : undefined);
const all = (v) => (Array.isArray(v) ? v.flatMap(all) : typeof v === 'string' && v.trim() ? [v.trim()] : []);

// a nationality / country as Shufti gives it (alpha-2, alpha-3 or an English name) → ISO alpha-3
function toAlpha3(v) {
  const s = String(v ?? '').trim();
  if (/^[a-z]{2}$/i.test(s)) return countries.alpha2ToAlpha3(s.toUpperCase());
  if (/^[a-z]{3}$/i.test(s)) return countries.isValid(s.toUpperCase()) ? s.toUpperCase() : undefined;
  return s ? countries.getAlpha3Code(s, 'en') : undefined;
}

/**
 * The accepted verification of an application, in the shape buildRequest needs:
 * { approved, document: { number, type, firstName, lastName, dob, nationality }, files: { front, back, poa: [] } }
 * where each file is a function → { buffer, contentType }. From Shufti's status endpoint (verification_data = what OCR
 * read, proofs = links to the images), or made up in demo mode.
 */
export async function kycRecord(app) {
  if (demoMode()) return demoKycRecord(app);
  const v = await queryOne("SELECT applicant_id FROM client_verifications WHERE application_id = ? AND provider = 'shufti'", [app.id]);
  if (!v?.applicant_id) throw new Blocked('The client has no Shufti Pro verification.');
  const answer = await getStatus(v.applicant_id);
  const doc = answer.verification_data?.document ?? {};
  const extra = answer.additional_data?.document?.proof ?? {};
  const proofs = answer.proofs ?? {};
  const load = (url) => url && (() => downloadProof(url, proofs.access_token));
  return {
    approved: answer.event === 'verification.accepted',
    document: {
      number: first(doc.document_number) ?? first(extra.document_number),
      type: first(doc.selected_type) ?? first(doc.document_type),
      firstName: first(doc.name?.first_name) ?? first(extra.first_name),
      lastName: first(doc.name?.last_name) ?? first(extra.last_name),
      dob: first(doc.dob) ?? first(extra.dob),
      nationality: toAlpha3(first(doc.nationality) ?? first(extra.nationality))
    },
    files: {
      front: load(first(proofs.document?.proof)),
      back: load(first(proofs.document?.additional_proof)),
      poa: [...all(proofs.address?.proof), ...all(proofs.address?.additional_proof)].map(load)
    }
  };
}

const max = () => (demoMode() && !cat5Configured() ? simulatedMax : { uploadFile, onboardCustomer });

// the real type of a file from its first bytes (a store may label images generically); MAX takes JPEG, PNG, GIF, BMP, PDF
function sniff(buffer, contentType) {
  const b = buffer.subarray(0, 12);
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b.subarray(0, 4).toString('latin1') === '\x89PNG') return 'image/png';
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (b.subarray(0, 2).toString('latin1') === 'BM') return 'image/bmp';
  if (b.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return contentType;
}

async function copyToMax(file, email, name) {
  const { buffer, contentType } = await file();
  return max().uploadFile(email, { buffer, contentType: sniff(buffer, contentType), name });
}

/** Everything MAX needs, uploads included → the onboarding request body. Exported for testing. */
export async function buildRequest(app, record, password) {
  const email = app.email.trim().toLowerCase();
  const doc = record.document ?? {};
  const { front } = record.files;
  const back = record.files.back ?? front; // a passport has one side
  if (!front) throw new Blocked('Shufti Pro has no identity document image for this client.');
  if (!doc.number && !app.idNumberEncrypted) throw new Blocked('Shufti Pro read no document number for this client.');

  // the residential address step of our form (house / flat, building, street, city): required by MAX; proof of address
  // files and the postal code are optional and left out when there are none
  const home = { house_flat_number: cut(app.flatNumber, 200), house_building_name: cut(app.buildingName, 200), street_address: cut(app.streetAddress, 300), city_emirate: cut(app.city, 200) };
  if (Object.values(home).some((v) => !v)) throw new Blocked('The application has no residential address (house / flat, building, street, city): it was submitted before that step existed.');
  const poaFiles = record.files.poa.filter(Boolean).slice(0, 15);
  // the client's IP when they applied; must be a real public address (in development: CAT5_DEV_REGISTER_IP)
  const registerIp = publicIp(app.registerIp) ?? (process.env.NODE_ENV !== 'production' ? publicIp(process.env.CAT5_DEV_REGISTER_IP) : null);
  if (!registerIp) throw new Blocked(`No public registration IP for this client (recorded: ${app.registerIp || 'none'}).`);

  // the date of birth read from the document, else the one the client gave (DATE columns come as YYYY-MM-DD)
  const birthday = /^\d{4}-\d{2}-\d{2}$/.test(doc.dob ?? '') ? doc.dob : String(app.dateOfBirth).slice(0, 10);
  const agreements = Array.isArray(app.agreements) ? app.agreements : JSON.parse(app.agreements ?? '[]');
  const signed = BRAND.agreements.map((a, i) => agreements.find((x) => x.title === a.title) ?? agreements[i]);
  if (signed.length < 2 || signed.some((a) => !a?.accepted)) throw new Blocked('The client has not accepted both agreements.');
  const name = `${app.firstName} ${app.lastName}`;

  // uploads (one at a time, as MAX expects)
  const frontUrl = await copyToMax(front, email, 'id-front');
  const backUrl = back === front ? frontUrl : await copyToMax(back, email, 'id-back');
  const poaUrls = [];
  for (const [i, f] of poaFiles.entries()) poaUrls.push(await copyToMax(f, email, `proof-of-address-${i + 1}`));
  const agreementUrls = [];
  for (const [i, a] of signed.entries()) {
    // the signed copy stored at submission (src/lib/signedAgreement.js), else one made now; without an agreement PDF,
    // the signature record alone
    const details = { title: a.title, name, email, reference: app.applicationReference, acceptedAt: a.acceptedAt ?? app.submittedAt, declaration: a.declaration };
    const pdf =
      (await storedAgreement(a).catch((err) => console.warn(`[max] stored ${a.title} unreadable: ${err.message}`))) ??
      (await signedAgreementPdf({ ...details, url: a.url })) ??
      (await agreementPdf(details));
    agreementUrls.push(await max().uploadFile(email, { buffer: pdf, contentType: 'application/pdf', name: `agreement-${i + 1}` }));
  }

  const tin = (app.tinEncrypted ? decryptField(app.tinEncrypted) : '') || 'Not available (not provided)';
  // the full residential address: the one the client gave, with their country of residence
  const street = [app.flatNumber, app.buildingName, app.streetAddress, app.city, countryByCode(app.country)?.name].filter(Boolean).join(', ');
  const zipcode = cut(app.postalCode || '', 32);
  const dial = countryByCode(app.phoneCountry || app.country)?.dial;
  // the MAX agent / IB every account is opened under (required; MAX refuses an unknown one); differs per MAX environment
  const invitationCode = cut(process.env.CAT5_INVITATION_CODE, 64);
  if (!invitationCode) throw new Error('CAT5_INVITATION_CODE is not set');

  return {
    external_customer_id: app.applicationReference,
    invitation_code: invitationCode,
    email,
    password,
    first_name: cut(app.firstName || doc.firstName, 49),
    last_name: cut(app.lastName || doc.lastName, 49),
    phone: String(app.phone).replace(/\D/g, '').replace(/^0+/, ''),
    d_code: dial ? `+${dial}` : '',
    register_ip: registerIp,
    province: cut(app.city, 255),
    kyc: {
      identity: cut(doc.number || (app.idNumberEncrypted ? decryptField(app.idNumberEncrypted) : ''), 50),
      id_type: ID_TYPES[doc.type] ?? 'id_card',
      country: alpha3(app.country),
      nationality: doc.nationality || alpha3(app.nationality),
      birthday,
      age: ageOn(birthday),
      address: cut(street, 255),
      tin: cut(tin, 100),
      occupation: cut(app.occupationOther || app.occupation || 'Not provided', 100),
      title: cut('Not provided', 100),
      industry: cut(app.industryOther || app.industry || 'Not provided', 100),
      accept_terms: true,
      // our form's `pep` is the "I am NOT a PEP" declaration (and Shufti's AML check, when on, declines matches)
      is_pep: false,
      ...kycDefaults(),
      forms: {
        base: {},
        identity: { front_img: frontUrl, back_img: backUrl },
        address: { ...home, ...(poaUrls.length ? { proof_ddress: poaUrls } : {}), ...(zipcode ? { zipcode } : {}) },
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
 * Opens the account if it isn't open yet. Only for an application Shufti Pro accepted (the caller checks).
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
    const record = await kycRecord(app);
    if (!record.approved) throw new Blocked('The Shufti Pro verification is not accepted.');

    // the same password on every try until the client has it
    const job = await queryOne('SELECT password_encrypted FROM max_onboarding WHERE application_id = ?', [applicationId]);
    let password = job.password_encrypted ? decryptField(job.password_encrypted) : null;
    if (!password) {
      password = generatePassword();
      await save(applicationId, { password_encrypted: encryptField(password) });
    }

    const result = await max().onboardCustomer(await buildRequest(app, record, password));
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
