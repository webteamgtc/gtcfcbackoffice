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
 * Where to sign, per agreement PDF (PDF points, origin bottom left; measured on the file): the PDF has no signature box
 * of its own, so we draw one (name, signature, date) in the empty space under the last clause. Replacing the PDF means
 * measuring that space again (the box must not overlap the text or the page footer).
 */
// (files are read with literal paths, so the build includes exactly these in the server bundle)
const LAYOUTS = {
  '/client-agreement.pdf': {
    read: () => readFile(path.join(process.cwd(), 'public/client-agreement.pdf')),
    // page 18 (the last): the table ends at y≈158, the footer starts at y≈47; the table spans x 50–545
    box: { page: 18, x: 50, y: 60, width: 495, height: 90 }
  }
};

const INK = rgb(0.043, 0.078, 0.251);
const NAVY = rgb(0.106, 0.165, 0.31); // the table headings of the agreement
const RULE = rgb(0.55, 0.58, 0.65);
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
export async function signedAgreementPdf({ title, url, name, email, reference, acceptedAt, declaration }) {
  const layout = LAYOUTS[url];
  if (!layout) return null;

  const pdf = await PDFDocument.load(await layout.read());
  pdf.registerFontkit(fontkit);
  const plain = await pdf.embedFont(StandardFonts.Helvetica);
  const script = await pdf.embedFont(await scriptFont(), { subset: true }); // subset: written as TrueType (viewers can't read WOFF)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { box } = layout;
  const page = pdf.getPage(Math.min(box.page, pdf.getPageCount()) - 1);
  const signedAt = new Date(acceptedAt);
  const fullName = titleCase(name);

  // the box: a heading bar like the agreement's tables, then three columns (name | signature | date)
  const head = 16;
  page.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, borderColor: NAVY, borderWidth: 0.75 });
  page.drawRectangle({ x: box.x, y: box.y + box.height - head, width: box.width, height: head, color: NAVY });
  page.drawText('CLIENT SIGNATURE', { x: box.x + 8, y: box.y + box.height - head + 5, size: 8.5, font: bold, color: rgb(1, 1, 1) });

  const pad = 10;
  const colW = box.width / 3;
  const lineY = box.y + 16;
  const labelY = box.y + box.height - head - 13;
  const cols = [
    { label: 'Name', kind: 'name' },
    { label: 'Signature', kind: 'signature' },
    { label: 'Date (DD/MM/YYYY)', kind: 'date' }
  ];
  cols.forEach((c, i) => {
    const x = box.x + i * colW + pad;
    const width = colW - 2 * pad;
    if (i) page.drawLine({ start: { x: box.x + i * colW, y: box.y }, end: { x: box.x + i * colW, y: box.y + box.height - head }, thickness: 0.5, color: RULE });
    page.drawText(c.label, { x, y: labelY, size: 8, font: bold, color: NAVY });
    page.drawLine({ start: { x, y: lineY }, end: { x: x + width, y: lineY }, thickness: 0.5, color: RULE });

    if (c.kind === 'date') {
      const date = dubaiDate(signedAt);
      page.drawText(date, { x, y: lineY + 5, size: fit(plain, date, 11, width), font: plain, color: INK });
      return;
    }
    // the name in the script font as the signature, in Helvetica as the name; a name neither can write (e.g. Arabic
    // script: no shaping here) is left to the signature record on the last page
    const font = c.kind === 'signature' && canWrite(script, fullName) ? script : plain;
    if (!canWrite(font, fullName)) return;
    const size = fit(font, fullName, c.kind === 'signature' ? 22 : 11, width);
    page.drawText(fullName, { x, y: lineY + 5, size, font, color: INK });
  });

  // the record of how and when it was signed (reference, e-mail, time, declaration) as the last page
  const record = await PDFDocument.load(await agreementPdf({ title, name: fullName, email, reference, acceptedAt, declaration }));
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
