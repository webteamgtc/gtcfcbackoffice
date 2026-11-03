// Building blocks of the client dashboard (server components; the upload form inside is a client component).
import DocumentUpload from '@/app/components/DocumentUpload';
import Logo from '@/app/components/Logo';
import { logout } from '@/app/actions/auth';
import { BRAND } from '@/lib/brand';
import { DOC_LABELS, STATUS, formatDate, formatSize } from '@/lib/kyc';
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  FileIcon,
  GlobeIcon,
  GridIcon,
  HelpIcon,
  HomeIcon,
  IdCardIcon,
  LogoutIcon,
  MailIcon,
  PhoneIcon,
  ShieldIcon,
  TagIcon,
  UserIcon
} from '@/app/components/icons';

export const REQ_ICONS = { identity: IdCardIcon, address: HomeIcon };

export function Pill({ status, small }) {
  const s = STATUS[status] ?? { label: status, tone: 'neutral' };
  return (
    <span className={`pill ${s.tone}${small ? ' sm' : ''}`}>
      {status === 'pending' && <ClockIcon />}
      {status === 'approved' && <CheckIcon />}
      {status === 'rejected' && <AlertIcon />}
      {s.label}
    </span>
  );
}

export function Ring({ value, size = 76, label }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <span className="ring" style={{ width: size, height: size }} role="img" aria-label={label ?? `${value}% complete`}>
      <svg viewBox="0 0 72 72" width={size} height={size} aria-hidden="true">
        <circle cx="36" cy="36" r={r} className="ring-track" />
        <circle cx="36" cy="36" r={r} className="ring-bar" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
      </svg>
      <strong>{value}%</strong>
    </span>
  );
}

const DETAIL_ROWS = [
  ['firstName', 'First name', UserIcon],
  ['lastName', 'Last name', UserIcon],
  ['email', 'Email', MailIcon],
  ['country', 'Country of residence', GlobeIcon],
  ['phone', 'Phone', PhoneIcon],
  ['partnerCode', 'Partner code', TagIcon]
];

