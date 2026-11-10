import 'server-only';
import { randomInt } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';
import countries from 'i18n-iso-countries';
import { decryptField } from '@/lib/fieldCrypto';

/**
 * Demo mode (CAT5_DEMO_MODE=true in .env) for testing the account opening without Sumsub:
 *   · every applicant counts as verified (src/lib/user.js), the Sumsub WebSDK is skipped (src/app/actions/verification.js)
 *     and the client goes straight to /success;
 *   · the account opening (src/lib/accountOpening.js) uses a made-up approved Sumsub applicant built from the
 *     application, with generated placeholder images for the ID card and proof of address;
 *   · MAX: the real API when CAT5_API_BASE_URL / CAT5_SIGN_KEY are set, otherwise its answers are simulated here and the
 *     request is printed in the server console. The password e-mail is sent for real.
 * Never turn it on in production: nobody's identity is checked.
 */
export const demoMode = () => process.env.CAT5_DEMO_MODE === 'true';

/** An approved Sumsub applicant (same shape as GET /resources/applicants/…/one) made from our application row. */
export function demoApplicant(app) {
  const answer = (value) => ({ value });
  return {
    id: 'demo',
    inspectionId: 'demo',
    externalUserId: String(app.id),
    info: {
      firstNameEn: app.firstName,
      lastNameEn: app.lastName,
      dob: app.dateOfBirth,
      nationality: countries.alpha2ToAlpha3(app.nationality) ?? undefined,
      idDocs: [{ idDocType: 'ID_CARD', number: app.idNumberEncrypted ? decryptField(app.idNumberEncrypted) : 'DEMO-ID-0001' }],
      addresses: [{ country: countries.alpha2ToAlpha3(app.country) ?? 'ARE', postCode: '00000', street: 'Demo Street 1', town: 'Dubai' }]
    },
    questionnaires: [
      {
        id: 'DEMO',
        sections: {
          personalInformation: { items: { jobTiltleProfession: answer('Software Engineer'), title: answer('Manager'), businessActivity: answer('Technology') } },
          taxes: { items: { tin: answer('DEMO-TIN-0001') } },
          politicallyExposedPe: { items: { iDeclareThatIAmAPoli: answer('no'), iDeclareThatIAmClose: answer('no') } }
        }
      }
    ],
    review: { reviewStatus: 'completed', reviewResult: { reviewAnswer: 'GREEN' } }
  };
}

const DEMO_FILES = [
  { id: 'demo-id-front', idDocDef: { idDocType: 'ID_CARD', idDocSubType: 'FRONT_SIDE' }, colour: [41, 59, 147] },
  { id: 'demo-id-back', idDocDef: { idDocType: 'ID_CARD', idDocSubType: 'BACK_SIDE' }, colour: [182, 135, 86] },
  { id: 'demo-poa', idDocDef: { idDocType: 'UTILITY_BILL' }, colour: [21, 122, 82] }
];

/** The demo applicant's uploads (same shape as Sumsub's file list). */
export const demoApplicantFiles = async () => DEMO_FILES.map(({ colour, ...f }) => f);

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

/** One of the demo uploads → { buffer, contentType } */
export async function downloadDemoFile(_inspectionId, id) {
  const file = DEMO_FILES.find((f) => f.id === id);
  return { buffer: placeholderPng(file.colour), contentType: 'image/png' };
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
