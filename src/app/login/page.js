import Logo from '@/app/components/Logo';
import LoginForm from './LoginForm';

export const metadata = { title: 'Login | GTCFX' };

const HIGHLIGHTS = ['Regulated across multiple jurisdictions', 'Secure, encrypted client portal', 'Fast online identity verification'];

export default function LoginPage() {
  return (
    <main className="auth">
      <section className="auth-form-side">
        <div className="auth-card">
          <Logo variant="main" width={170} priority className="auth-logo" />
          <h1>Welcome back</h1>
          <p className="auth-sub">Sign in to access your client dashboard.</p>
          <LoginForm />
        </div>
        <p className="auth-foot">© {new Date().getFullYear()} GTCFX. All rights reserved.</p>
      </section>

      <aside className="auth-brand-side" aria-hidden="true">
        <div className="auth-brand-inner">
          <p className="auth-kicker">Client portal</p>
          <h2>Trade with a broker you can <span>trust</span>.</h2>
          <ul>
            {HIGHLIGHTS.map((h) => (
              <li key={h}><span className="tick">✓</span>{h}</li>
            ))}
          </ul>
        </div>
      </aside>
    </main>
  );
}
