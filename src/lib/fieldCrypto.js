import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encryption for sensitive columns (client_applications.idNumberEncrypted / tinEncrypted): "versioned authenticated
 * ciphertext" = AES-256-GCM, stored as one binary value:
 *   [1 byte version][12 bytes IV][16 bytes auth tag][ciphertext]
 * The key is FIELD_ENCRYPTION_KEY (32 bytes, base64). Keep it safe and backed up: without it the values can't be read.
 * To rotate, add a new version with its own key here and keep decrypting the old one.
 */
const VERSION = 1;
const KEYS = { 1: 'FIELD_ENCRYPTION_KEY' };

function key(version) {
  const raw = Buffer.from(process.env[KEYS[version]] ?? '', 'base64');
  if (raw.length !== 32) throw new Error(`${KEYS[version] ?? 'Encryption key'} must be 32 bytes, base64-encoded`);
  return raw;
}

export function encryptField(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(VERSION), iv);
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), data]);
}

export function decryptField(value) {
  const buf = Buffer.from(value);
  const version = buf[0];
  if (!KEYS[version]) throw new Error(`Unknown ciphertext version ${version}`);
  const decipher = createDecipheriv('aes-256-gcm', key(version), buf.subarray(1, 13));
  decipher.setAuthTag(buf.subarray(13, 29));
  return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]).toString('utf8');
}
