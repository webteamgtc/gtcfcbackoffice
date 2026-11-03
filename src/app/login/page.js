import Logo from '@/app/components/Logo';
import { LockIcon, ShieldIcon, UploadIcon, UserIcon } from '@/app/components/icons';
import { BRAND } from '@/lib/brand';
import LoginForm from './LoginForm';

export const metadata = { title: `Sign in | ${BRAND.name}` };

/**
 * Sign-in: the form beside a navy panel with the three steps of the portal.
 * Wording stays within the CAT 5 licence: a consultancy client portal, no trading terms.
 */
const HOW = [
  { Icon: UserIcon, title: 'Sign in', text: 'Use your registered email and password.' },
  { Icon: UploadIcon, title: 'Upload your documents', text: 'An identity document and a proof of address.' },
  { Icon: ShieldIcon, title: 'We review them', text: 'Track the status here; we’ll update you when it’s done.' }
];

export default function LoginPage() {
  return (
    <main className="auth">
      <section className="auth-form-side">
        <div className="auth-card">
          <Logo variant="main" width={164} priority className="auth-logo" />
          <h1>Welcome back</h1>
          <p className="auth-sub">Sign in to your client portal.</p>
          <LoginForm />
          <p className="auth-secure">
            <LockIcon /> Your connection is encrypted.
          </p>
        </div>
        <p className="auth-foot">
          © {new Date().getFullYear()} {BRAND.legalName}
        </p>
      </section>
      <aside className="auth-brand-side">
        <div className="auth-brand-inner">
          <p className="auth-kicker">Client portal</p>
          <h2>
            Your verification, <span>simple and secure</span>.
          </h2>
          <ol className="auth-how">
            {HOW.map(({ Icon, title, text }, i) => (
              <li key={title}>
                <span className="auth-how-icon">
                  <Icon />
                  <em>{i + 1}</em>
                </span>
                <span>
                  <strong>{title}</strong>
                  <small>{text}</small>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </main>
  );
}
