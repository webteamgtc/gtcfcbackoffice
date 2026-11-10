'use server';

import { redirect } from 'next/navigation';
import { queryOne } from '@/lib/db';
import { createSession, deleteSession } from '@/lib/session';
import { issueOtp, releaseOtp, verifyOtp } from '@/lib/otpStore';
import { sendOtpEmail } from '@/lib/otpEmail';
import { emailError } from '@/lib/application';

/**
 * Status sign-in (src/app/login): a client who has applied enters their e-mail, gets a 6-digit code by e-mail and is
 * signed in with it, then their page ("/", src/app/page.js) shows where they are. No password.
 *   sendStatusCode(email)              → { ok, token } | { error } (the signed token goes back with the code)
 *   verifyStatusCode(email, code, token) → signs in and redirects to the client page "/" | { error }
 * Codes and limits: src/lib/otpStore.js (10 minutes, one per minute, 5 tries); their own key, so a code from the
 * application form doesn't sign anyone in.
 */
const codeKey = (email) => `status:${email}`;
const norm = (email) => String(email ?? '').trim().toLowerCase();
const findApplication = (email) => queryOne('SELECT id, firstName, lastName, email FROM client_applications WHERE email = ?', [email]);
const NOT_FOUND = 'We could not find an application with this email.';
const SERVER = 'Could not reach the server. Please try again.';

export async function sendStatusCode(email) {
  email = norm(email);
  const bad = emailError(email);
  if (bad) return { error: bad };
  try {
    const app = await findApplication(email);
    if (!app) return { error: NOT_FOUND };
    const created = await issueOtp(codeKey(email));
    if (created.error === 'wait') return { error: `A code was just sent. You can ask for a new one in ${created.retryIn} s.`, retryIn: created.retryIn };
    try {
      await sendOtpEmail({ email, firstName: app.firstName, otp: created.otp });
    } catch (err) {
      releaseOtp(codeKey(email));
      throw err;
    }
    return { ok: true, token: created.token };
  } catch (err) {
    console.error('[status] send code:', err?.message || err);
    return { error: 'We could not send the code. Please try again.' };
  }
}

export async function verifyStatusCode(email, code, token) {
  email = norm(email);
  code = String(code ?? '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) return { error: 'Enter the 6-digit code we emailed you.' };
  let app;
  try {
    const check = await verifyOtp(codeKey(email), code, token, { consume: true });
    if (!check.success) return { error: check.reason === 'invalid' ? 'That code is not correct. Please check the email we sent you.' : 'This code has expired. Please request a new one.' };
    app = await findApplication(email);
    if (!app) return { error: NOT_FOUND };
  } catch (err) {
    console.error('[status] verify code:', err?.message || err);
    return { error: SERVER };
  }
  await createSession({ id: String(app.id), name: [app.firstName, app.lastName].filter(Boolean).join(' ') || app.email });
  redirect('/');
}

export async function logout() {
  await deleteSession();
  redirect('/');
}
