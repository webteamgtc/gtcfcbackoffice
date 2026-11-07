import { NextResponse } from 'next/server';
import { issueOtp, phoneKey, releaseOtp } from '@/lib/otpStore';

export const runtime = 'nodejs';

/**
 * POST { phone, locale? } → sends a 6-digit code to the number on WhatsApp (Infobip template). The response carries a
 * signed token (src/lib/otpStore.js, no database) that the form sends back with the code the client typed; the code
 * itself is never returned to the browser or logged.
 * `phone`: international number, "+971501234567" (spaces and dashes are ignored).
 * → { success: true, token } or { success: false, message, reason? } (reason 'wait' + retryIn seconds when asked again within a minute)
 * Configure in .env: INFOBIP_BASE_URL, INFOBIP_API_KEY, INFOBIP_WHATSAPP_SENDER (your WhatsApp Business number),
 * WHATSAPP_TEMPLATE_NAME (an approved authentication template: body "{{1}} is your verification code." + a URL /
 * copy-code button). Without INFOBIP_API_KEY in development the code is printed to the server console instead.
 */
const digits = (value = '') => String(value).replace(/\D/g, '');

export async function POST(req) {
  let phone;
  try {
    const body = await req.json().catch(() => ({}));
    phone = digits(body?.phone);
    // E.164: country code + number, 8–15 digits
    if (phone.length < 8 || phone.length > 15) {
      return NextResponse.json({ success: false, reason: 'format', message: 'Please enter a valid mobile number.' }, { status: 400 });
    }

    const created = await issueOtp(phoneKey(phone));
    if (created.error === 'wait') {
      return NextResponse.json({ success: false, reason: 'wait', retryIn: created.retryIn, message: 'Please wait before requesting a new code' }, { status: 429 });
    }

    if (!process.env.INFOBIP_API_KEY) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[send-phone-otp] INFOBIP_API_KEY not set — WhatsApp code for +${phone}: ${created.otp}`);
        return NextResponse.json({ success: true, message: 'OTP sent via WhatsApp.', token: created.token });
      }
      throw new Error('INFOBIP_API_KEY is not set');
    }

    const message = await sendWhatsappOtp({ phone, otp: created.otp, locale: body?.locale });
    return NextResponse.json({ success: true, message: 'OTP sent via WhatsApp.', token: created.token, providerStatus: message?.status?.name });
  } catch (error) {
    console.error('[send-phone-otp]', error?.message || error);
    // let the client ask again straight away instead of waiting out the one-minute limit
    if (phone) releaseOtp(phoneKey(phone));
    return NextResponse.json({ success: false, message: 'We could not send the code on WhatsApp. Please check the number and try again.' }, { status: 500 });
  }
}

async function sendWhatsappOtp({ phone, otp }) {
  const { INFOBIP_BASE_URL, INFOBIP_API_KEY, INFOBIP_WHATSAPP_SENDER, WHATSAPP_TEMPLATE_NAME } = process.env;
  if (!INFOBIP_BASE_URL) throw new Error('Missing INFOBIP_BASE_URL');
  if (!INFOBIP_WHATSAPP_SENDER) throw new Error('Missing INFOBIP_WHATSAPP_SENDER');
  if (!WHATSAPP_TEMPLATE_NAME) throw new Error('Missing WHATSAPP_TEMPLATE_NAME');

  const from = digits(INFOBIP_WHATSAPP_SENDER);
  if (!from) throw new Error('Invalid WhatsApp sender number');
  const base = INFOBIP_BASE_URL.replace(/\/+$/, '');
  const url = `${base.startsWith('http') ? base : `https://${base}`}/whatsapp/1/message/template`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `App ${INFOBIP_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      messages: [
        {
          from,
          to: phone,
          messageId: `otp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          content: {
            templateName: WHATSAPP_TEMPLATE_NAME,
            templateData: {
              // {{1}} in "{{1}} is your verification code."; the button copies / opens the code
              body: { placeholders: [otp] },
              buttons: [{ type: 'URL', parameter: otp }]
            },
            // must match the template's language in Infobip (an Arabic variant could be chosen from the locale later)
            language: 'en'
          }
        }
      ]
    }),
    cache: 'no-store'
  });

  if (!res.ok) {
    // the error body names the problem (template, sender, number) and never contains the code
    throw new Error(`Infobip WhatsApp error ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = await res.json();
  const message = Array.isArray(data?.messages) ? data.messages[0] : data;
  if (message?.status?.groupName === 'REJECTED') {
    throw new Error(`WhatsApp message rejected: ${message.status.description || message.status.name}`);
  }
  return message;
}
