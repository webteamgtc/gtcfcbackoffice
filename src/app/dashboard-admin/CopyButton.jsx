'use client';

import { useState } from 'react';
import Icon from './Icon';

/** A small button that copies a value (e-mail, phone, reference) and says so. */
export default function CopyButton({ value, label = 'Copy' }) {
  const [done, setDone] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      // clipboard blocked (e.g. plain http on another device): nothing to do
    }
  };

  return (
    <button type="button" className={`ad-copy${done ? ' is-done' : ''}`} onClick={copy} aria-label={`${label}: ${value}`} title={label}>
      <Icon name={done ? 'check' : 'copy'} size={14} />
      <span>{done ? 'Copied' : label}</span>
    </button>
  );
}
