import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Shufti Pro (identity + address verification) server API. Configure in .env:
 *   SHUFTI_CLIENT_ID      Client ID (Shufti back office → Settings → API keys)
 *   SHUFTI_SECRET_KEY     the Secret Key shown with it (server only)
 *   SHUFTI_BASE_URL       optional, default https://api.shuftipro.com
 *   SHUFTI_TTL_MINUTES    optional, how long a verification link stays valid (default 60)
 *   SHUFTI_ADDRESS_TYPES  optional, accepted proof of address documents, comma separated (default utility_bill,bank_statement)
 *   SHUFTI_AML            optional, "true" adds Shufti's AML background check (name + date of birth) to the verification
 *   SHUFTI_CALLBACK_URL   optional, public URL of POST /api/shufti/callback; defaults to this site's when it isn't localhost
 * Every request uses HTTP Basic auth (Client ID : Secret Key). Responses and callbacks carry a `Signature` header:
 * sha256(raw body + sha256(secret key)), hex (accounts made before that scheme: sha256(raw body + secret key)).
 * One verification request per attempt, identified by our `reference` (unique for ever at Shufti, max 250 characters).
 */
const BASE = (process.env.SHUFTI_BASE_URL || 'https://api.shuftipro.com').replace(/\/+$/, '');

export const shuftiConfigured = () => Boolean(process.env.SHUFTI_CLIENT_ID && process.env.SHUFTI_SECRET_KEY);
export const linkTtlMinutes = () => Math.max(10, Number(process.env.SHUFTI_TTL_MINUTES) || 60);

