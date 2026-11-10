import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import Logo from '@/app/components/Logo';
import { LockIcon, MailIcon, ShieldIcon, UserIcon } from '@/app/components/icons';
import { BRAND } from '@/lib/brand';
import { getCurrentUser } from '@/lib/user';
import LoginForm from './LoginForm';

export const metadata = { title: `Application status | ${BRAND.name}` };

/**
 * Application status: a client who has applied signs in with their e-mail and a code sent to it (no password), then
 * their page ("/", src/app/page.js) shows where they are: verification, outcome and their account.
 * Wording stays within the CAT 5 licence: a consultancy client portal, no trading terms.
 */
const HOW = [
  { Icon: MailIcon, title: 'Enter your email', text: 'The email you used for your application.' },
  { Icon: ShieldIcon, title: 'Confirm the code', text: 'We email you a 6-digit code to keep your application private.' },
  { Icon: UserIcon, title: 'See your status', text: 'Continue your verification, or see the outcome and your account.' }
];

export default async function LoginPage() {
  await connection(); // per request: reads the session cookie
  if (await getCurrentUser().catch(() => null)) redirect('/');

  return (
    <main className="auth">
      <section className="auth-form-side">
        <div className="auth-card">
          <Logo variant="main" width={164} priority className="auth-logo" />
          <h1>Check your application</h1>
          <p className="auth-sub">Enter your email and we’ll send you a code to see your application status.</p>
          <LoginForm />
          <p className="auth-secure">
            <LockIcon /> Your connection is encrypted.
          </p>
          <p className="auth-secure">
            Haven’t applied yet? <Link href="/">Start your application</Link>
          </p>
        </div>
        <p className="auth-foot">
          © {new Date().getFullYear()} {BRAND.legalName}
        </p>
      </section>
      <aside className="auth-brand-side">
        <div className="auth-brand-inner">
          <p className="auth-kicker">Client application</p>
          <h2>
            Your application, <span>one code away</span>.
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
