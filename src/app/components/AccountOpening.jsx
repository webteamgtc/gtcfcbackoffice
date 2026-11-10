'use client';

/**
 * On /success: opens the client's MAX account (openMyAccount) and shows how it went. `initial`: the stored status
 * (src/lib/accountOpening.js → accountStatus), or null when nothing has been tried yet.
 * new/failed → it starts (or retries) on its own; processing → it checks again every few seconds.
 */
import { useEffect, useState } from 'react';
import { openMyAccount } from '@/app/actions/account';
import { AlertIcon, CheckIcon, ClockIcon } from './icons';

export default function AccountOpening({ initial, email }) {
  const [status, setStatus] = useState(initial === 'done' || initial === 'blocked' ? initial : 'working');
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (status !== 'working') return;
    let cancelled = false;
    let timer;
    const run = async () => {
      const res = await openMyAccount().catch(() => ({ status: 'failed' }));
      if (cancelled) return;
      // another request is still opening it: look again shortly
      if (res.status === 'processing') timer = setTimeout(run, 4000);
      else setStatus(res.status === 'done' || res.status === 'blocked' ? res.status : 'failed');
    };
    run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, tries]);

  if (status === 'done')
    return (
      <p className="note ok" role="status">
        <CheckIcon /> Your account is ready. We’ve emailed your login details to {email}.
      </p>
    );
  if (status === 'blocked')
    return (
      <p className="note warn-note" role="status">
        <ClockIcon /> We’re finishing your account setup. Our team will contact you by email at {email}.
      </p>
    );
  if (status === 'failed')
    return (
      <p className="note bad" role="alert">
        <AlertIcon /> We couldn’t open your account just now.{' '}
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setStatus('working');
            setTries((n) => n + 1);
          }}
        >
          Try again
        </button>
      </p>
    );
  return (
    <p className="note warn-note" role="status">
      <ClockIcon /> Opening your account… this takes a few seconds.
    </p>
  );
}
