import { NextResponse } from 'next/server';
import { verifyWebhook } from '@/lib/sumsub';
import { saveVerification } from '@/lib/verification';

export const runtime = 'nodejs';

/**
 * Sumsub webhook (Dashboard → Dev space → Webhooks; target https://<site>/api/sumsub/webhook, secret = SUMSUB_WEBHOOK_SECRET).
 * Subscribe to: applicantCreated, applicantPending, applicantReviewed, applicantOnHold, applicantReset.
 * The signature (X-Payload-Digest over the raw body) is checked before anything is read; the review is saved on the
 * client whose id is the applicant's externalUserId. Unknown users / other events are acknowledged and ignored.
 */
const EVENTS = ['applicantCreated', 'applicantPending', 'applicantReviewed', 'applicantOnHold', 'applicantReset', 'applicantPrechecked'];

export async function POST(req) {
  const raw = Buffer.from(await req.arrayBuffer());
  if (!verifyWebhook(raw, req.headers.get('x-payload-digest'), req.headers.get('x-payload-digest-alg') ?? undefined)) {
    return NextResponse.json({ ok: false, error: 'invalid signature' }, { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (!EVENTS.includes(event?.type) || !event.externalUserId) return NextResponse.json({ ok: true, ignored: true });

  try {
    const status = await saveVerification(String(event.externalUserId), {
      applicantId: event.applicantId,
      levelName: event.levelName,
      reviewStatus: event.type === 'applicantReset' ? 'init' : event.reviewStatus,
      reviewResult: event.reviewResult,
      event: event.type
    });
    console.info(`[sumsub/webhook] ${event.type} for ${event.externalUserId}${event.testMode ? ' (test)' : ''} → ${status ?? 'unknown user'}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[sumsub/webhook]', err);
    // non-2xx makes Sumsub retry the webhook later
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
