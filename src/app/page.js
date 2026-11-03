import { redirect } from 'next/navigation';
import { getCurrentUser, getUserDocuments, profileCompletion, verificationStatus } from '@/lib/user';
import { logout } from '@/app/actions/auth';
import DocumentUpload from '@/app/components/DocumentUpload';
import Logo from '@/app/components/Logo';
import {
  ClockIcon, FileIcon, GlobeIcon, GridIcon, LogoutIcon, MailIcon, PhoneIcon, ShieldIcon, TagIcon, UserIcon
} from '@/app/components/icons';

const DOC_LABELS = { PASSPORT: 'Passport', ID_CARD: 'National ID card', DRIVERS: "Driver's license", PROOF_OF_ADDRESS: 'Proof of address' };

const STATUS = {
  not_started: { label: 'Not started', tone: 'neutral', note: 'Upload a document to begin' },
  pending: { label: 'Pending review', tone: 'warn', note: 'We are reviewing your documents' },
  approved: { label: 'Verified', tone: 'ok', note: 'Your identity is verified' },
  rejected: { label: 'Rejected', tone: 'bad', note: 'Please upload a new document' }
};

const formatSize = (bytes) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
const formatDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function DetailRow({ icon, label, value, extra }) {
  return (
    <div className="detail-row">
      <span className="detail-icon">{icon}</span>
      <div className="detail-text">
        <span className="detail-label">{label}</span>
        <span className={value ? 'detail-value' : 'detail-value empty'}>{value || 'Not provided'}</span>
      </div>
      {extra}
    </div>
  );
}

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const documents = await getUserDocuments(user.id);
  const completion = profileCompletion(user);
  const status = STATUS[verificationStatus(documents)];
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
  const initials = (user.firstName?.[0] ?? '') + (user.lastName?.[0] ?? '') || user.email[0];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><Logo variant="footer" width={150} priority /></div>
        <nav className="nav">
          <a href="#overview" className="nav-item active"><GridIcon /> Dashboard</a>
          <a href="#profile" className="nav-item"><UserIcon /> Profile</a>
          <a href="#documents" className="nav-item"><FileIcon /> Documents</a>
        </nav>
        <form action={logout} className="sidebar-foot">
          <button type="submit" className="nav-item"><LogoutIcon /> Log out</button>
        </form>
      </aside>

      <main className="main">
        <header className="header" id="overview">
          <div>
            <p className="eyebrow">Client dashboard</p>
            <h1>Welcome back, <span className="cap">{user.firstName || fullName}</span></h1>
          </div>
          <div className="user-chip">
            <span className="avatar">{initials.toUpperCase()}</span>
            <div className="user-chip-text">
              <span className="cap">{fullName}</span>
              <small>{user.email}</small>
            </div>
          </div>
        </header>

        <section className="stats">
          <div className="stat">
            <div className="stat-top">
              <span className="stat-label">Profile completion</span>
              <span className="stat-icon"><UserIcon /></span>
            </div>
            <span className="stat-value">{completion}%</span>
            <div className="progress"><span style={{ width: `${completion}%` }} /></div>
          </div>

          <div className="stat">
            <div className="stat-top">
              <span className="stat-label">Verification status</span>
              <span className="stat-icon"><ShieldIcon /></span>
            </div>
            <span className={`pill ${status.tone}`}>{status.label}</span>
            <span className="stat-note">{status.note}</span>
          </div>

          <div className="stat">
            <div className="stat-top">
              <span className="stat-label">Documents uploaded</span>
              <span className="stat-icon"><FileIcon /></span>
            </div>
            <span className="stat-value">{documents.length}</span>
            <span className="stat-note">
              {documents.length ? `Last upload ${formatDate(documents[0].uploadedAt)}` : 'No documents yet'}
            </span>
          </div>
        </section>

        <div className="columns">
          <section className="panel" id="profile">
            <div className="panel-head">
              <h2>Personal details</h2>
            </div>
            <DetailRow icon={<UserIcon />} label="First name" value={user.firstName} />
            <DetailRow icon={<UserIcon />} label="Last name" value={user.lastName} />
            <DetailRow
              icon={<MailIcon />}
              label="Email"
              value={user.email}
              extra={<span className={`pill sm ${user.emailVerified ? 'ok' : 'neutral'}`}>{user.emailVerified ? 'Verified' : 'Unverified'}</span>}
            />
            <DetailRow icon={<GlobeIcon />} label="Country of residence" value={user.country} />
            <DetailRow icon={<PhoneIcon />} label="Phone" value={user.phone} />
            <DetailRow icon={<TagIcon />} label="Partner code" value={user.partnerCode} />
          </section>

          <section className="panel" id="documents">
            <div className="panel-head">
              <h2>Identity verification</h2>
              <span className={`pill sm ${status.tone}`}>{status.label}</span>
            </div>
            <p className="panel-sub">Upload a clear copy of your identity document. Files are reviewed securely.</p>
            <DocumentUpload />

            <h3 className="list-title">Uploaded documents</h3>
            {documents.length === 0 ? (
              <p className="empty-state">Nothing uploaded yet.</p>
            ) : (
              <ul className="doc-list">
                {documents.map((d) => (
                  <li key={d.id}>
                    <span className="doc-icon"><FileIcon /></span>
                    <div className="doc-meta">
                      <span className="doc-name">{d.filename}</span>
                      <span className="doc-sub">{DOC_LABELS[d.docType] ?? d.docType} · {formatSize(d.size)} · {formatDate(d.uploadedAt)}</span>
                    </div>
                    <span className={`pill sm ${STATUS[d.sumsubStatus]?.tone ?? 'neutral'}`}>
                      {d.sumsubStatus === 'pending' && <ClockIcon />}
                      {STATUS[d.sumsubStatus]?.label ?? d.sumsubStatus}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
