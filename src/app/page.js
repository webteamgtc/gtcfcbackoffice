import { redirect } from 'next/navigation';
import { getCurrentUser, getUserDocuments, profileCompletion } from '@/lib/user';
import { accountStatus } from '@/lib/accountOpening';
import { journey } from '@/lib/kyc';
import { ArrowRightIcon } from '@/app/components/icons';
import { Activity, Details, DetailsCardTitle, DocTile, HelpCard, ProfileCard, Shell } from '@/app/components/dashboard/parts';

/**
 * Client page: where the client's application stands. Navy hero with what to do next and the client's credential card
 * (name, verification status, progress), the two documents, their MAX account, recent activity, details and help.
 * Reached after the e-mail code sign-in (src/app/login) or once signed in by the application (src/proxy.js).
 * The verification itself happens on /apply (Sumsub); its outcome on /success and /failed.
 */
const ACCOUNT = {
  done: { tone: 'ok', title: 'Your account is open', text: (u) => `We emailed your login details to ${u.email}.` },
  processing: { tone: 'warn', title: 'We’re opening your account', text: () => 'This takes a moment. We’ll email your login details.' },
  new: { tone: 'warn', title: 'We’re opening your account', text: () => 'This takes a moment. We’ll email your login details.' },
  failed: { tone: 'warn', title: 'Your account is not open yet', text: () => 'We could not open it just now. Open it from your account page.' },
  blocked: { tone: 'bad', title: 'Your account needs a check', text: () => 'Our team will contact you to finish opening your account.' }
};

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [documents, account] = await Promise.all([getUserDocuments(user.id), user.verificationStatus === 'approved' ? accountStatus(user.id) : null]);
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
  const j = journey(user, documents);
  const { next } = j;
  const acc = user.verificationStatus === 'approved' && (ACCOUNT[account?.status] ?? ACCOUNT.failed);

  return (
    <Shell user={user} fullName={fullName}>
      <section className="hero" id="overview">
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="eyebrow">Your application {user.reference}</p>
            <h1>
              Hello, <span className="cap">{user.firstName || fullName}</span>
            </h1>
            <p className="hero-lead">{next.title}</p>
            <p className="hero-text">{next.text}</p>
            {next.href ? (
              <a className="btn btn-gold" href={next.href}>
                {next.action} <ArrowRightIcon />
              </a>
            ) : (
              next.req && (
                <a className="btn btn-gold" href={`#doc-${next.req.key}`}>
                  {next.req.status === 'rejected' ? 'Upload a new copy' : `Upload ${next.req.noun}`}
                </a>
              )
            )}
          </div>
          <ProfileCard user={user} fullName={fullName} j={j} />
        </div>
      </section>

      <main className="content">
        <section className="section" id="verification" aria-labelledby="docs-title">
          <div className="section-head">
            <div>
              <p className="kicker">Verification</p>
              <h2 id="docs-title">Your documents</h2>
            </div>
            <span className="muted">
              {j.approved} of {j.reqs.length} verified
            </span>
          </div>
          <div className="tiles">
            {j.reqs.map((r, i) => (
              <DocTile key={r.key} req={r} index={i + 1} verifyHref="/apply" />
            ))}
          </div>
        </section>

        <div className="grid-2">
          <div className="stack">
            {acc && (
              <section className="panel" id="account">
                <div className="panel-head">
                  <div>
                    <h2>Your account</h2>
                    <p className="panel-sub">{acc.text(user)}</p>
                  </div>
                  <span className={`pill ${acc.tone}`}>{acc.title}</span>
                </div>
                <a className="link-btn" href="/success">
                  View your account <ArrowRightIcon />
                </a>
              </section>
            )}
            <section className="panel">
              <div className="panel-head">
                <h2>Recent activity</h2>
              </div>
              <Activity documents={documents} />
            </section>
          </div>
          <div className="stack">
            <section className="panel" id="profile">
              <DetailsCardTitle completion={profileCompletion(user)} />
              <Details user={user} />
            </section>
            <HelpCard />
          </div>
        </div>
      </main>
    </Shell>
  );
}
