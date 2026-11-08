'use client';

import { useActionState, useState } from 'react';
import { adminLogin } from '@/app/dashboard-admin/actions';

export default function AdminLoginForm() {
  const [state, action, pending] = useActionState(adminLogin, undefined);
  const [show, setShow] = useState(false);

  return (
    <form action={action} className="ad-form">
      <label className="ad-field">
        <span>Email</span>
        <input name="email" type="email" autoComplete="username" placeholder="you@company.com" defaultValue={state?.email} required />
      </label>
      <label className="ad-field">
        <span>Password</span>
        <div className="ad-pass">
          <input name="password" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Your password" required />
          <button type="button" className="ad-link" onClick={() => setShow((v) => !v)}>
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
      </label>
      {state?.error && (
        <p className="ad-error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="ad-btn ad-btn-block" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
