import 'server-only';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { BRAND } from '@/lib/brand';
import { AGREEMENT_TEXT } from '@/lib/application';

/**
 * The record of a client's electronic signature of one agreement (sent to MAX as the "signed agreement"): agreement title,
 * client, application reference, the declaration they accepted and when. A4, one page.
 */
const A4 = [595.28, 841.89];
const MARGIN = 56;
const NAVY = rgb(0.043, 0.078, 0.251);
const MUTED = rgb(0.39, 0.42, 0.51);

// the standard PDF fonts only cover Latin-1: accents are folded, anything else becomes "?"
const latin1 = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?');

function wrap(text, font, size, width) {
  const lines = [];
  let line = '';
  for (const word of latin1(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** → PDF bytes (Buffer) */
export async function agreementPdf({ title, name, email, reference, acceptedAt }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${latin1(title)} - ${latin1(name)}`);
  pdf.setAuthor(BRAND.legalName);
  const page = pdf.addPage(A4);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = A4[0] - MARGIN * 2;
  let y = A4[1] - MARGIN;

  const text = (s, { font = regular, size = 11, color = NAVY, gap = 6 } = {}) => {
    for (const line of wrap(s, font, size, width)) {
      page.drawText(line, { x: MARGIN, y: y - size, size, font, color });
      y -= size + 4;
    }
    y -= gap;
  };
  const row = (label, value) => {
    page.drawText(latin1(label), { x: MARGIN, y: y - 11, size: 11, font: bold, color: MUTED });
    page.drawText(latin1(value), { x: MARGIN + 150, y: y - 11, size: 11, font: regular, color: NAVY });
    y -= 22;
  };

  text(BRAND.legalName, { font: bold, size: 12, color: MUTED, gap: 18 });
  text(title, { font: bold, size: 20, gap: 4 });
  text('Electronic signature record', { size: 12, color: MUTED, gap: 24 });

  row('Client', name);
  row('E-mail', email);
  row('Application reference', reference);
  row('Signed (UTC)', new Date(acceptedAt).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'));
  y -= 14;

  text('Declaration accepted by the client', { font: bold, size: 12, gap: 8 });
  text(`The client electronically signed the ${title} in the online client application of ${BRAND.name} by confirming:`, { gap: 10 });
  text(`"${AGREEMENT_TEXT}"`, { size: 11, color: MUTED, gap: 24 });

  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 220, y }, thickness: 0.8, color: MUTED });
  y -= 6;
  text(`Signed electronically by ${name}`, { size: 10, color: MUTED });

  return Buffer.from(await pdf.save());
}