export function Details({ user }) {
  return (
    <dl className="details">
      {DETAIL_ROWS.map(([key, label, Icon]) => (
        <div key={key} className="details-row">
          <span className="details-icon">
            <Icon />
          </span>
          <dt>{label}</dt>
          <dd className={user[key] ? '' : 'empty'}>
            {user[key] || 'Not provided'}
            {key === 'email' && <span className={`pill sm ${user.emailVerified ? 'ok' : 'neutral'}`}>{user.emailVerified ? 'Verified' : 'Unverified'}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** "My details" heading with how complete the profile is (fields are changed by our team, so we say how). */
export function DetailsCardTitle({ completion }) {
  return (
    <div className="panel-head">
      <div>
        <h2>My details</h2>
        <p className="panel-sub">{completion < 100 ? 'Something missing or wrong? Contact us and we’ll update it.' : 'All required details are complete.'}</p>
      </div>
      <span className="completion" title="Profile completion">
        <span className="completion-bar">
          <span style={{ width: `${completion}%` }} />
        </span>
        {completion}%
      </span>
    </div>
  );
}

export function HelpCard({ dark = false }) {
  return (
    <aside className={`help${dark ? ' is-dark' : ''}`}>
      <span className="help-icon">
        <HelpIcon />
      </span>
      <div>
        <h3>Need help?</h3>
        <p>If your details are wrong or a document keeps being refused, our team can help.</p>
        {BRAND.supportEmail && (
          <a className="help-link" href={`mailto:${BRAND.supportEmail}`}>
            {BRAND.supportEmail} <ArrowRightIcon />
          </a>
        )}
      </div>
    </aside>
  );
}

export function UserChip({ user, fullName }) {
  const initials = ((user.firstName?.[0] ?? '') + (user.lastName?.[0] ?? '') || user.email[0] || '?').toUpperCase();
  return (
    <div className="user-chip">
      <span className="avatar">{initials}</span>
      <span className="user-chip-text">
        <span className="cap">{fullName}</span>
        <small>{user.email}</small>
      </span>
    </div>
  );
}

const NAV = [
  ['#overview', 'Overview', GridIcon],
  ['#verification', 'Verification', ShieldIcon],
  ['#profile', 'My details', UserIcon]
];

/**
 * Page frame without a sidebar: a navy top bar over the hero with section links and the account,
 * a bottom tab bar on phones, and the entity name in the footer.
 */
export function Shell({ user, fullName, children }) {
  return (
    <div className="app">
      <header className="appbar">
        <div className="appbar-inner">
          <a href="#overview" className="appbar-logo" aria-label={`${BRAND.name} portal home`}>
            <Logo variant="footer" width={132} priority />
          </a>
          <nav className="appnav" aria-label="Dashboard">
            {NAV.map(([href, label, Icon], i) => (
              <a key={href} href={href} aria-current={i === 0 ? 'page' : undefined}>
                <Icon /> {label}
              </a>
            ))}
          </nav>
          <div className="appbar-end">
            <UserChip user={user} fullName={fullName} />
            <form action={logout}>
              <button type="submit" className="appbar-logout" aria-label="Log out" title="Log out">
                <LogoutIcon />
                <span>Log out</span>
              </button>
            </form>
          </div>
        </div>
      </header>
      {children}
      <footer className="app-foot">
        <span>
          © {new Date().getFullYear()} {BRAND.legalName}
        </span>
        <span>Your documents are uploaded over an encrypted connection.</span>
      </footer>
      <nav className="tabbar" aria-label="Dashboard sections">
        {NAV.map(([href, label, Icon], i) => (
          <a key={href} href={href} aria-current={i === 0 ? 'page' : undefined}>
            <Icon />
            {label}
          </a>
        ))}
      </nav>
    </div>
  );
}

/** Recent activity built from the uploads (upload date) and their review result. */
export function Activity({ documents }) {
  const items = [];
  for (const d of documents) {
    const label = DOC_LABELS[d.docType] ?? d.docType;
    if (d.sumsubStatus === 'approved') items.push({ key: `${d.id}-r`, tone: 'ok', title: `${label} verified`, sub: d.filename });
    if (d.sumsubStatus === 'rejected') items.push({ key: `${d.id}-r`, tone: 'bad', title: `${label} not accepted`, sub: 'Please upload a new copy' });
    if (d.sumsubStatus === 'pending') items.push({ key: `${d.id}-r`, tone: 'warn', title: `${label} under review`, sub: 'Our team is checking it' });
    items.push({ key: d.id, tone: 'brand', title: `${label} uploaded`, sub: `${d.filename} · ${formatSize(d.size)}`, date: d.uploadedAt });
  }
  items.push({ key: 'account', tone: 'brand', title: 'Account created', sub: 'Welcome to the client portal' });
  return (
    <ol className="activity">
      {items.map((it) => (
        <li key={it.key} className={`act tone-${it.tone}`}>
          <span className="act-dot" aria-hidden="true" />
          <span className="act-body">
            <strong>{it.title}</strong>
            <small>{it.sub}</small>
          </span>
          {it.date && <time dateTime={it.date}>{formatDate(it.date)}</time>}
        </li>
      ))}
    </ol>
  );
}

/** A premium document tile: big icon, status band, the latest file, and the upload form when it is needed. */
export function DocTile({ req, index }) {
  const Icon = REQ_ICONS[req.key];
  const needsUpload = req.status === 'not_started' || req.status === 'rejected';
  return (
    <article className={`tile st-${req.status}`} id={`doc-${req.key}`}>
      <div className="tile-band">
        <span className="tile-step">Step {index}</span>
        <Pill status={req.status} small />
      </div>
      <div className="tile-head">
        <span className="tile-icon">
          <Icon />
        </span>
        <div>
          <h3>{req.title}</h3>
          <p>{req.hint}</p>
        </div>
      </div>
      {req.latest && (
        <div className="req-file">
          <FileIcon />
          <span>
            <strong>{req.latest.filename}</strong>
            <small>
              {DOC_LABELS[req.latest.docType] ?? req.latest.docType} · {formatSize(req.latest.size)} · {formatDate(req.latest.uploadedAt)}
            </small>
          </span>
        </div>
      )}
      {req.status === 'rejected' && <p className="req-alert">This document could not be accepted. Please upload a clear, complete and valid copy.</p>}
      {req.status === 'pending' && <p className="tile-note">We’re checking this document. You don’t need to do anything.</p>}
      {req.status === 'approved' && <p className="tile-note ok">This document is confirmed.</p>}
      {needsUpload && (
        <DocumentUpload id={`tile-${req.key}`} types={req.types} submitLabel={req.status === 'rejected' ? 'Upload a new copy' : `Upload ${req.noun}`} />
      )}
    </article>
  );
}

/** Credential-style card: who the client is and where verification stands (hero of layout B). */
export function ProfileCard({ user, fullName, j }) {
  const initials = ((user.firstName?.[0] ?? '') + (user.lastName?.[0] ?? '') || user.email[0] || '?').toUpperCase();
  return (
    <div className={`credential st-${j.overall}`}>
      <div className="credential-top">
        <span className="credential-entity">{BRAND.name}</span>
        <ShieldIcon />
      </div>
      <div className="credential-id">
        <span className="credential-avatar">{initials}</span>
        <span>
          <strong className="cap">{fullName}</strong>
          <small>{user.country || 'Country not provided'}</small>
        </span>
      </div>
      <div className="credential-status">
        <span>
          <small>Verification</small>
          <strong>{j.overall === 'not_started' ? 'Not started' : STATUS[j.overall === 'rejected' ? 'action' : j.overall]?.label}</strong>
        </span>
        <Ring value={j.progress} size={64} />
      </div>
      <div className="credential-bar">
        {j.steps.map((s) => (
          <span key={s.key} className={`seg ${s.state}`} title={s.title} />
        ))}
      </div>
    </div>
  );
}
