import { connection } from 'next/server';
import Logo from '@/app/components/Logo';
import LiveApplicationForm from '@/app/components/LiveApplicationForm';
import { FileIcon, LockIcon, ShieldIcon, UserIcon } from '@/app/components/icons';
import SumsubVerification from '@/app/components/SumsubVerification';
import { logout } from '@/app/actions/auth';
import { BRAND } from '@/lib/brand';
import { getCurrentUser } from '@/lib/user';
import '@fontsource/great-vibes/latin-400.css'; // signature on the agreement step (bundled, no request to Google)
import './apply.css';

export const metadata = { title: `Apply | ${BRAND.name}` };

/**
 * Client application. Signed out: the animated step-by-step form (LiveApplicationForm draws its own frame).
 * Signed in (already applied): the navy panel explaining the process beside the identity verification.
 * Served at "/" while the portal is hidden (src/lib/features.js, src/proxy.js).
 * A client who has already applied (signed in by the submission) sees their identity verification instead of the form.
 * Wording stays within the CAT 5 licence: consultancy client application, no trading terms.
 */
const HOW = [
  { Icon: UserIcon, title: 'Personal information', text: 'Your name, date of birth, country and nationality.' },
  { Icon: FileIcon, title: 'Client agreement', text: 'Read and sign electronically (companies add their details and license).' },
  { Icon: ShieldIcon, title: 'Verify your identity', text: 'Your ID, proof of address, a short questionnaire and a selfie with Sumsub. We then review your application.' }
];

async function currentApplicant() {
  await connection(); // per request (reads the session cookie); outside the try so Next sees it
  try {
    return await getCurrentUser();
  } catch (err) {
    console.error('[apply] session lookup:', err);
    return null;
  }
}

export default async function ApplyPage() {
  const user = await currentApplicant();
  if (!user) return <LiveApplicationForm />;

  return (
    <main className="apply">
      <aside className="apply-brand">
        <div className="apply-brand-inner">
          <Logo variant="footer" width={150} priority className="apply-logo" />
          <p className="auth-kicker">Client application</p>
          <h1>
            Become a client in <span>a few simple steps</span>.
          </h1>
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
          <p className="apply-secure">
            <LockIcon /> Your information is encrypted and kept confidential.
          </p>
        </div>
      </aside>

      <section className="apply-main">
        <div className="apply-card">
          <div className="apply-head">
            <h2>
              Welcome back, <span className="cap">{user.firstName || user.email}</span>
            </h2>
            <p>Your application has been received. Complete your identity verification below.</p>
          </div>
          <SumsubVerification status={user.verificationStatus} />
          <form action={logout} className="verify-switch">
            Not you?{' '}
            <button type="submit" className="link-btn">
              Start a new application
            </button>
          </form>
        </div>
        <p className="auth-foot">
          © {new Date().getFullYear()} {BRAND.legalName}
        </p>
      </section>
    </main>
  );
}
