import { EMAIL_RE } from '@/lib/application';

// throwaway inboxes we don't send codes to
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org',
  'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com',
  'mohmal.com', 'emailondeck.com', 'burnermail.io', 'tempail.com', 'mailnesia.com'
]);

/** → { valid: true } or { valid: false, reason: 'missing' | 'format' | 'disposable' } */
export function validateBusinessEmail(email) {
  const value = String(email ?? '').trim().toLowerCase();
  if (!value) return { valid: false, reason: 'missing' };
  if (value.length > 160 || !EMAIL_RE.test(value)) return { valid: false, reason: 'format' };
  if (DISPOSABLE.has(value.split('@')[1])) return { valid: false, reason: 'disposable' };
  return { valid: true };
}
