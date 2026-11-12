import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { agreementPdf } from '@/lib/agreementPdf';
import { getObject, putObject, storageConfigured } from '@/lib/storage';

/**
 * The client's signed copy of an agreement: the agreement PDF (BRAND.agreements[].url, a file in public/) with the
 * client's name, signature (their name in the script font of the application's signature) and the date written on its
 * signature lines, plus our electronic signature record (agreementPdf) as the last page. Made when the application is
 * submitted (actions/application.js), kept in OSS (OSS_PREFIX<application id>/agreements/…) and sent to MAX
 * (src/lib/accountOpening.js). An agreement without a PDF only gets the signature record.
 *
 * Where to write, per agreement PDF (PDF points, origin bottom left; measured on the file): the English and the Arabic
 * column of the signature box. Replacing the PDF with a new layout means measuring these again.
 */
// (files are read with literal paths, so the build includes exactly these in the server bundle)
const LAYOUTS = {
  '/client-agreement.pdf': {
    read: () => readFile(path.join(process.cwd(), 'public/client-agreement.pdf')),
    page: 10,
    fields: [
      // English: "Name: ____", "Signature: ____", "Date (DD/MM/YYYY): ____"
      { kind: 'name', x: 130, y: 413, width: 114 },
      { kind: 'signature', x: 150, y: 387, width: 112 },
      { kind: 'date', x: 205, y: 348, width: 82 },
      // Arabic: الأسم / التوقيع / التاريخ (the lines run from x≈377 to x≈480)
      { kind: 'name', x: 380, y: 409, width: 106 },
      { kind: 'signature', x: 385, y: 376, width: 92 },
      { kind: 'date', x: 382, y: 344, width: 96 }
    ]
  }
};

const INK = rgb(0.043, 0.078, 0.251);
// the on-screen signature font (src/app/apply, @fontsource/great-vibes); Latin letters only
const scriptFont = () => readFile(path.join(process.cwd(), 'node_modules/@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff'));

const titleCase = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').replace(/(^|[\s'-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase());
// the date on the signature line, in the UAE (DD/MM/YYYY)
const dubaiDate = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

// a font can write `text` when it has every character (the standard fonts: Latin-1 only)
const canWrite = (font, text) => {
  try {
    font.encodeText(text);
    const chars = font.getCharacterSet?.();
    return !chars || [...text].every((c) => c === ' ' || chars.includes(c.codePointAt(0)));
  } catch {
    return false;
  }
};

function fit(font, text, size, width) {
  while (size > 6 && font.widthOfTextAtSize(text, size) > width) size -= 0.5;
  return size;
}

/** → PDF bytes (Buffer) of the signed agreement, or null when the agreement has no PDF to sign. */
export async function signedAgreementPdf({ title, url, name, email, reference, acceptedAt }) {
  const layout = LAYOUTS[url];
  if (!layout) return null;

  const pdf = await PDFDocument.load(await layout.read());
  pdf.registerFontkit(fontkit);
  const plain = await pdf.embedFont(StandardFonts.Helvetica);
  const script = await pdf.embedFont(await scriptFont(), { subset: true }); // subset: written as TrueType (viewers can't read WOFF)
  const page = pdf.getPage(layout.page - 1);
  const signedAt = new Date(acceptedAt);
  const fullName = titleCase(name);

  for (const f of layout.fields) {
    if (f.kind === 'date') {
      const date = dubaiDate(signedAt);
      page.drawText(date, { x: f.x, y: f.y, size: fit(plain, date, 11, f.width), font: plain, color: INK });
      continue;
    }
    // the name in the script font as the signature, in Helvetica as the name; a name neither can write (e.g. Arabic
    // script: no shaping here) is left to the signature record on the last page
    const font = f.kind === 'signature' && canWrite(script, fullName) ? script : plain;
    if (!canWrite(font, fullName)) continue;
    const size = fit(font, fullName, f.kind === 'signature' ? 20 : 11, f.width);
    page.drawText(fullName, { x: f.x, y: f.y, size, font, color: INK });
  }

  // the record of how and when it was signed (reference, e-mail, time, declaration) as the last page
  const record = await PDFDocument.load(await agreementPdf({ title, name: fullName, email, reference, acceptedAt }));
  const [recordPage] = await pdf.copyPages(record, [0]);
  pdf.addPage(recordPage);
  pdf.setTitle(`${title} - signed - ${reference}`);
  return Buffer.from(await pdf.save());
}

/**
 * Makes the signed copy of each agreement with a PDF and stores it in OSS. → the agreements with `file` (the OSS key)
 * added to the ones stored; the others unchanged. Errors are logged, not thrown: the application is saved either way and
 * MAX gets a copy made when the account is opened (src/lib/accountOpening.js).
 */
export async function storeSignedAgreements({ applicationId, agreements, name, email, reference }) {
  if (!storageConfigured()) {
    console.warn('[agreements] OSS is not configured; signed agreements not stored');
    return agreements;
  }
  const prefix = (process.env.OSS_PREFIX || 'client-documents/').replace(/^\/+/, '');
  const out = [];
  for (const a of agreements) {
    try {
      const pdf = a.accepted && a.url ? await signedAgreementPdf({ ...a, name, email, reference }) : null;
      if (!pdf) {
        out.push(a);
        continue;
      }
      const slug = a.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const key = `${prefix}${applicationId}/agreements/${slug}-${new Date().toISOString().slice(0, 10)}-${randomUUID()}.pdf`;
      await putObject(key, pdf, 'application/pdf');
      out.push({ ...a, file: key });
    } catch (err) {
      console.error(`[agreements] application ${applicationId}, ${a.title}:`, err?.message || err);
      out.push(a);
    }
  }
  return out;
}

/** The stored signed copy (Buffer) of an agreement, if there is one. */
export const storedAgreement = async (agreement) => (agreement?.file ? getObject(agreement.file) : null);
