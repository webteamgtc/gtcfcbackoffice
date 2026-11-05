import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Sumsub (identity + address verification) server API. Configure in .env:
 *   SUMSUB_APP_TOKEN       App token (Dashboard → Dev space → App tokens); sandbox tokens start with "sbx:"
 *   SUMSUB_SECRET_KEY      the secret key shown with that token
 *   SUMSUB_LEVEL_NAME      verification level, default CAT_5_ID_POA (case-sensitive, must exist in the same environment)
 *   SUMSUB_WEBHOOK_SECRET  secret key of the webhook (Dev space → Webhooks) → POST /api/sumsub/webhook
 *   SUMSUB_BASE_URL        optional, default https://api.sumsub.com
 * Requests are signed: X-App-Access-Sig = HMAC-SHA256(secret, ts + METHOD + path + body), hex.
 */
const BASE = process.env.SUMSUB_BASE_URL || 'https://api.sumsub.com';
export const SUMSUB_LEVEL = process.env.SUMSUB_LEVEL_NAME || 'CAT_5_ID_POA';

export const sumsubConfigured = () => Boolean(process.env.SUMSUB_APP_TOKEN && process.env.SUMSUB_SECRET_KEY);

async function request(method, path, body) {
  if (!sumsubConfigured()) throw new Error('Sumsub is not configured (SUMSUB_APP_TOKEN / SUMSUB_SECRET_KEY)');
  const ts = Math.floor(Date.now() / 1000).toString();
  const payload = body === undefined ? '' : JSON.stringify(body);
  const sig = createHmac('sha256', process.env.SUMSUB_SECRET_KEY).update(ts + method + path + payload).digest('hex');
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
      'X-App-Token': process.env.SUMSUB_APP_TOKEN,
      'X-App-Access-Ts': ts,
      'X-App-Access-Sig': sig
    },
    body: payload || undefined,
    cache: 'no-store'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Sumsub ${method} ${path} → ${res.status}: ${data?.description ?? 'request failed'}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** WebSDK access token for our user (their id becomes the applicant's externalUserId). */
export async function createSdkToken({ userId, email, phone, ttlInSecs = 1800 }) {
  const { token } = await request('POST', '/resources/accessTokens/sdk', {
    userId,
    levelName: SUMSUB_LEVEL,
    ttlInSecs,
    applicantIdentifiers: { ...(email ? { email } : {}), ...(phone ? { phone: phone.replace(/\s/g, '') } : {}) }
  });
  return token;
}

/** The applicant created for our user, or null before they have started the WebSDK. */
export async function getApplicantByUserId(userId) {
  try {
    return await request('GET', `/resources/applicants/-;externalUserId=${encodeURIComponent(userId)}/one`);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

const DIGEST_ALGS = { HMAC_SHA1_HEX: 'sha1', HMAC_SHA256_HEX: 'sha256', HMAC_SHA512_HEX: 'sha512' };

/** Checks a webhook's X-Payload-Digest: HMAC of the raw body (bytes, not re-serialised JSON) with the webhook secret. */
export function verifyWebhook(rawBody, digest, alg = 'HMAC_SHA256_HEX') {
  const secret = process.env.SUMSUB_WEBHOOK_SECRET;
  const algorithm = DIGEST_ALGS[alg];
  if (!secret || !algorithm || !digest) return false;
  const expected = Buffer.from(createHmac(algorithm, secret).update(rawBody).digest('hex'));
  const given = Buffer.from(String(digest).toLowerCase());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Our status from Sumsub's review:
 *   started (documents not submitted yet) · pending (under review / on hold) · approved (GREEN)
 *   resubmit (RED + RETRY: the client can upload again) · rejected (RED + FINAL)
 */
export function statusFromReview({ reviewStatus, reviewResult } = {}) {
  if (reviewStatus === 'completed') {
    if (reviewResult?.reviewAnswer === 'GREEN') return 'approved';
    if (reviewResult?.reviewAnswer === 'RED') return reviewResult.reviewRejectType === 'RETRY' ? 'resubmit' : 'rejected';
  }
  if (['pending', 'queued', 'prechecked', 'onHold', 'awaitingService'].includes(reviewStatus)) return 'pending';
  return 'started';
}
