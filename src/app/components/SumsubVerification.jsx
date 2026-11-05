'use client';

/**
 * Identity + address verification with the Sumsub WebSDK (level SUMSUB_LEVEL_NAME, default CAT_5_ID_POA), embedded after
 * the application is submitted. Tokens come from the getVerificationToken server action (never from the browser), and are
 * refreshed through the same action when they expire. When the client submits or Sumsub changes the status, the result
 * is pulled into our database (syncVerification); the webhook (POST /api/sumsub/webhook) does the same server to server.
 * `status`: our stored status (statusFromReview in src/lib/sumsub.js), or null when verification hasn't started.
 */
import { useEffect, useRef, useState } from 'react';
import { getVerificationToken, syncVerification } from '@/app/actions/verification';
import { AlertIcon, CheckIcon, ClockIcon, ShieldIcon } from './icons';

const NOTES = {
  pending: { tone: 'warn', Icon: ClockIcon, text: 'Thank you. Your documents are under review; we’ll email you when it’s done.' },
  approved: { tone: 'ok', Icon: CheckIcon, text: 'Your identity and address are verified.' },
  resubmit: { tone: 'bad', Icon: AlertIcon, text: 'Some documents could not be accepted. Please follow the instructions below to upload them again.' },
  rejected: { tone: 'bad', Icon: AlertIcon, text: 'We could not verify your documents. Our team will contact you about the next steps.' }
};

async function freshToken() {
  const res = await getVerificationToken();
  if (!res?.token) throw new Error(res?.error ?? 'No access token');
  return res.token;
}

export default function SumsubVerification({ status: initialStatus = null }) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState(initialStatus);
  const [phase, setPhase] = useState('loading'); // loading → ready | error
  const [error, setError] = useState(null);
  const final = status === 'approved' || status === 'rejected';

  useEffect(() => {
    if (final) return;
    let sdk;
    let cancelled = false;
    const sync = () => syncVerification().then((r) => !cancelled && r?.status && r.status !== 'not_started' && setStatus(r.status));

    (async () => {
      const res = await getVerificationToken();
      if (cancelled) return;
      if (!res?.token) {
        setError(res?.error ?? 'We could not start the verification.');
        setPhase('error');
        return;
      }
      const { default: snsWebSdk } = await import('@sumsub/websdk');
      if (cancelled || !containerRef.current) return;
      sdk = snsWebSdk
        .init(res.token, freshToken)
        .withConf({ lang: 'en' })
        .withOptions({ addViewportTag: false, adaptIframeHeight: true })
        .on('idCheck.onReady', () => !cancelled && setPhase('ready'))
        .on('idCheck.onApplicantSubmitted', sync)
        .on('idCheck.onApplicantResubmitted', sync)
        .on('idCheck.onApplicantStatusChanged', sync)
        .on('idCheck.onError', (err) => console.error('[sumsub] WebSDK error', err))
        .build();
      sdk.launch(containerRef.current);
      // catch up on a review that finished while the client was away (e.g. no webhook in local development)
      sync();
    })().catch((err) => {
      console.error('[sumsub]', err);
      if (!cancelled) {
        setError('We could not load the verification. Please refresh the page and try again.');
        setPhase('error');
      }
    });

    return () => {
      cancelled = true;
      sdk?.destroy?.();
    };
  }, [final]);

  const note = NOTES[status];

  return (
    <section className="verify" aria-labelledby="verify-title">
      <div className="verify-head">
        <span className="verify-icon">
          <ShieldIcon />
        </span>
        <span>
          <h3 id="verify-title">Verify your identity</h3>
          <small>Photograph your identity document, add your proof of address and take a quick selfie. It takes about 3 minutes.</small>
        </span>
      </div>

      {note && (
        <p className={`note ${note.tone === 'warn' ? 'warn-note' : note.tone}`} role="status">
          <note.Icon /> {note.text}
        </p>
      )}

      {phase === 'error' && (
        <p className="note bad" role="alert">
          <AlertIcon /> {error}
        </p>
      )}

      {!final && phase !== 'error' && (
        <div className="verify-sdk">
          {phase === 'loading' && <p className="verify-loading">Loading secure verification…</p>}
          <div ref={containerRef} id="sumsub-websdk-container" />
        </div>
      )}
    </section>
  );
}
