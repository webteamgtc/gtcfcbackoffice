import 'server-only';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { getSession } from '@/lib/session';

export const DOCUMENTS_BUCKET = 'user_documents';

// accepts camelCase or snake_case field names in user_record
const pick = (doc, ...keys) => keys.map((k) => doc[k]).find((v) => v !== undefined && v !== null && v !== '');

export async function getCurrentUser() {
  const session = await getSession();
  if (!session?.userId || !ObjectId.isValid(session.userId)) return null;

  const db = await getDb();
  const doc = await db.collection('user_record').findOne({ _id: new ObjectId(session.userId) }, { projection: { password: 0 } });
  if (!doc) return null;

  const [first, ...rest] = String(doc.name ?? '').trim().split(/\s+/);
  return {
    id: String(doc._id),
    firstName: pick(doc, 'firstName', 'first_name') ?? first ?? '',
    lastName: pick(doc, 'lastName', 'last_name') ?? rest.join(' '),
    email: doc.email ?? '',
    emailVerified: Boolean(pick(doc, 'emailVerified', 'email_verified')),
    country: pick(doc, 'country', 'countryOfResidence', 'country_of_residence') ?? '',
    phone: pick(doc, 'phone', 'phoneNumber', 'phone_number', 'mobile') ?? '',
    partnerCode: pick(doc, 'partnerCode', 'partner_code') ?? ''
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

export async function getUserDocuments(userId) {
  const db = await getDb();
  const files = await db
    .collection(`${DOCUMENTS_BUCKET}.files`)
    .find({ 'metadata.userId': userId })
    .sort({ uploadDate: -1 })
    .toArray();
  return files.map((f) => ({
    id: String(f._id),
    filename: f.filename,
    size: f.length,
    docType: f.metadata?.docType,
    sumsubStatus: f.metadata?.sumsubStatus ?? 'pending',
    uploadedAt: f.uploadDate.toISOString()
  }));
}
