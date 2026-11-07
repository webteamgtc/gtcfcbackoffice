import { NextResponse } from 'next/server';
import { issueOtp, releaseOtp } from '@/lib/otpStore';
import { validateBusinessEmail } from '@/lib/emailValidation';

export const runtime = 'nodejs';

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * POST { email, first_name? } → emails a 6-digit code (Mailgun). The response carries a signed token (src/lib/otpStore.js)
 * that the form sends back with the code; the code itself is never returned to the browser. No database.
 * (The application form doesn't ask for an e-mail code at the moment: only the WhatsApp code is used.)
 * → { success: true, token } or { success: false, message, reason? } (reason 'wait' + retryIn seconds when asked again within a minute)
 * Without MAILGUN_API_KEY in development the code is printed to the server console instead of e-mailed.
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

    if (!process.env.MAILGUN_API_KEY) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[otp-smtp] MAILGUN_API_KEY not set — OTP for ${email}: ${otp}`);
        return NextResponse.json({ success: true, message: 'OTP sent', token });
      }
      throw new Error('MAILGUN_API_KEY is not set');
    }

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Your GTCFX OTP</title></head>
<body style="margin:0;padding:0;background-color:#F7F7F7;font-family:Arial,sans-serif;color:#000;line-height:22px;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="width:100%;"><tr><td align="center" bgcolor="#F7F7F7">
    <div style="max-width:550px;margin:0 auto;background-color:#192055;padding:5px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-radius:36px;padding:20px;background-color:#fff;width:100%;">
        <tr><td style="padding:20px;text-align:center;"><img src="https://gtcfx-bucket.s3.ap-southeast-1.amazonaws.com/email-test.png" alt="GTCFX" style="max-width:165px;height:auto;"></td></tr>
        <tr><td>
          <h2 style="color:#fff;text-align:center;font-size:16px;margin:0 auto 39px;padding:10px;background:#192055;border-radius:27px;max-width:68%;">Your GTCFX OTP</h2>
          <h3 style="font-size:16px;color:#192055;">Dear <em>${esc(first_name || 'Client')}</em>,</h3>
          <p>Thank you for choosing GTCFX.</p>
          <p>Please use the following One-Time Password</p>
          <p><strong style="font-size:25px;font-weight:800;color:#192055;letter-spacing:4px;">${otp}</strong></p>
          <p>to complete your request. The code expires in 10 minutes.</p>
          <p>If you have any questions, contact us at <a href="mailto:support@gtcfx.com" style="color:#5166ff;">support@gtcfx.com</a>.</p>
          <p style="line-height:30px;padding-top:20px;">Best Regards,<br><strong style="color:#192055;">GTCFX Team</strong></p>
        </td></tr>
        <tr><td style="padding:20px 0;font-size:9px;line-height:13px;color:#000;">
          <p>Company name: GTC FX / Website: www.gtcfx.com / Email: support@gtcfx.com</p>
          <p>Disclaimers: The information in this email is for general purposes only and does not constitute personal financial advice. Investing in contract for difference products carries significant risks and may not be suitable for all investors.</p>
          <p>Note that our products and services are not available in restricted countries.</p>
        </td></tr>
      </table>
    </div>
  </td></tr></table>
</body></html>`;

    // loaded here: the Mailgun client throws on import when MAILGUN_API_KEY is missing
    const { MAILGUN_DOMAIN, MAILGUN_FROM, mailgunClient } = await import('@/config/nodemailer');
    await mailgunClient.messages.create(MAILGUN_DOMAIN, { from: MAILGUN_FROM, to: email, subject: 'Your GTCFX OTP Code', text: `Your OTP is ${otp}`, html });
    return NextResponse.json({ success: true, message: 'OTP sent', token });
  } catch (error) {
    console.error('OTP email error:', error?.message || error);
    // let the client ask again straight away instead of waiting out the one-minute limit
    if (email) releaseOtp(email);
    return NextResponse.json({ success: false, message: 'Error Sending OTP' }, { status: 500 });
  }
}
