import 'server-only';
import { BRAND } from '@/lib/brand';

/**
 * Outgoing e-mail through Mailgun (client and sender in src/config/nodemailer.js; same as POST /api/otp-smtp).
 * Needs MAILGUN_API_KEY in .env.
 */
export const mailConfigured = () => Boolean(process.env.MAILGUN_API_KEY);

export async function sendMail({ to, subject, text, html }) {
  if (!mailConfigured()) throw new Error('MAILGUN_API_KEY is not set');
  // loaded here: the Mailgun client throws on import when MAILGUN_API_KEY is missing
  const { MAILGUN_DOMAIN, MAILGUN_FROM, mailgunClient } = await import('@/config/nodemailer');
  await mailgunClient.messages.create(MAILGUN_DOMAIN, { from: MAILGUN_FROM, to, subject, text, html });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// one simple branded layout for every message
function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#141a2e">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0b1440;padding:22px 28px;color:#e3c398;font-weight:bold;font-size:16px">${esc(BRAND.name)}</td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.6"><h1 style="margin:0 0 14px;font-size:20px">${esc(title)}</h1>${bodyHtml}</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #e6e9f1;font-size:12px;color:#646b82">© ${new Date().getFullYear()} ${esc(BRAND.legalName)}</td></tr>
</table></td></tr></table></body></html>`;
}

export function applicationReceivedEmail({ name, reference }) {
  return {
    subject: `We've received your application | ${BRAND.name}`,
    text: `Hello ${name},\n\nThank you. We've received your application and your documents (reference ${reference}).\n\nOur team will review them and contact you about the next steps.\n\n${BRAND.name}`,
    html: layout(
      'Application received',
      `<p>Hello ${esc(name)},</p><p>Thank you. We've received your application and your documents.</p>
<p style="margin:18px 0;padding:12px 16px;background:#f6eee4;border-radius:10px">Reference: <strong>${esc(reference)}</strong></p>
<p>Our team will review them and contact you about the next steps.</p>`
    )
  };
}
