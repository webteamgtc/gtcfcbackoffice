import 'server-only';
import { randomUUID } from 'node:crypto';
import OSS from 'ali-oss';


/**
 * Document files in Alibaba Cloud OSS. Configure in .env:
 *   OSS_REGION (Dubai: oss-me-east-1), OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET (a RAM user with
 *   oss:PutObject / GetObject / DeleteObject on the bucket), OSS_PREFIX (folder for client files, default client-documents/)
 * Every object is written private, whatever the bucket's default ACL: KYC files are only ever reached through
 * short-lived signed URLs (signedUrl).
 */
const PREFIX = (process.env.OSS_PREFIX || 'client-documents/').replace(/^\/+/, '');

export const storageConfigured = () => Boolean(process.env.OSS_BUCKET && process.env.OSS_ACCESS_KEY_ID && process.env.OSS_ACCESS_KEY_SECRET);

// one client across hot reloads in dev and across requests in prod
const globalForOss = globalThis;

function client() {
  if (!storageConfigured()) throw new Error('OSS is not configured (OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET)');
  globalForOss._ossClient ??= new OSS({
    region: process.env.OSS_REGION || 'oss-me-east-1',
    bucket: process.env.OSS_BUCKET,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    secure: true,
    timeout: 60000
  });
  return globalForOss._ossClient;
}

const EXT = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };

/** Object key for a client's file, e.g. client-documents/42/2026-11-06-<uuid>.pdf (no client-supplied text in the key). */
export const documentKey = (applicationId, contentType) =>
  `${PREFIX}${applicationId}/${new Date().toISOString().slice(0, 10)}-${randomUUID()}${EXT[contentType] ?? ''}`;

export async function putObject(key, body, contentType) {
  await client().put(key, body, {
    mime: contentType,
    headers: { 'x-oss-object-acl': 'private', 'x-oss-forbid-overwrite': 'true' }
  });
}

export async function deleteObject(key) {
  await client().delete(key);
}

/** Temporary download link (default 5 minutes), offered as an attachment named `filename`. */
export function signedUrl(key, { expires = 300, filename } = {}) {
  return client().signatureUrl(key, {
    expires,
    ...(filename ? { response: { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` } } : {})
  });
}
