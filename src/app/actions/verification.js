'use server';

import { getCurrentUser } from '@/lib/user';
import { createSdkToken, sumsubConfigured } from '@/lib/sumsub';
import { syncFromSumsub } from '@/lib/verification';
import { demoMode } from '@/lib/demo';

/**
 * Sumsub WebSDK (src/app/components/SumsubVerification.jsx) for the signed-in client — the session is created when the
 * application is submitted, so only the client themself can get a token for their applicant.
 *   getVerificationToken → { token } | { error, code: 'session' | 'not_configured' | 'failed' }
 *   syncVerification     → { status } (our status, see statusFromReview in src/lib/sumsub.js)
 */
export async function getVerificationToken() {
  const user = await getCurrentUser();
  if (!user) return { code: 'session', error: 'Your session has expired. Please submit the application again or contact us.' };
  if (demoMode()) return { demo: true, status: 'approved' }; // no Sumsub: verified straight away (src/lib/demo.js)
  if (!sumsubConfigured()) {
    console.warn('[sumsub] SUMSUB_APP_TOKEN / SUMSUB_SECRET_KEY are not set');
    return { code: 'not_configured', error: 'Identity verification is not available right now. Our team will contact you.' };
  }
  try {
    return { token: await createSdkToken({ userId: user.id, email: user.email, phone: user.phone }) };
  } catch (err) {
    console.error('[sumsub] access token:', err.message);
    return { code: 'failed', error: 'We could not start the verification. Please try again in a moment.' };
  }
}

export async function syncVerification() {
  const user = await getCurrentUser();
  if (user && demoMode()) return { status: 'approved' };
  if (!user || !sumsubConfigured()) return { status: null };
  try {
    return { status: await syncFromSumsub(user.id) };
  } catch (err) {
    console.error('[sumsub] sync:', err.message);
    return { status: null };
  }
}
