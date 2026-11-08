import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';
import { ADMIN_HOME } from '@/lib/adminRoutes';
import { applicationCountries, getStats, listApplications, PAGE_SIZE, VERIFICATION } from '@/lib/adminData';
import AdminShell, { StatusPill } from './AdminShell';
import Icon from './Icon';
import { ago, avatarTone, countryFlag, countryLabel, countryName, dateTime, fullName, greeting, initials, isNew, longDate, displayName, phoneLabel } from './format';

export const dynamic = 'force-dynamic';

const first = (v) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Keeps the search form's values in the links (tabs, pages, export). */
const href = (base, params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
};

// order of the status tabs and colours of the breakdown bar
const TABS = ['pending', 'resubmit', 'rejected', 'approved', 'started', 'not_started'];
const BAR = { pending: '#e0a030', resubmit: '#e8742a', rejected: '#c93a3a', approved: '#1f9d6b', started: '#4f63d2', not_started: '#c3c9da' };

export default async function AdminDashboard({ searchParams }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const filter = { q: first(sp.q).slice(0, 80), status: first(sp.status), country: first(sp.country) };

  let data;
  try {
    const [stats, list, countries] = await Promise.all([getStats(), listApplications(filter, first(sp.page)), applicationCountries()]);
    data = { stats, list, countries };
  } catch (err) {
    console.error('[admin] dashboard:', err.message);
    return (
      <AdminShell admin={admin}>
        <div className="ad-note ad-note-bad" role="alert">
          <strong>The database could not be reached.</strong>
          <p>Check the MYSQL_* settings and that this server is allowed to connect, then reload the page.</p>
        </div>
      </AdminShell>
    );
  }
  const { stats, list, countries } = data;
  const b = stats.byStatus;
  const attention = b.resubmit + b.rejected;
  const filtered = Boolean(filter.q || filter.status || filter.country);
  const maxCountry = Math.max(1, ...stats.countries.map((c) => c.n));
  const maxDay = Math.max(1, ...stats.daily.map((d) => d.n));
  const inPeriod = stats.daily.reduce((n, d) => n + d.n, 0);
  const pct = (n) => (stats.total ? Math.round((n / stats.total) * 100) : 0);
  const tabHref = (status) => `${href(ADMIN_HOME, { q: filter.q, country: filter.country, status })}#applications`;
  const pageLink = (p) => `${href(ADMIN_HOME, { ...filter, page: p > 1 ? String(p) : '' })}#applications`;
  const from = list.total ? (list.page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(list.total, list.page * PAGE_SIZE);
  const needsHref = tabHref(b.resubmit > 0 ? 'resubmit' : 'rejected');

  return (
    <AdminShell admin={admin} active="overview" status={filter.status} counts={{ pending: b.pending, resubmit: b.resubmit, rejected: b.rejected, approved: b.approved }}>
      {/* welcome */}
      <section className="ad-hero">
        <div>
          <p className="ad-eyebrow">{longDate()}</p>
          <h1>
            {greeting()}, {displayName(admin).split(' ')[0]}
          </h1>
          <p>
            {b.pending > 0 ? (
              <>
                <strong>{b.pending}</strong> {b.pending === 1 ? 'application is' : 'applications are'} waiting for review
              </>
            ) : (
              'No application is waiting for review right now'
            )}
            {stats.week > 0 && (
              <>
                {' '}
                · <strong>{stats.week}</strong> new in the last 7 days
              </>
            )}
            .
          </p>
        </div>
        <div className="ad-hero-actions">
          <Link href={tabHref(b.pending > 0 ? 'pending' : '')} className="ad-btn ad-btn-light">
            {b.pending > 0 ? 'Start reviewing' : 'View applications'} <Icon name="arrow" size={16} />
          </Link>
        </div>
      </section>

      {/* numbers */}
      <section className="ad-stats" aria-label="Summary">
        <div className="ad-stat">
          <span className="ad-stat-icon ad-tone-brand">
            <Icon name="users" size={22} />
          </span>
          <div>
            <span className="ad-stat-label">Total applications</span>
            <strong>{stats.total}</strong>
            <span className="ad-stat-sub">
              {stats.today} today · {stats.week} this week
            </span>
          </div>
        </div>
        <Link href={tabHref('pending')} className="ad-stat ad-stat-link">
          <span className="ad-stat-icon ad-tone-warn">
            <Icon name="clock" size={22} />
          </span>
          <div>
            <span className="ad-stat-label">Under review</span>
            <strong>{b.pending}</strong>
            <span className="ad-stat-sub">Waiting for a decision →</span>
          </div>
        </Link>
        <Link href={tabHref('approved')} className="ad-stat ad-stat-link">
          <span className="ad-stat-icon ad-tone-ok">
            <Icon name="checkCircle" size={22} />
          </span>
          <div>
            <span className="ad-stat-label">Verified</span>
            <strong>{b.approved}</strong>
            <span className="ad-stat-sub">{pct(b.approved)}% of all applications</span>
          </div>
        </Link>
        <Link href={needsHref} className="ad-stat ad-stat-link">
          <span className="ad-stat-icon ad-tone-bad">
            <Icon name="alert" size={22} />
          </span>
          <div>
            <span className="ad-stat-label">Needs attention</span>
            <strong>{attention}</strong>
            <span className="ad-stat-sub">
              {b.resubmit} resubmit · {b.rejected} rejected
            </span>
          </div>
        </Link>
      </section>

      {/* charts */}
      <section className="ad-two">
        <div className="ad-card">
          <div className="ad-card-head">
            <div>
              <h2>New applications</h2>
              <p className="ad-muted">Last 14 days</p>
            </div>
            <span className="ad-big">{inPeriod}</span>
          </div>
          {stats.daily.length ? (
            <div className="ad-chart" role="img" aria-label={`${inPeriod} new applications in the last 14 days`}>
              {stats.daily.map((d) => {
                const day = new Date(`${d.date}T00:00:00Z`);
                return (
                  <div key={d.date} className="ad-bar-col" title={`${day.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })}: ${d.n}`}>
                    <span className="ad-bar-n">{d.n || ''}</span>
                    <span className="ad-bar-track">
                      <i className={d.n ? '' : 'is-zero'} style={{ height: d.n ? `${Math.max(8, (d.n / maxDay) * 100)}%` : '3px' }} />
                    </span>
                    <span className="ad-bar-label">{day.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric' })}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="ad-muted">The chart appears once applications carry a submission date.</p>
          )}
        </div>

        <div className="ad-card">
          <div className="ad-card-head">
            <div>
              <h2>Verification status</h2>
              <p className="ad-muted">All {stats.total} applications</p>
            </div>
          </div>
          <div className="ad-split" role="img" aria-label="Share of applications per verification status">
            {TABS.filter((k) => b[k] > 0).map((k) => (
              <i key={k} style={{ width: `${(b[k] / Math.max(1, stats.total)) * 100}%`, background: BAR[k] }} title={`${VERIFICATION[k].label}: ${b[k]}`} />
            ))}
          </div>
          <ul className="ad-legend">
            {TABS.map((k) => (
              <li key={k}>
                <Link href={tabHref(k)}>
                  <i style={{ background: BAR[k] }} />
                  <span>{VERIFICATION[k].label}</span>
                  <strong>{b[k]}</strong>
                  <small>{pct(b[k])}%</small>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {stats.countries.length > 0 && (
        <section className="ad-card ad-countries" aria-label="Top countries">
          <div className="ad-card-head">
            <div>
              <h2>Where applicants live</h2>
              <p className="ad-muted">Top countries</p>
            </div>
          </div>
          <ul>
            {stats.countries.map((c) => (
              <li key={c.country}>
                <Link href={`${href(ADMIN_HOME, { country: c.country })}#applications`}>
                  <span className="ad-c-name">
                    {countryFlag(c.country)} {countryName(c.country)}
                  </span>
                  <span className="ad-c-bar">
                    <i style={{ width: `${Math.max(6, (c.n / maxCountry) * 100)}%` }} />
                  </span>
                  <span className="ad-c-n">{c.n}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* applications */}
      <section className="ad-card ad-list" id="applications">
        <div className="ad-card-head">
          <div>
            <h2>Applications</h2>
            <p className="ad-muted">
              {list.total} {list.total === 1 ? 'result' : 'results'}
              {filtered ? ' for your filters' : ''} · times are Dubai time
            </p>
          </div>
          <a href={href(`${ADMIN_HOME}/export`, filter)} className="ad-btn ad-btn-ghost ad-btn-small" download>
            <Icon name="download" size={15} /> Export CSV
          </a>
        </div>

        <div className="ad-tabs" role="tablist" aria-label="Filter by status">
          <Link href={tabHref('')} className={`ad-tab${filter.status ? '' : ' is-active'}`} role="tab" aria-selected={!filter.status}>
            All <span>{stats.total}</span>
          </Link>
          {TABS.map((k) => (
            <Link key={k} href={tabHref(k)} className={`ad-tab${filter.status === k ? ' is-active' : ''}`} role="tab" aria-selected={filter.status === k}>
              {VERIFICATION[k].label} <span>{b[k]}</span>
            </Link>
          ))}
        </div>

        <form className="ad-filters" action={`${ADMIN_HOME}#applications`} method="get">
          {filter.status && <input type="hidden" name="status" value={filter.status} />}
          <label className="ad-search">
            <Icon name="search" size={17} />
            <input type="search" name="q" defaultValue={filter.q} placeholder="Search name, email, phone or reference" aria-label="Search" maxLength={80} />
          </label>
          <select name="country" defaultValue={filter.country} aria-label="Country">
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {countryName(c)}
              </option>
            ))}
          </select>
          <button type="submit" className="ad-btn">
            Search
          </button>
          {filtered && (
            <Link href={`${ADMIN_HOME}#applications`} className="ad-btn ad-btn-ghost">
              Clear filters
            </Link>
          )}
        </form>

        {list.rows.length === 0 ? (
          <div className="ad-empty">
            <span className="ad-empty-icon">
              <Icon name="inbox" size={28} />
            </span>
            <strong>{filtered ? 'No application matches your filters' : 'No applications yet'}</strong>
            <p className="ad-muted">{filtered ? 'Try a different name, or clear the filters.' : 'New applications appear here as soon as clients submit the form.'}</p>
            {filtered && (
              <Link href={`${ADMIN_HOME}#applications`} className="ad-btn ad-btn-small">
                Clear filters
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="ad-table-wrap">
              <table className="ad-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Contact</th>
                    <th>Country</th>
                    <th>Submitted</th>
                    <th>Verification</th>
                    <th aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((r) => {
                    const v = VERIFICATION[r.verification] ?? VERIFICATION.not_started;
                    return (
                      <tr key={r.id}>
                        <td>
                          <Link href={`${ADMIN_HOME}/applications/${r.id}`} className="ad-person" aria-label={`Open ${fullName(r)}`}>
                            <span className={`ad-avatar ad-av-${avatarTone(r)}`}>{initials(r)}</span>
                            <span>
                              <strong>
                                {fullName(r)}
                                {isNew(r.submittedAt) && <em className="ad-new">New</em>}
                              </strong>
                              <small>
                                {r.applicationReference ?? `#${r.id}`}
                                {r.accountType === 'corporate' ? ' · Corporate' : ''}
                              </small>
                            </span>
                          </Link>
                        </td>
                        <td>
                          <span className="ad-cell-main">{r.email}</span>
                          <small>{r.phone ? phoneLabel(r.phone, r.phoneCountry || r.country) : ''}</small>
                        </td>
                        <td>{countryLabel(r.country)}</td>
                        <td>
                          <span className="ad-cell-main">{dateTime(r.submittedAt)}</span>
                          <small>{ago(r.submittedAt)}</small>
                        </td>
                        <td>
                          <StatusPill tone={v.tone}>{v.label}</StatusPill>
                        </td>
                        <td className="ad-right">
                          <span className="ad-open" aria-hidden="true">
                            Open <Icon name="arrow" size={15} />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="ad-pager">
              <span className="ad-muted">
                Showing {from}–{to} of {list.total}
              </span>
              <nav aria-label="Pages">
                {list.page > 1 ? (
                  <Link href={pageLink(list.page - 1)} className="ad-btn ad-btn-ghost ad-btn-small">
                    <Icon name="arrowLeft" size={15} /> Previous
                  </Link>
                ) : (
                  <span className="ad-btn ad-btn-ghost ad-btn-small is-disabled">
                    <Icon name="arrowLeft" size={15} /> Previous
                  </span>
                )}
                <span className="ad-page">
                  Page {list.page} of {list.pages}
                </span>
                {list.page < list.pages ? (
                  <Link href={pageLink(list.page + 1)} className="ad-btn ad-btn-ghost ad-btn-small">
                    Next <Icon name="arrow" size={15} />
                  </Link>
                ) : (
                  <span className="ad-btn ad-btn-ghost ad-btn-small is-disabled">
                    Next <Icon name="arrow" size={15} />
                  </span>
                )}
              </nav>
            </div>
          </>
        )}
      </section>
    </AdminShell>
  );
}
