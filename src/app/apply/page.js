import Logo from '@/app/components/Logo';
import LiveApplicationForm from '@/app/components/LiveApplicationForm';
import { LockIcon, ShieldIcon, UploadIcon, UserIcon } from '@/app/components/icons';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `Apply | ${BRAND.name}` };

/**
 * Client application: the two-step form beside a navy panel explaining the process.
 * Served at "/" while the portal is hidden (src/lib/features.js, src/proxy.js).
 * Wording stays within the CAT 5 licence: consultancy client application, no trading terms.
 */
const HOW = [
  { Icon: UserIcon, title: 'Your details', text: 'Your name, contact details and a verified email.' },
  { Icon: UploadIcon, title: 'Your documents', text: 'An identity document and a proof of address.' },
  { Icon: ShieldIcon, title: 'We review them', text: 'We email you a confirmation and contact you about next steps.' }
];

export default function ApplyPage() {
  return (
    <main className="apply">
      <aside className="apply-brand">
        <div className="apply-brand-inner">
          <Logo variant="footer" width={150} priority className="apply-logo" />
          <p className="auth-kicker">Client application</p>
          <h1>
            Become a client in <span>two simple steps</span>.
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
        <LiveApplicationForm />
        <p className="auth-foot">
          © {new Date().getFullYear()} {BRAND.legalName}
        </p>
      </section>
    </main>
  );
}
