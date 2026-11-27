import 'server-only';
import { query, queryOne } from '@/lib/db';
import { LINK_ENDED, createVerification, getStatus, linkTtlMinutes, shuftiConfigured, statusFromEvent } from '@/lib/shufti';
import { demoMode } from '@/lib/demo';
import { countryByCode } from '@/lib/countries';

/**
 * The identity verification of an application (Shufti Pro, src/lib/shufti.js), one row per application in
 * client_verifications (db/schema.sql); the outcome is mirrored onto the client's dashboard uploads
 * (client_documents.review_status), which is what the dashboard reads.
 *   applicant_id      the Shufti reference of the current request (a new one per attempt)
 *   verification_url  its link (reused while valid, so a page reload doesn't start a new, billed, request)
 *   review_status     Shufti's last event · review_answer ACCEPTED | DECLINED · moderation_comment / reject_labels: why
 * Rows from before Shufti (provider NULL: Sumsub) are left as they are; a client with one starts a Shufti request.
 */
const FILE_STATUS = { approved: 'approved', rejected: 'rejected', pending: 'pending', started: 'pending' };
const PROVIDER = 'shufti';

const row = (applicationId) => queryOne('SELECT * FROM client_verifications WHERE application_id = ?', [applicationId]);

/** The application a Shufti reference belongs to, or null. */
export async function applicationByReference(reference) {
  const r = await queryOne('SELECT application_id FROM client_verifications WHERE provider = ? AND applicant_id = ?', [PROVIDER, String(reference ?? '')]);
  return r?.application_id ?? null;
}

/** Stores what Shufti said about the application's current request (status endpoint or callback) → our status. */
export async function saveResult(applicationId, answer, source) {
  const event = answer?.event;
  const current = await row(applicationId);
  // an answer about an older request (a callback that arrives late) doesn't overwrite the current one
  if (current?.provider === PROVIDER && answer?.reference && current.applicant_id !== answer.reference) return current.status;
  const status = statusFromEvent(event) ?? current?.status ?? 'started';
  const ended = LINK_ENDED.includes(event);
  const codes = Array.isArray(answer?.declined_codes) ? answer.declined_codes : [];
  await query(
    `UPDATE client_verifications
        SET status = ?, review_status = ?, review_answer = ?, reject_labels = ?, moderation_comment = ?, last_event = ?
            ${ended ? ', verification_url = NULL, url_created_at = NULL' : ''}
      WHERE application_id = ?`,
    [
      status,
      event ?? null,
      status === 'approved' ? 'ACCEPTED' : status === 'rejected' ? 'DECLINED' : null,
      JSON.stringify(codes),
      status === 'rejected' ? (answer?.declined_reason ?? null) : null,
      source,
      applicationId
    ]
  );
  await query('UPDATE client_documents SET review_status = ? WHERE application_id = ?', [FILE_STATUS[status], applicationId]);
  return status;
}

/**
 * The verification link for the client's page → { url } (a new Shufti request when there is no usable one),
 * or { status } when the verification is already submitted or decided (no link needed).
 * `origin`: this site (https://…), for the page Shufti returns to and its callback.
 */
export async function verificationLink(applicationId, origin) {
  const current = await row(applicationId);
  if (current?.provider === PROVIDER) {
    if (['pending', 'approved', 'rejected'].includes(current.status)) return { status: current.status };
    const fresh = current.url_created_at && Date.now() - new Date(current.url_created_at).getTime() < (linkTtlMinutes() - 5) * 60_000;
    if (current.verification_url && fresh) return { url: current.verification_url };
  }

  const app = await queryOne(
    'SELECT id, applicationReference, email, country, firstName, lastName, dateOfBirth, flatNumber, buildingName, streetAddress, city, address FROM client_applications WHERE id = ?',
    [applicationId]
  );
  if (!app) throw new Error(`No application ${applicationId}`);
  // the residential address the client gave (step 3), with their country: what the proof of address must show
  const fullAddress =
    [app.flatNumber, app.buildingName, app.streetAddress, app.city, countryByCode(app.country)?.name].filter(Boolean).join(', ') || app.address || countryByCode(app.country)?.name || '';
  const reference = `${app.applicationReference}-${Date.now().toString(36).toUpperCase()}`;
  const local = !origin || /^https?:\/\/(localhost|127\.|\[::1\]|10\.|192\.168\.)/i.test(origin);
  const callbackUrl = process.env.SHUFTI_CALLBACK_URL || (local ? null : `${origin}/api/shufti/callback`);
  const { verificationUrl, event } = await createVerification({
    reference,
    email: app.email,
    country: app.country,
    firstName: app.firstName,
    lastName: app.lastName,
    dob: app.dateOfBirth ? String(app.dateOfBirth).slice(0, 10) : '', // DATE columns come as YYYY-MM-DD
    fullAddress,
    // in the iframe, back to a page that tells ours the client is done (Shufti can't reach localhost: polling does it)
    redirectUrl: local ? null : `${origin}/api/shufti/done`,
    callbackUrl
  });

  await query(
    `INSERT INTO client_verifications
       (application_id, provider, status, applicant_id, level_name, review_status, verification_url, url_created_at, last_event, reject_labels)
     VALUES (?, ?, 'started', ?, 'document, face, address', ?, ?, NOW(), 'created', '[]')
     ON DUPLICATE KEY UPDATE
       provider = VALUES(provider), status = 'started', applicant_id = VALUES(applicant_id), level_name = VALUES(level_name),
       review_status = VALUES(review_status), review_answer = NULL, reject_type = NULL, reject_labels = '[]',
       moderation_comment = NULL, client_comment = NULL, verification_url = VALUES(verification_url),
       url_created_at = VALUES(url_created_at), last_event = VALUES(last_event)`,
    [applicationId, PROVIDER, reference, event ?? null, verificationUrl]
  );
  console.info(`[shufti] application ${applicationId}: request ${reference} created`);
  return { url: verificationUrl };
}

/** Asks Shufti for the current request's result and stores it → our status, or 'not_started' when there is no request. */
export async function syncVerification(applicationId) {
  const current = await row(applicationId);
  if (current?.provider !== PROVIDER || !current.applicant_id) return 'not_started';
  return saveResult(applicationId, await getStatus(current.applicant_id), 'sync');
}

/**
 * syncVerification for pages that show the status (back office, the client's page and outcome pages): picks up a decision
 * made in the Shufti back office when its callback can't reach us, as in local development. Only while a decision is
 * still open or could still change. Best effort: on any error the stored status stays. → our status, or null when not
 * checked.
 */
export async function refreshVerification(applicationId) {
  if (!shuftiConfigured() || demoMode()) return null;
  try {
    return await syncVerification(String(applicationId));
  } catch (err) {
    console.warn(`[shufti] refresh ${applicationId}: ${err.message}`);
    return null;
  }
}
