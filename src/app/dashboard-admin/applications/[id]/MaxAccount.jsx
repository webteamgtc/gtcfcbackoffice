'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { openMaxAccount } from '@/app/dashboard-admin/actions';

/**
 * The client's MAX account (max_onboarding, src/lib/accountOpening.js): its status, member ID and the last error, and a
 * button that opens it (or tries again after a failure). Opening also e-mails the client their login details.
 * `max`: the max_onboarding row or null; `approved`: Shufti Pro accepted the client's verification.
 */
const STATES = {
  none: { tone: 'neutral', label: 'Not opened' },
  new: { tone: 'warn', label: 'Opening…' },
  processing: { tone: 'warn', label: 'Opening…' },
  done: { tone: 'ok', label: 'Open' },
  failed: { tone: 'bad', label: 'Failed' },
  blocked: { tone: 'bad', label: 'Needs a check' }
};
const MAX_ATTEMPTS = 5;

export default function MaxAccount({ applicationId, max, approved, emailedAt, updatedAt }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const key = max?.status === 'failed' && max.attempts >= MAX_ATTEMPTS ? 'blocked' : (max?.status ?? 'none');
  const state = STATES[key] ?? STATES.none;
  const canOpen = approved && !pending && ['none', 'failed', 'blocked'].includes(key);
  const duplicates = Array.isArray(max?.duplicate_member_ids) ? max.duplicate_member_ids : Object.values(max?.duplicate_member_ids ?? {}).flat();

  const open = () =>
    start(async () => {
      setError('');
      const res = await openMaxAccount(applicationId).catch(() => ({ error: 'Could not reach the server.' }));
      if (res?.error) setError(res.error);
      router.refresh();
    });

  return (
    <dl className="ad-grid ad-grid-one">
      <div className="ad-field-row">
        <dt>Status</dt>
        <dd>
          <span className={`ad-pill ad-pill-${pending ? 'warn' : state.tone}`}>{pending ? 'Opening…' : state.label}</span>
        </dd>
      </div>
      {max?.member_id && (
        <div className="ad-field-row">
          <dt>MAX member ID</dt>
          <dd>
            <code>{max.member_id}</code>
          </dd>
        </div>
      )}
      {emailedAt && (
        <div className="ad-field-row">
          <dt>Login details e-mailed</dt>
          <dd>{emailedAt}</dd>
        </div>
      )}
      {max && key !== 'done' && max.message && (
        <div className="ad-field-row is-wide">
          <dt>Last error{max.result_code ? ` (MAX code ${max.result_code})` : ''}</dt>
          <dd className="ad-error-text">{max.message}</dd>
        </div>
      )}
      {duplicates.length > 0 && (
        <div className="ad-field-row is-wide">
          <dt>Matching MAX customers</dt>
          <dd>{duplicates.join(', ')}</dd>
        </div>
      )}
      {max && key !== 'none' && (
        <div className="ad-field-row">
          <dt>Tries</dt>
          <dd>
            {max.attempts} of {MAX_ATTEMPTS} · {updatedAt}
          </dd>
        </div>
      )}
      <div className="ad-field-row is-wide">
        {approved ? (
          canOpen || pending ? (
            <button type="button" className="ad-btn ad-btn-small" onClick={open} disabled={!canOpen}>
              {pending ? 'Opening the account…' : key === 'none' ? 'Open MAX account' : 'Retry'}
            </button>
          ) : key === 'done' ? (
            <small className="ad-muted">The client has their login details by e-mail.</small>
          ) : (
            <button type="button" className="ad-btn ad-btn-small ad-btn-ghost" onClick={() => router.refresh()}>
              Refresh status
            </button>
          )
        ) : (
          <small className="ad-muted">Available once the client is verified by Shufti Pro.</small>
        )}
        {error && <small className="ad-error-text"> {error}</small>}
      </div>
    </dl>
  );
}
