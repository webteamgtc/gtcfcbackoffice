import { redirect } from 'next/navigation';
import { getCurrentUser, getUserDocuments, profileCompletion } from '@/lib/user';
import { journey } from '@/lib/kyc';
import { Activity, Details, DetailsCardTitle, DocTile, HelpCard, ProfileCard, Shell } from '@/app/components/dashboard/parts';

/**
 * Client dashboard. Navy hero with what to do next and the client's credential card (name, verification status,
 * progress), then the two documents to upload, recent activity, the client's details and help.
 */
export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const documents = await getUserDocuments(user.id);
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
  const j = journey(user, documents);
  const { next } = j;

  return (
    <Shell user={user} fullName={fullName}>
      <section className="hero" id="overview">
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="eyebrow">Client portal</p>
            <h1>
              Hello, <span className="cap">{user.firstName || fullName}</span>
            </h1>
            <p className="hero-lead">{next.title}</p>
            <p className="hero-text">{next.text}</p>
            {next.req && (
              <a className="btn btn-gold" href={`#doc-${next.req.key}`}>
                {next.req.status === 'rejected' ? 'Upload a new copy' : `Upload ${next.req.noun}`}
              </a>
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
              <DocTile key={r.key} req={r} index={i + 1} />
            ))}
          </div>
        </section>

        <div className="grid-2">
          <section className="panel">
            <div className="panel-head">
              <h2>Recent activity</h2>
            </div>
            <Activity documents={documents} />
          </section>
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
