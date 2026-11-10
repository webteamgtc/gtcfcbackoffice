import 'server-only';

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * E-mails a one-time code (Mailgun), for the application form (POST /api/otp-smtp) and the status sign-in
 * (actions/auth.js). Without MAILGUN_API_KEY in development the code is printed to the server console instead.
 */
export async function sendOtpEmail({ email, firstName, otp }) {
  if (!process.env.MAILGUN_API_KEY) {
    if (process.env.NODE_ENV !== 'production') return console.warn(`[otp] MAILGUN_API_KEY not set — OTP for ${email}: ${otp}`);
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
          <h3 style="font-size:16px;color:#192055;">Dear <em>${esc(firstName || 'Client')}</em>,</h3>
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
}
