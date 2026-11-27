'use server';

import { headers } from 'next/headers';
import { getCurrentUser } from '@/lib/user';
import { shuftiConfigured } from '@/lib/shufti';
import { syncVerification as syncFromShufti, verificationLink } from '@/lib/verification';
import { demoMode } from '@/lib/demo';

/**
 * Shufti Pro verification (src/app/components/ShuftiVerification.jsx) for the signed-in client — the session is created
 * when the application is submitted, so only the client themself can get the link for their application.
 *   getVerificationLink → { url } | { status } (already submitted / decided) | { error, code: 'session' | 'not_configured' | 'failed' }
 *   syncVerification    → { status } (our status, see statusFromEvent in src/lib/shufti.js)
 */
async function origin() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? (/^(localhost|127\.)/.test(host ?? '') ? 'http' : 'https');
  return host ? `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}` : null;
}

export async function getVerificationLink() {
  const user = await getCurrentUser();
  if (!user) return { code: 'session', error: 'Your session has expired. Please submit the application again or contact us.' };
  if (demoMode()) return { demo: true, status: 'approved' }; // no Shufti: verified straight away (src/lib/demo.js)
  if (!shuftiConfigured()) {
    console.warn('[shufti] SHUFTI_CLIENT_ID / SHUFTI_SECRET_KEY are not set');
    return { code: 'not_configured', error: 'Identity verification is not available right now. Our team will contact you.' };
  }
  try {
    return await verificationLink(user.id, await origin());
  } catch (err) {
    console.error('[shufti] verification link:', err.message);
    return { code: 'failed', error: 'We could not start the verification. Please try again in a moment.' };
  }
}

export async function syncVerification() {
  const user = await getCurrentUser();
  if (user && demoMode()) return { status: 'approved' };
  if (!user || !shuftiConfigured()) return { status: null };
  try {
    return { status: await syncFromShufti(user.id) };
  } catch (err) {
    console.error('[shufti] sync:', err.message);
    return { status: null };
  }
}
