import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import Logo from '@/app/components/Logo';
import { AlertIcon, CheckIcon, LockIcon } from '@/app/components/icons';
import { logout } from '@/app/actions/auth';
import { BRAND } from '@/lib/brand';
import { getCurrentUser } from '@/lib/user';

/**
 * Page shown after Sumsub's automatic review: /success (approved) and /failed (rejected, finally or with "resubmit").
 * SumsubVerification sends the client here, and the apply page does too when the decision is already stored. The status
 * is read from our database (client_verifications), never from the URL, so a client without one of the page's statuses
 * is sent back to "/".
 * `children`: the next steps for that outcome.
 */
const OUTCOMES = {
  approved: {
    tone: 'ok',
    Icon: CheckIcon,
    kicker: 'Verification complete',
    title: 'You’re verified',
    text: 'Thank you. Your identity and address have been verified successfully.'
  },
  rejected: {
    tone: 'bad',
    Icon: AlertIcon,
    kicker: 'Verification unsuccessful',
    title: 'We could not verify your identity',
    text: 'Unfortunately we were unable to verify the documents you provided.'
  }
};

/** The signed-in client when their verification status is one of `statuses`; otherwise redirects to "/". */
export async function requireOutcome(...statuses) {
  await connection(); // per request (reads the session cookie)
  const user = await getCurrentUser().catch((err) => {
    console.error('[verification result] session lookup:', err);
    return null;
  });
  if (!user || !statuses.includes(user.verificationStatus)) redirect('/');
  return user;
}

export default function VerificationResult({ user, status, children }) {
  const { tone, Icon, kicker, title, text } = OUTCOMES[status];
  return (
    <main className="apply">
      <aside className="apply-brand">
        <div className="apply-brand-inner">
          <Logo variant="footer" width={150} priority className="apply-logo" />
          <p className="auth-kicker">{kicker}</p>
          <h1>
            Client application <span>{user.reference}</span>
          </h1>
          <p className="apply-secure">
            <LockIcon /> Your information is encrypted and kept confidential.
          </p>
        </div>
      </aside>

      <section className="apply-main">
        <div className="apply-card">
          <div className={`apply-success result-${tone}`} role="status">
            <span className="apply-success-icon">
              <Icon />
            </span>
            <h2>{title}</h2>
            <p>
              <span className="cap">{user.firstName}</span>, {text.charAt(0).toLowerCase() + text.slice(1)}
            </p>
            {user.reference && (
              <p className="apply-ref">
                Reference <strong>{user.reference}</strong>
              </p>
            )}
          </div>
          {children}
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
