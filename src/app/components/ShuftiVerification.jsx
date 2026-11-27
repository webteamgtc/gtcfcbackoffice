'use client';

/**
 * Identity + address verification with Shufti Pro (ID document, selfie, proof of address), embedded after the application
 * is submitted. The link comes from the getVerificationLink server action (never made in the browser) and is shown in an
 * iframe. While it is open the result is pulled into our database every few seconds (syncVerification), and at once when
 * Shufti sends the iframe back to /api/shufti/done; the callback (POST /api/shufti/callback) does the same server to server.
 * `status`: our stored status (statusFromEvent in src/lib/shufti.js), or null when verification hasn't started.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getVerificationLink, syncVerification } from '@/app/actions/verification';
import { AlertIcon, CheckIcon, ClockIcon, ShieldIcon } from './icons';

const NOTES = {
  pending: { tone: 'warn', Icon: ClockIcon, text: 'Thank you. We’re checking your documents; this usually takes less than a minute.' },
  approved: { tone: 'ok', Icon: CheckIcon, text: 'Your identity and address are verified.' },
  rejected: { tone: 'bad', Icon: AlertIcon, text: 'We could not verify your documents. Our team will contact you about the next steps.' }
};
const FINAL = ['approved', 'rejected'];
const POLL_MS = 5000;

export default function ShuftiVerification({ status: initialStatus = null }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [url, setUrl] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading → ready | error
  const [error, setError] = useState(null);
  const syncing = useRef(false);
  const final = FINAL.includes(status);

  // Shufti's review decides: approved → /success, declined → /failed
  useEffect(() => {
    if (status === 'approved') router.replace('/success');
    else if (status === 'rejected') router.replace('/failed');
  }, [status, router]);

  useEffect(() => {
    if (final) return;
    let cancelled = false;
    let timer;
    const sync = async () => {
      if (syncing.current) return;
      syncing.current = true;
      const r = await syncVerification().catch(() => null);
      syncing.current = false;
      if (!cancelled && r?.status && r.status !== 'not_started') setStatus(r.status);
    };
    const poll = async () => {
      await sync();
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };
    // the page Shufti returns to in the iframe (/api/shufti/done) says the client has finished: look now
    const onMessage = (e) => {
      if (e.origin === window.location.origin && e.data?.type === 'shufti:done') sync();
    };
    window.addEventListener('message', onMessage);

    (async () => {
      const res = await getVerificationLink();
      if (cancelled) return;
      if (res?.demo || res?.status) {
        setStatus(res.status); // demo mode, or already submitted / decided
        if (res.status === 'pending') poll();
        return;
      }
      if (!res?.url) {
        setError(res?.error ?? 'We could not start the verification.');
        setPhase('error');
        return;
      }
      setUrl(res.url);
      setPhase('ready');
      poll();
    })().catch((err) => {
      console.error('[shufti]', err);
      if (!cancelled) {
        setError('We could not load the verification. Please refresh the page and try again.');
        setPhase('error');
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
    // initialStatus only matters on the first run
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      {!final && status !== 'pending' && phase !== 'error' && (
        <div className="verify-sdk">
          {phase === 'loading' && <p className="verify-loading">Loading secure verification…</p>}
          {url && (
            <iframe
              className="verify-frame"
              src={url}
              title="Identity verification"
              allow="camera; microphone; fullscreen; clipboard-write; autoplay"
              allowFullScreen
            />
          )}
        </div>
      )}
      {url && !final && status !== 'pending' && (
        <p className="verify-alt">
          Camera not working here?{' '}
          <a href={url} target="_blank" rel="noopener noreferrer">
            Open the verification in a new tab
          </a>
          ; this page updates when you’re done.
        </p>
      )}
    </section>
  );
}
