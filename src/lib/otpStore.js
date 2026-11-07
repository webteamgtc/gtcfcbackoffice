import 'server-only';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

/**
 * One-time codes for the application form (mobile via WhatsApp: POST /api/send-phone-otp; e-mail: POST /api/otp-smtp),
 * checked by actions/application.js. No database: issuing a code returns a signed token (HS256, key derived from
 * SESSION_SECRET) that holds the key it was sent to (phoneKey(number) or the e-mail), a keyed hash of the code — never
 * the code itself — and a 10-minute expiry. The browser keeps the token and sends it back with the code the client typed.
 * A token can't be forged, read for the code, or reused for another number.
 *
 * Kept in this server's memory (best effort; with several instances each one counts on its own):
 *   a new code at most once a minute per key · 5 wrong tries per token · a token is used up on submit.
 */
const CODE_TTL = 10 * 60; // seconds
const RESEND_AFTER = 60 * 1000;
const MAX_TRIES = 5;

// separate from the session cookie's key, so an OTP token can never pass as a session and vice versa
const signingKey = () => createHmac('sha256', process.env.SESSION_SECRET ?? '').update('otp-token-v1').digest();
const hashCode = (key, code) => createHmac('sha256', signingKey()).update(`${key}:${code}`).digest('hex');
const norm = (key) => String(key ?? '').trim().toLowerCase();

const state = (globalThis._otpState ??= { sent: new Map(), tries: new Map(), used: new Map() });
function prune() {
  const now = Date.now();
  for (const [k, at] of state.sent) if (now - at >= RESEND_AFTER) state.sent.delete(k);
  for (const map of [state.tries, state.used]) for (const [id, v] of map) if (v.exp * 1000 < now) map.delete(id);
}

/** The key of a phone number's codes: "phone:+" and its digits, e.g. "phone:+971501234567". */
export const phoneKey = (phone) => `phone:+${String(phone ?? '').replace(/\D/g, '')}`;

/** → { otp, token } or { error: 'wait', retryIn } (seconds) when a code was sent to this key less than a minute ago. */
export async function issueOtp(key) {
  key = norm(key);
  prune();
  const last = state.sent.get(key);
  if (last) return { error: 'wait', retryIn: Math.ceil((RESEND_AFTER - (Date.now() - last)) / 1000) };
  state.sent.set(key, Date.now());

  const otp = String(randomInt(100000, 1000000));
  const token = await new SignJWT({ k: key, h: hashCode(key, otp) })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(randomUUID())
    .setAudience('otp')
    .setIssuedAt()
    .setExpirationTime(`${CODE_TTL}s`)
    .sign(signingKey());
  return { otp, token };
}

/** Lifts the one-minute limit again, e.g. when sending the code failed so the client can retry straight away. */
export function releaseOtp(key) {
  state.sent.delete(norm(key));
}

/**
 * Checks `otp` against the `token` issued for `key`. `consume` uses the token up (only on submit).
 * → { success: true } or { success: false, reason: 'invalid' | 'expired' }
 */
export async function verifyOtp(key, otp, token, { consume = false } = {}) {
  key = norm(key);
  prune();
  let payload;
  try {
    ({ payload } = await jwtVerify(String(token ?? ''), signingKey(), { algorithms: ['HS256'], audience: 'otp' }));
  } catch {
    return { success: false, reason: 'expired' }; // missing, tampered with or older than 10 minutes
  }
  // a code sent to another number (the client changed it afterwards) doesn't count for this one
  if (payload.k !== key || state.used.has(payload.jti)) return { success: false, reason: 'expired' };
  const tries = state.tries.get(payload.jti);
  if (tries?.n >= MAX_TRIES) return { success: false, reason: 'expired' };

  const given = Buffer.from(hashCode(key, String(otp ?? '')));
  const expected = Buffer.from(String(payload.h ?? ''));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    state.tries.set(payload.jti, { n: (tries?.n ?? 0) + 1, exp: payload.exp });
    return { success: false, reason: 'invalid' };
  }
  if (consume) state.used.set(payload.jti, { exp: payload.exp });
  return { success: true };
}
