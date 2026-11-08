import { countryByCode } from '@/lib/countries';

/** Small display helpers for the administrator pages (all run on the server). */

export const TIME_ZONE = 'Asia/Dubai';

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** 07 Nov 2026, 14:32 (Dubai time) */
export function dateTime(v) {
  const d = toDate(v);
  return d ? d.toLocaleString('en-GB', { timeZone: TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
}

/** 07 Nov 2026 */
export function dateOnly(v) {
  if (!v) return '—';
  // a plain "YYYY-MM-DD" (date of birth, proof date) is shown as written, with no time-zone shift
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, day] = v.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
  }
  const d = toDate(v);
  return d ? d.toLocaleDateString('en-GB', { timeZone: TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

/** "5 minutes ago", "3 days ago" */
export function ago(v) {
  const d = toDate(v);
  if (!d) return '';
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return 'just now';
  const units = [
    [60, 'minute'],
    [60 * 60, 'hour'],
    [60 * 60 * 24, 'day'],
    [60 * 60 * 24 * 30, 'month'],
    [60 * 60 * 24 * 365, 'year']
  ];
  let best = units[0];
  for (const u of units) if (s >= u[0]) best = u;
  const n = Math.floor(s / best[0]);
  return `${n} ${best[1]}${n === 1 ? '' : 's'} ago`;
}

export const countryName = (code) => (code ? countryByCode(code)?.name ?? code : '—');
export const countryFlag = (code) => (code ? countryByCode(code)?.flag ?? '' : '');
export const countryLabel = (code) => (code ? `${countryFlag(code)} ${countryName(code)}`.trim() : '—');
export const phoneLabel = (phone, code) => (phone ? `+${countryByCode(code)?.dial ?? ''} ${phone}`.trim() : '—');
export const fullName = (a) => [a.firstName, a.lastName].filter(Boolean).join(' ') || '—';
export const initials = (a) => `${a.firstName?.[0] ?? ''}${a.lastName?.[0] ?? ''}`.toUpperCase() || '?';

const TYPES = { PASSPORT: 'Passport', ID_CARD: 'National ID card', DRIVERS: "Driver's license", RESIDENCE_PERMIT: 'Residence permit', PROOF_OF_ADDRESS: 'Proof of address', BUSINESS_LICENSE: 'Business licence' };
export const docTypeLabel = (t) => TYPES[t] ?? t ?? 'Document';

export const fileSize = (bytes) => {
  const n = Number(bytes) || 0;
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
};

/** "Good morning" / "Good afternoon" / "Good evening" by the hour in Dubai. */
export function greeting() {
  const h = new Date(Date.now() + 4 * 3600 * 1000).getUTCHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** "Sunday, 8 November 2026" in Dubai. */
export const longDate = () => new Date().toLocaleDateString('en-GB', { timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** "anna.smith@gtcfx.com" → "Anna Smith" */
export const displayName = (email) =>
  String(email ?? '')
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(' ') || 'there';

/** Submitted within the last 24 hours. */
export const isNew = (v) => {
  const d = toDate(v);
  return Boolean(d) && Date.now() - d.getTime() < 24 * 3600 * 1000;
};

/** A stable 0–5 per person, so each avatar keeps its colour. */
export const avatarTone = (a) => {
  const s = `${a.firstName ?? ''}${a.lastName ?? ''}${a.id ?? ''}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 6;
};
