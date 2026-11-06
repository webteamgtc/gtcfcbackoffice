import 'server-only';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { query, queryOne } from '@/lib/db';

/**
 * E-mail one-time codes, used by POST /api/otp-smtp (sends) and actions/application.js (checks).
 * Kept in MySQL (`email_otps`, one row per e-mail, hashed) rather than in memory, so a code survives
 * dev reloads and works when the app runs on several instances.
 * 6 digits · valid 10 minutes · new code at most once a minute · 5 wrong tries, then a new code is needed.
 */
const CODE_TTL = 10 * 60 * 1000;
const RESEND_AFTER = 60 * 1000;
const MAX_TRIES = 5;

const norm = (email) => String(email ?? '').trim().toLowerCase();
const hashCode = (email, code) => createHash('sha256').update(`${email}:${code}:${process.env.SESSION_SECRET}`).digest();

/** → { otp } or { error: 'wait', retryIn } (seconds) when a code was sent less than a minute ago. */
export async function createOtp(email) {
  email = norm(email);
  const last = await queryOne('SELECT sent_at FROM email_otps WHERE email = ?', [email]);
  const since = last ? Date.now() - new Date(last.sent_at).getTime() : Infinity;
  if (since < RESEND_AFTER) return { error: 'wait', retryIn: Math.ceil((RESEND_AFTER - since) / 1000) };

  const otp = String(randomInt(100000, 1000000));
  const now = new Date();
  await query(
    `INSERT INTO email_otps (email, code_hash, sent_at, expires_at, tries) VALUES (?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), sent_at = VALUES(sent_at), expires_at = VALUES(expires_at), tries = 0`,
    [email, hashCode(email, otp), now, new Date(now.getTime() + CODE_TTL)]
  );
  return { otp };
}

/** Removes the e-mail's code, e.g. when sending it failed so the client can ask again straight away. */
export async function clearOtp(email) {
  await query('DELETE FROM email_otps WHERE email = ?', [norm(email)]);
}

/** → { success: true } or { success: false, reason: 'invalid' | 'expired' }. `consume` deletes a matching code. */
export async function verifyOtp(email, otp, { consume = false } = {}) {
  email = norm(email);
  const row = await queryOne('SELECT code_hash, expires_at, tries FROM email_otps WHERE email = ?', [email]);
  if (!row || new Date(row.expires_at) < new Date() || row.tries >= MAX_TRIES) return { success: false, reason: 'expired' };
  const given = hashCode(email, String(otp ?? ''));
  const stored = Buffer.from(row.code_hash);
  if (stored.length !== given.length || !timingSafeEqual(stored, given)) {
    await query('UPDATE email_otps SET tries = tries + 1 WHERE email = ?', [email]);
    return { success: false, reason: 'invalid' };
  }
  if (consume) {
    // only one request can use the code up, even if two arrive at once
    const { affectedRows } = await query('DELETE FROM email_otps WHERE email = ? AND code_hash = ?', [email, given]);
    if (!affectedRows) return { success: false, reason: 'expired' };
  }
  return { success: true };
}
