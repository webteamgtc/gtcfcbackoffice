import Link from 'next/link';
import Logo from '@/app/components/Logo';
import { adminLogout } from '@/app/dashboard-admin/actions';
import { ADMIN_HOME } from '@/lib/adminRoutes';
import Icon from './Icon';
import { displayName } from './format';

/**
 * Page frame of the back office: navy sidebar (menu, quick views with live counts, the signed-in person) and the page.
 * `active`: 'overview' | 'applications' · `status`: the status filter in use · `counts`: { pending, resubmit, rejected, approved }
 */
export default function AdminShell({ admin, active = 'overview', status = '', counts, children }) {
  const quick = [
    { key: 'pending', label: 'Under review', tone: 'warn' },
    { key: 'resubmit', label: 'Resubmit needed', tone: 'orange' },
    { key: 'rejected', label: 'Rejected', tone: 'bad' },
    { key: 'approved', label: 'Verified', tone: 'ok' }
  ];

  return (
    <div className="ad-app">
      <aside className="ad-side">
        <Link href={ADMIN_HOME} className="ad-brand" aria-label="Back office home">
          <Logo variant="footer" width={124} priority />
        </Link>
        <span className="ad-side-tag">Back office</span>

        <nav className="ad-nav" aria-label="Main">
          <p className="ad-nav-title">Menu</p>
          <Link href={ADMIN_HOME} className={`ad-nav-link${active === 'overview' ? ' is-active' : ''}`} aria-current={active === 'overview' ? 'page' : undefined}>
            <Icon name="grid" /> Overview
          </Link>
          <Link href={`${ADMIN_HOME}#applications`} className={`ad-nav-link${active === 'applications' ? ' is-active' : ''}`}>
            <Icon name="users" /> Applications
          </Link>
          <a href={`${ADMIN_HOME}/export`} className="ad-nav-link" download>
            <Icon name="download" /> Export CSV
          </a>

          {counts && (
            <>
              <p className="ad-nav-title ad-nav-quick">Quick views</p>
              {quick.map((q) => (
                <Link key={q.key} href={`${ADMIN_HOME}?status=${q.key}#applications`} className={`ad-nav-link${status === q.key ? ' is-active' : ''}`}>
                  <i className={`ad-dot ad-dot-${q.tone}`} /> {q.label}
                  <span className="ad-nav-count">{counts[q.key] ?? 0}</span>
                </Link>
              ))}
            </>
          )}
        </nav>

        <div className="ad-side-foot">
          <div className="ad-me">
            <span className="ad-avatar ad-av-me">{displayName(admin)[0]}</span>
            <span>
              <strong>{displayName(admin)}</strong>
              <small title={admin}>{admin}</small>
            </span>
          </div>
          <form action={adminLogout}>
            <button type="submit" className="ad-signout">
              <Icon name="logout" /> Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="ad-main">
        <main className="ad-wrap">{children}</main>
      </div>
    </div>
  );
}

export function StatusPill({ tone = 'neutral', children }) {
  return <span className={`ad-pill ad-pill-${tone}`}>{children}</span>;
}
