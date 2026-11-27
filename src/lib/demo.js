import 'server-only';
import { randomInt } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';
import countries from 'i18n-iso-countries';
import { decryptField } from '@/lib/fieldCrypto';

/**
 * Demo mode (CAT5_DEMO_MODE=true in .env) for testing the account opening without Shufti Pro:
 *   · every applicant counts as verified (src/lib/user.js), the Shufti verification is skipped
 *     (src/app/actions/verification.js) and the client goes straight to /success;
 *   · the account opening (src/lib/accountOpening.js) uses a made-up accepted verification built from the application,
 *     with generated placeholder images for the ID card and proof of address;
 *   · MAX: the real API when CAT5_API_BASE_URL / CAT5_SIGN_KEY are set, otherwise its answers are simulated here and the
 *     request is printed in the server console. The password e-mail is sent for real.
 * Never turn it on in production: nobody's identity is checked.
 */
export const demoMode = () => process.env.CAT5_DEMO_MODE === 'true';

const COLOURS = { front: [41, 59, 147], back: [182, 135, 86], poa: [21, 122, 82] };
const image = (colour) => async () => ({ buffer: placeholderPng(colour), contentType: 'image/png' });

/** An accepted verification (the shape of kycRecord in src/lib/accountOpening.js) made from our application row. */
export function demoKycRecord(app) {
  return {
    approved: true,
    document: {
      number: app.idNumberEncrypted ? decryptField(app.idNumberEncrypted) : 'DEMO-ID-0001',
      type: 'id_card',
      firstName: app.firstName,
      lastName: app.lastName,
      dob: String(app.dateOfBirth ?? '').slice(0, 10),
      nationality: countries.alpha2ToAlpha3(app.nationality) ?? undefined
    },
    files: { front: image(COLOURS.front), back: image(COLOURS.back), poa: [image(COLOURS.poa)] }
  };
}

// a 640×400 PNG: a coloured band on white, so each placeholder is a real, different image
function placeholderPng([r, g, b]) {
  const width = 640;
  const height = 400;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const band = y < 90 || (y > 300 && y < 320);
    for (let x = 0; x < width; x++) {
      const o = y * (width * 3 + 1) + 1 + x * 3;
      [rows[o], rows[o + 1], rows[o + 2]] = band ? [r, g, b] : [245, 246, 250];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** MAX's answers, for demo mode without CAT5_API_BASE_URL: nothing is sent anywhere. */
export const simulatedMax = {
  async uploadFile(_email, { name, contentType }) {
    return `https://files.demo.invalid/${name}.${contentType === 'application/pdf' ? 'pdf' : 'png'}`;
  },
  async onboardCustomer(payload) {
    const shown = { ...payload, password: '***' };
    console.info('[max demo] simulated onboarding request:\n' + JSON.stringify(shown, null, 2));
    return { code: 200, registered: true, member_id: 900000 + randomInt(100000), external_customer_id: payload.external_customer_id, kyc_status: 9, idempotent: false, duplicate_member_ids: [], truncated: false };
  }
};
