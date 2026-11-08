'use client';

import { useEffect, useState, useTransition } from 'react';
import { revealSensitive } from '@/app/dashboard-admin/actions';

/** A protected value (ID number / tax number): hidden until the administrator asks, hides itself again after 30 seconds. */
export default function RevealField({ applicationId, field }) {
  const [value, setValue] = useState(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  useEffect(() => {
    if (value == null) return;
    const t = setTimeout(() => setValue(null), 30000);
    return () => clearTimeout(t);
  }, [value]);

  const reveal = () =>
    start(async () => {
      const res = await revealSensitive(applicationId, field);
      if (res?.value != null) {
        setError('');
        setValue(res.value);
      } else setError(res?.error ?? 'Could not read this value.');
    });

  return (
    <span className="ad-reveal">
      {value != null ? (
        <>
          <code>{value}</code>
          <button type="button" className="ad-link" onClick={() => setValue(null)}>
            Hide
          </button>
        </>
      ) : (
        <>
          <span className="ad-mask" aria-hidden="true">
            ••••••••
          </span>
          <button type="button" className="ad-link" onClick={reveal} disabled={pending}>
            {pending ? 'Opening…' : 'Reveal'}
          </button>
        </>
      )}
      {error && <small className="ad-error-text">{error}</small>}
    </span>
  );
}
