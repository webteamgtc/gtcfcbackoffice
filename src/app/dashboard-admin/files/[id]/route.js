import { NextResponse } from 'next/server';
import { getAdmin } from '@/lib/admin';
import { getAgreement, getDocument, getFormFile } from '@/lib/adminData';
import { signedUrl, storageConfigured } from '@/lib/storage';

export const runtime = 'nodejs';

/**
 * GET /dashboard-admin/files/<id>?kind=form|doc|agreement  (administrators only)
 *   form      → a file uploaded in the application form (stored in MySQL, application_files), streamed inline
 *   doc       → a file uploaded from the client dashboard (stored in OSS, client_documents): redirects to a signed link
 *               that works for one minute
 *   agreement → <id> is the application, &n= the agreement (0-based): the signed copy stored in OSS at submission
 *               (src/lib/signedAgreement.js), through a one-minute link (404 when none was stored)
 * Add &download=1 to save the file instead of showing it. Never cached.
 */
const SAFE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const KINDS = ['form', 'doc', 'agreement'];

export async function GET(req, ctx) {
  if (!(await getAdmin())) return new NextResponse('Unauthorized', { status: 401 });
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const kind = KINDS.includes(url.searchParams.get('kind')) ? url.searchParams.get('kind') : 'form';
  const download = url.searchParams.get('download') === '1';

  try {
    if (kind === 'agreement') {
      const found = await getAgreement(id, url.searchParams.get('n'));
      if (!found?.agreement.file) return new NextResponse('Not found', { status: 404 });
      if (!storageConfigured()) return new NextResponse('File storage is not configured', { status: 503 });
      const { app, agreement } = found;
      const filename = `${agreement.title} - ${app.applicationReference}.pdf`;
      return NextResponse.redirect(signedUrl(agreement.file, { expires: 60, filename: download ? filename : undefined }));
    }

    if (kind === 'doc') {
      const doc = await getDocument(id);
      if (!doc) return new NextResponse('Not found', { status: 404 });
      if (!storageConfigured()) return new NextResponse('File storage is not configured', { status: 503 });
      return NextResponse.redirect(signedUrl(doc.storage_key, { expires: 60, filename: download ? doc.filename : undefined }));
    }

    const file = await getFormFile(id);
    if (!file) return new NextResponse('Not found', { status: 404 });
    const type = SAFE_TYPES.includes(file.content_type) ? file.content_type : 'application/octet-stream';
    const name = encodeURIComponent(file.filename || `file-${file.id}`);
    return new NextResponse(file.content, {
      headers: {
        'Content-Type': type,
        'Content-Disposition': `${download || type === 'application/octet-stream' ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (err) {
    console.error('[admin] file:', err.message);
    return new NextResponse('Could not read the file', { status: 500 });
  }
}