const auth = () => 'Basic ' + Buffer.from(`${process.env.SHUFTI_CLIENT_ID}:${process.env.SHUFTI_SECRET_KEY}`).toString('base64');

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** True when `signature` (the Signature header) matches the raw body (Buffer or string) of a response or callback. */
export function validSignature(rawBody, signature) {
  const secret = process.env.SHUFTI_SECRET_KEY;
  if (!secret || !signature) return false;
  const given = Buffer.from(String(signature).trim().toLowerCase());
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  return [sha256(Buffer.concat([body, Buffer.from(sha256(secret))])), sha256(Buffer.concat([body, Buffer.from(secret)]))].some((hex) => {
    const expected = Buffer.from(hex);
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

export class ShuftiError extends Error {
  constructor(message, { status = null, data = null } = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function post(path, body) {
  if (!shuftiConfigured()) throw new ShuftiError('Shufti Pro is not configured (SHUFTI_CLIENT_ID / SHUFTI_SECRET_KEY)');
  let res;
  try {
    res = await fetch(BASE + path, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: auth() },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(60_000)
    });
  } catch (err) {
    throw new ShuftiError(`Shufti ${path}: ${err.message}${err.cause?.code ? ` (${err.cause.code})` : ''}`);
  }
  const raw = Buffer.from(await res.arrayBuffer());
  let data = null;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch {
    // not JSON (e.g. a firewall page)
  }
  const signature = res.headers.get('signature');
  // answers are signed; one that is signed wrongly did not come from Shufti (a missing signature is logged, not fatal)
  if (signature && !validSignature(raw, signature)) throw new ShuftiError(`Shufti ${path}: response signature does not match`, { status: res.status });
  if (!signature && res.ok) console.warn(`[shufti] ${path}: response without a Signature header`);
  if (!data) throw new ShuftiError(`Shufti ${path} → HTTP ${res.status}, no JSON answer`, { status: res.status });
  if (!res.ok || ['request.invalid', 'request.unauthorized'].includes(data.event)) {
    const e = data.error ?? {};
    const detail = [e.service, e.key, e.message].filter(Boolean).join(' / ') || data.event || `HTTP ${res.status}`;
    throw new ShuftiError(`Shufti ${path}: ${detail}`, { status: res.status, data });
  }
  return data;
}

const list = (s, fallback) =>
  String(s || fallback)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Starts an on-site verification (ID document with OCR, selfie, proof of address) → { reference, event, verificationUrl }.
 * Blank fields in the services ask Shufti to read them from the document; only the address is given (`fullAddress`, the
 * residential address from our form), because Shufti's address check requires one to compare the proof of address with.
 * `country`: ISO alpha-2 of residence (limits nothing, preselects); `redirectUrl`: where Shufti sends the browser (inside
 * the iframe) when the client is done; `callbackUrl`: our webhook (left out when there is no public URL, e.g. localhost).
 */
export async function createVerification({ reference, email, country, language = 'EN', redirectUrl, callbackUrl, firstName, lastName, dob, fullAddress }) {
  const payload = {
    reference,
    email: email ?? '',
    country: country ?? '',
    language,
    verification_mode: 'any',
    allow_offline: '1',
    allow_online: '1',
    allow_retry: '1',
    show_privacy_policy: '1',
    show_results: '1',
    show_consent: '1',
    show_feedback_form: '0',
    ttl: linkTtlMinutes(),
    ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
    ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    face: '',
    document: {
      name: '',
      dob: '',
      gender: '',
      place_of_issue: '',
      document_number: '',
      expiry_date: '',
      issue_date: '',
      fetch_enhanced_data: '1',
      supported_types: ['id_card', 'passport', 'driving_license']
    },
    // Shufti's standard address check compares the proof of address with this address (required), loosely
    address: {
      name: '',
      full_address: fullAddress ?? '',
      address_fuzzy_match: '1',
      issue_date: '',
      supported_types: list(process.env.SHUFTI_ADDRESS_TYPES, 'utility_bill,bank_statement')
    },
    ...(process.env.SHUFTI_AML === 'true' ? { background_checks: { name: { first_name: firstName ?? '', last_name: lastName ?? '' }, dob: dob ?? '' } } : {})
  };
  const data = await post('/', payload);
  if (!data.verification_url) throw new ShuftiError(`Shufti did not return a verification link (event ${data.event})`, { data });
  return { reference: data.reference ?? reference, event: data.event, verificationUrl: data.verification_url };
}

/** The current state of a request: { reference, event, verification_result, verification_data, declined_reason, declined_codes, proofs, … } */
export const getStatus = (reference) => post('/status', { reference });

/**
 * One proof (document image, selfie, …) from the status answer → { buffer, contentType }. The links are fetched with our
 * credentials and the access token that comes with them.
 */
export async function downloadProof(url, accessToken) {
  const u = new URL(url);
  if (accessToken && !u.searchParams.has('access_token')) u.searchParams.set('access_token', accessToken);
  let res;
  try {
    res = await fetch(u, { headers: { Authorization: auth(), Accept: '*/*' }, cache: 'no-store', signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new ShuftiError(`Shufti proof download: ${err.message}`);
  }
  if (!res.ok) throw new ShuftiError(`Shufti proof download → HTTP ${res.status}`, { status: res.status });
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() };
}

/**
 * Our status from a Shufti event:
 *   started  (link created; the client hasn't finished, or it expired / was cancelled and a new one is needed)
 *   pending  (submitted, being reviewed) · approved (verification.accepted) · rejected (verification.declined)
 * null: an event that says nothing about the result (e.g. verification.status.changed: ask /status).
 */
export function statusFromEvent(event) {
  switch (event) {
    case 'verification.accepted':
      return 'approved';
    case 'verification.declined':
      return 'rejected';
    case 'request.received':
    case 'review.pending':
      return 'pending';
    case 'request.pending':
    case 'request.timeout':
    case 'verification.cancelled':
    case 'request.deleted':
      return 'started';
    default:
      return null;
  }
}

/** Events after which the link can't be used any more: the next visit starts a new request. */
export const LINK_ENDED = ['request.timeout', 'verification.cancelled', 'request.deleted', 'request.invalid'];
