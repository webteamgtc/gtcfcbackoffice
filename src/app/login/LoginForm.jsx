'use client';

import { useActionState, useState } from 'react';
import { login } from '@/app/actions/auth';
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon } from '@/app/components/icons';

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={action} className="auth-form">
      <div className="field">
        <label htmlFor="email" className="label">Email <span className="required">*</span></label>
        <div className="control">
          <span className="icon"><MailIcon /></span>
          <input id="email" name="email" type="text" autoComplete="username" placeholder="you@example.com" defaultValue={state?.email} required />
        </div>
      </div>

      <div className="field">
        <label htmlFor="password" className="label">Password <span className="required">*</span></label>
        <div className="control">
          <span className="icon"><LockIcon /></span>
          <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" required />
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeIcon /> : <EyeOffIcon />}
          </button>
        </div>
      </div>

      {state?.error && <p className="alert" role="alert">{state.error}</p>}

      <button type="submit" disabled={pending} className="btn btn-block">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
