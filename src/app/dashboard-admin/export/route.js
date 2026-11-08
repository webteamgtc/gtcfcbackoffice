import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/admin';
import { exportApplications, VERIFICATION } from '@/lib/adminData';
import { countryByCode } from '@/lib/countries';

export const runtime = 'nodejs';

/**
 * GET /dashboard-admin/export?q=&status=&country=  (administrators only) → the list the dashboard shows, as a CSV file for Excel.
 * Contact and status columns only: no ID numbers, tax numbers or files. Cells that start with = + - @ are prefixed with
 * an apostrophe so a spreadsheet can't run them as formulas.
 */
const cell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export async function GET(req) {
  const admin = await getAdmin();
  if (!admin) return new NextResponse('Unauthorized', { status: 401 });
  const sp = new URL(req.url).searchParams;
  try {
    const rows = await exportApplications({ q: sp.get('q') ?? '', status: sp.get('status') ?? '', country: sp.get('country') ?? '' });
    const head = ['ID', 'Reference', 'Submitted (UTC)', 'First name', 'Last name', 'Email', 'Phone', 'Country', 'Nationality', 'Account type', 'Partner code', 'Verification'];
    const lines = [head.map(cell).join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.applicationReference,
          r.submittedAt ? new Date(r.submittedAt).toISOString().replace('T', ' ').slice(0, 19) : '',
          r.firstName,
          r.lastName,
          r.email,
          r.phone ? `+${countryByCode(r.phoneCountry || r.country)?.dial ?? ''} ${r.phone}`.trim() : '',
          countryByCode(r.country)?.name ?? r.country,
          countryByCode(r.nationality)?.name ?? r.nationality,
          r.accountType,
          r.partnerCode,
          VERIFICATION[r.verification]?.label ?? r.verification
        ]
          .map(cell)
          .join(',')
      );
    }
    console.info(`[admin-audit] ${admin} exported ${rows.length} applications`);
    return new NextResponse(`\uFEFF${lines.join('\r\n')}\r\n`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="applications-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (err) {
    console.error('[admin] export:', err.message);
    return new NextResponse('Could not export', { status: 500 });
  }
}
