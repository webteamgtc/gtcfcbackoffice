import 'server-only';
import { query, queryOne } from '@/lib/db';
import { getSession } from '@/lib/session';
import { fullPhone } from '@/lib/application';
import { demoMode } from '@/lib/demo';

/** The signed-in client (a row of client_applications, see db/schema.sql), or null. Never includes the password. */
export async function getCurrentUser() {
  const session = await getSession();
  if (!/^\d+$/.test(String(session?.userId ?? ''))) return null;

  const row = await queryOne(
    `SELECT a.id, a.firstName, a.lastName, a.email, a.emailVerifiedAt, a.country, a.phone, a.phoneCountry, a.partnerCode, a.applicationReference, v.status AS verificationStatus
       FROM client_applications a LEFT JOIN client_verifications v ON v.application_id = a.id
      WHERE a.id = ?`,
    [session.userId]
  );
  if (!row) return null;

  return {
    id: String(row.id),
    firstName: row.firstName ?? '',
    lastName: row.lastName ?? '',
    email: row.email ?? '',
    emailVerified: Boolean(row.emailVerifiedAt),
    country: row.country ?? '',
    // stored as the national number; shown (and sent to Sumsub) in international form
    phone: row.phone ? fullPhone(row.phoneCountry || row.country, row.phone) : '',
    partnerCode: row.partnerCode ?? '',
    reference: row.applicationReference ?? '',
    // Sumsub outcome (client_verifications, src/lib/verification.js); null before verification has started.
    // Demo mode (src/lib/demo.js): everyone counts as verified
    verificationStatus: demoMode() ? 'approved' : (row.verificationStatus ?? null)
  };
}

const PROFILE_FIELDS = ['firstName', 'lastName', 'email', 'emailVerified', 'country', 'phone'];

// share of required profile fields filled in, 0–100 (partner code is optional)
export function profileCompletion(user) {
  const filled = PROFILE_FIELDS.filter((k) => Boolean(user[k])).length;
  return Math.round((filled / PROFILE_FIELDS.length) * 100);
}

// overall KYC state derived from the uploaded documents' Sumsub statuses
export function verificationStatus(documents) {
  if (documents.length === 0) return 'not_started';
  if (documents.some((d) => d.sumsubStatus === 'approved')) return 'approved';
  if (documents.some((d) => d.sumsubStatus === 'rejected') && !documents.some((d) => d.sumsubStatus === 'pending')) return 'rejected';
  return 'pending';
}

/** Files the client uploaded from the dashboard (client_documents), newest first, without their content. */
export async function getUserDocuments(userId) {
  const rows = await query(
    'SELECT id, filename, size, doc_type, review_status, uploaded_at FROM client_documents WHERE application_id = ? ORDER BY uploaded_at DESC, id DESC',
    [userId]
  );
  return rows.map((r) => ({
    id: String(r.id),
    filename: r.filename,
    size: r.size,
    docType: r.doc_type,
    sumsubStatus: r.review_status ?? 'pending',
    uploadedAt: new Date(r.uploaded_at).toISOString()
  }));
}
