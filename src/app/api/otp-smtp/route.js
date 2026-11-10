import { NextResponse } from 'next/server';
import { issueOtp, releaseOtp } from '@/lib/otpStore';
import { validateBusinessEmail } from '@/lib/emailValidation';
import { sendOtpEmail } from '@/lib/otpEmail';

export const runtime = 'nodejs';

/**
 * POST { email, first_name? } → emails a 6-digit code (src/lib/otpEmail.js). The response carries a signed token
 * (src/lib/otpStore.js) that the form sends back with the code; the code itself is never returned to the browser. No database.
 * (The application form asks for an e-mail code only when the e-mail already has an application.)
 * → { success: true, token } or { success: false, message, reason? } (reason 'wait' + retryIn seconds when asked again within a minute)
 */
export async function POST(req) {
  let email;
  try {
    const body = await req.json().catch(() => ({}));
    email = String(body?.email ?? '').trim().toLowerCase();
    const first_name = String(body?.first_name ?? '').trim().slice(0, 80);
    const check = validateBusinessEmail(email);
    if (!check.valid) return NextResponse.json({ success: false, reason: check.reason, message: 'Invalid email address' }, { status: 400 });

    const created = await issueOtp(email);
    if (created.error === 'wait') {
      return NextResponse.json({ success: false, reason: 'wait', retryIn: created.retryIn, message: 'Please wait before requesting a new code' }, { status: 429 });
    }
    const { otp, token } = created;
    await sendOtpEmail({ email, firstName: first_name, otp });
    return NextResponse.json({ success: true, message: 'OTP sent', token });
  } catch (error) {
    console.error('OTP email error:', error?.message || error);
    // let the client ask again straight away instead of waiting out the one-minute limit
    if (email) releaseOtp(email);
    return NextResponse.json({ success: false, message: 'Error Sending OTP' }, { status: 500 });
  }
}
