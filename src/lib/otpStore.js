import 'server-only';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { getDb } from '@/lib/mongodb';

/**
 * E-mail one-time codes, used by POST /api/otp-smtp (sends) and actions/application.js (checks).
 * Kept in MongoDB (`email_codes`, one per e-mail, hashed) rather than in memory, so a code survives
 * dev reloads and works when the app runs on several instances.
 * 6 digits · valid 10 minutes · new code at most once a minute · 5 wrong tries, then a new code is needed.
 */
const CODES = 'email_codes';
const CODE_TTL = 10 * 60 * 1000;
const RESEND_AFTER = 60 * 1000;
const MAX_TRIES = 5;

const norm = (email) => String(email ?? '').trim().toLowerCase();
const hashCode = (email, code) => createHash('sha256').update(`${email}:${code}:${process.env.SESSION_SECRET}`).digest();

/** → { otp } or { error: 'wait', retryIn } (seconds) when a code was sent less than a minute ago. */
export async function createOtp(email) {
  email = norm(email);
  const codes = (await getDb()).collection(CODES);
  const last = await codes.findOne({ email }, { projection: { sentAt: 1 } });
  const since = last ? Date.now() - last.sentAt.getTime() : Infinity;
  if (since < RESEND_AFTER) return { error: 'wait', retryIn: Math.ceil((RESEND_AFTER - since) / 1000) };

  const otp = String(randomInt(100000, 1000000));
  await codes.updateOne(
    { email },
    { $set: { hash: hashCode(email, otp), sentAt: new Date(), expiresAt: new Date(Date.now() + CODE_TTL), tries: 0 } },
    { upsert: true }
  );
  return { otp };
}

/** Removes the e-mail's code, e.g. when sending it failed so the client can ask again straight away. */
export async function clearOtp(email) {
  await (await getDb()).collection(CODES).deleteOne({ email: norm(email) });
}

/** → { success: true } or { success: false, reason: 'invalid' | 'expired' }. `consume` deletes a matching code. */
export async function verifyOtp(email, otp, { consume = false } = {}) {
  email = norm(email);
  const codes = (await getDb()).collection(CODES);
  const doc = await codes.findOne({ email });
  if (!doc || doc.expiresAt < new Date() || doc.tries >= MAX_TRIES) return { success: false, reason: 'expired' };
  const given = hashCode(email, String(otp ?? ''));
  const stored = Buffer.from(doc.hash.buffer ?? doc.hash);
  if (stored.length !== given.length || !timingSafeEqual(stored, given)) {
    await codes.updateOne({ _id: doc._id }, { $inc: { tries: 1 } });
    return { success: false, reason: 'invalid' };
  }
  if (consume) await codes.deleteOne({ _id: doc._id });
  return { success: true };
}
