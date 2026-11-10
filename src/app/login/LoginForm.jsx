'use client';

import { useEffect, useState, useTransition } from 'react';
import { sendStatusCode, verifyStatusCode } from '@/app/actions/auth';
import { CheckIcon, MailIcon, ShieldIcon } from '@/app/components/icons';

const RESEND_SECONDS = 60;

/** E-mail → code by e-mail → signed in (actions/auth.js), then the server redirects to the client page "/". */
export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState(''); // signed token of the code sent; goes back with the code
  const [error, setError] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const [pending, startTransition] = useTransition();
  const sent = Boolean(token);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = () =>
    startTransition(async () => {
      setError(null);
      const res = await sendStatusCode(email).catch(() => ({ error: 'Could not reach the server. Please try again.' }));
      if (res?.ok) {
        setToken(res.token);
        setCode('');
        setCooldown(RESEND_SECONDS);
        setTimeout(() => document.getElementById('code')?.focus());
      } else {
        setError(res?.error);
        if (res?.retryIn) setCooldown(res.retryIn);
      }
    });

  const verify = () =>
    startTransition(async () => {
      setError(null);
      // on success the action redirects (the page changes); it only returns on an error
      const res = await verifyStatusCode(email, code, token).catch(() => ({ error: 'Could not reach the server. Please try again.' }));
      if (res?.error) setError(res.error);
    });

  const submit = (e) => {
    e.preventDefault();
    if (sent) verify();
    else send();
  };

  const changeEmail = () => {
    setToken('');
    setCode('');
    setError(null);
  };

  return (
    <form onSubmit={submit} className="auth-form">
      <div className="field">
        <label htmlFor="email" className="label">
          Email <span className="required">*</span>
        </label>
        <div className="control">
          <span className="icon">
            <MailIcon />
          </span>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={sent}
            required
          />
        </div>
        {sent && (
          <button type="button" className="link-btn" onClick={changeEmail}>
            Use a different email
          </button>
        )}
      </div>

      {sent && (
        <>
          <p className="note ok" role="status">
            <CheckIcon /> We sent a 6-digit code to {email.trim()}. It expires in 10 minutes.
          </p>
          <div className="field">
            <label htmlFor="code" className="label">
              Verification code <span className="required">*</span>
            </label>
            <div className="control">
              <span className="icon">
                <ShieldIcon />
              </span>
              <input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
              />
            </div>
            <button type="button" className="link-btn" onClick={send} disabled={pending || cooldown > 0}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending || (!sent && cooldown > 0)} className="btn btn-block">
        {pending ? (sent ? 'Checking…' : 'Sending…') : sent ? 'View my application' : 'Send code'}
      </button>
    </form>
  );
}
