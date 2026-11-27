import { NextResponse } from 'next/server';
import { getStatus, statusFromEvent, validSignature } from '@/lib/shufti';
import { applicationByReference, saveResult } from '@/lib/verification';

export const runtime = 'nodejs';

/**
 * Shufti Pro callback (callback_url of each request, src/lib/verification.js → verificationLink; or SHUFTI_CALLBACK_URL).
 * The `Signature` header (sha256 over the raw body, src/lib/shufti.js) is checked before anything is read; the result is
 * saved on the application whose current request has that reference. Unknown references are acknowledged and ignored.
 * verification.status.changed (a decision changed in the back office) carries no result: the status endpoint is asked.
 */
export async function POST(req) {
  const raw = Buffer.from(await req.arrayBuffer());
  if (!validSignature(raw, req.headers.get('signature'))) {
    return NextResponse.json({ ok: false, error: 'invalid signature' }, { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  try {
    const applicationId = await applicationByReference(event?.reference);
    if (!applicationId) return NextResponse.json({ ok: true, ignored: true });
    const answer = statusFromEvent(event.event) ? event : await getStatus(event.reference);
    const status = await saveResult(applicationId, answer, `callback ${event.event}`.slice(0, 40));
    console.info(`[shufti/callback] ${event.event} for ${event.reference} → application ${applicationId}: ${status}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[shufti/callback]', err);
    // non-2xx makes Shufti send the callback again later
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
