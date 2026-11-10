import 'server-only';
import { createHash } from 'node:crypto';

/**
 * MAX CAT-5 customer import API (public/CAT5_Customer_Import_API_English.md). Configure in .env:
 *   CAT5_API_BASE_URL  the domain MAX gives for the environment, e.g. https://max.example.com (paths are appended)
 *   CAT5_SIGN_KEY      the shared sign_key (server only; never sent)
 * Every request is signed: X-CAT5-Signature = md5(lowercase(trim(email)) + timestamp + sign_key), with a fresh
 * timestamp per request. Success is read from `code` in the body, never from the HTTP status.
 */
export const cat5Configured = () => Boolean(process.env.CAT5_API_BASE_URL && process.env.CAT5_SIGN_KEY);

// what MAX accepts for uploads: content type → extension (Sumsub serves images and PDFs)
const FILE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/bmp': 'bmp', 'application/pdf': 'pdf' };
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export class Cat5Error extends Error {
  constructor(message, { code = null, data = null } = {}) {
    super(message);
    this.code = code; // MAX result code (33602 …) or null for network / HTTP failures
    this.data = data;
  }
}

const normEmail = (email) => String(email ?? '').trim().toLowerCase();

function signedHeaders(email) {
  if (!cat5Configured()) throw new Cat5Error('CAT5_API_BASE_URL / CAT5_SIGN_KEY are not set');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHash('md5').update(normEmail(email) + timestamp + process.env.CAT5_SIGN_KEY).digest('hex');
  return { 'X-CAT5-Timestamp': timestamp, 'X-CAT5-Signature': signature };
}

async function post(path, email, { body, headers = {} }) {
  const url = process.env.CAT5_API_BASE_URL.replace(/\/+$/, '') + path;
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { Accept: 'application/json', ...headers, ...signedHeaders(email) }, body, cache: 'no-store', signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new Cat5Error(`MAX ${path}: ${err.message}`);
  }
  const json = await res.json().catch(() => null);
  if (!json || typeof json.code !== 'number') {
    // MAX's firewall answers with an HTML page: say so, with the Ray ID MAX needs to find the block
    const ray = res.headers.get('cf-ray');
    const blocked = ray && res.status === 403 ? ` (blocked by Cloudflare in front of MAX, Ray ID ${ray}: MAX must allow this server's IP)` : '';
    throw new Cat5Error(`MAX ${path} → HTTP ${res.status}, no result code${blocked}`);
  }
  return json;
}

/** Uploads one file → its HTTPS URL (data.file_path). */
export async function uploadFile(email, { buffer, contentType, name }) {
  const ext = FILE_TYPES[contentType];
  if (!ext) throw new Cat5Error(`MAX does not accept ${contentType || 'unknown'} files (${name})`, { code: 33603 });
  if (buffer.length > MAX_FILE_BYTES) throw new Cat5Error(`${name} is larger than 20 MB`, { code: 33603 });
  const form = new FormData();
  form.append('email', normEmail(email));
  form.append('file', new Blob([buffer], { type: contentType }), `${name}.${ext}`);
  const res = await post('/api/cat5/upload_file', email, { body: form }); // fetch sets the multipart boundary
  if (res.code !== 200 || !res.data?.file_path) throw new Cat5Error(`MAX upload of ${name}: ${res.message}`, { code: res.code, data: res.data });
  return res.data.file_path;
}

/** Creates the verified customer. → data ({ registered, member_id, duplicate_member_ids, idempotent, … }) */
export async function onboardCustomer(payload) {
  const res = await post('/api/cat5/onboarding', payload.email, { body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
  // 200 created, 33601 created with a duplicate-name warning
  if ((res.code === 200 || res.code === 33601) && res.data?.registered) return { code: res.code, ...res.data };
  throw new Cat5Error(`MAX onboarding: ${res.message}`, { code: res.code, data: res.data });
}
