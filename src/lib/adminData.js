import 'server-only';
import { query, queryOne } from '@/lib/db';

/**
 * What the administrator pages read from MySQL (src/app/dashboard-admin). Read-only. Passwords and the encrypted ID / tax numbers are
 * never returned: the detail page only learns that they exist, and an administrator reveals one on purpose
 * (actions.js → revealSensitive, which logs it).
 * The column list of client_applications is looked up once, so a database that is missing an optional column still works.
 */
export const PAGE_SIZE = 20;
export const VERIFICATION = {
  not_started: { label: 'Not started', tone: 'neutral' },
  started: { label: 'In progress', tone: 'info' },
  pending: { label: 'Under review', tone: 'warn' },
  approved: { label: 'Verified', tone: 'ok' },
  resubmit: { label: 'Resubmit needed', tone: 'bad' },
  rejected: { label: 'Rejected', tone: 'bad' }
};
const STATUS_KEYS = Object.keys(VERIFICATION);

const SECRET_COLUMNS = ['passwordHash', 'idNumberEncrypted', 'tinEncrypted'];

let columnsCache;
async function columns() {
  columnsCache ??= new Set(
    (await query("SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_applications'")).map((r) => r.name)
  );
  return columnsCache;
}
async function dateColumn() {
  const cols = await columns();
  return ['submittedAt', 'createdAt', 'created_at'].find((c) => cols.has(c)) ?? null;
}
const has = async (name) => (await columns()).has(name);

const like = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** WHERE for the list / export, from the search form's values. */
async function filters({ q = '', status = '', country = '' }) {
  const where = [];
  const params = [];
  q = String(q).trim().slice(0, 80);
  if (q) {
    const parts = ["CONCAT_WS(' ', a.firstName, a.lastName) LIKE ?", 'a.email LIKE ?', 'a.phone LIKE ?'];
    params.push(like(q), like(q), like(q));
    if (await has('applicationReference')) {
      parts.push('a.applicationReference LIKE ?');
      params.push(like(q));
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  if (STATUS_KEYS.includes(status)) {
    if (status === 'not_started') where.push('v.status IS NULL');
    else {
      where.push('v.status = ?');
      params.push(status);
    }
  }
  if (/^[A-Za-z]{2}$/.test(country)) {
    where.push('a.country = ?');
    params.push(country.toUpperCase());
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const FROM = 'FROM client_applications a LEFT JOIN client_verifications v ON v.application_id = a.id';

async function listColumns() {
  const date = await dateColumn();
  const optional = ['applicationReference', 'accountType', 'partnerCode', 'nationality', 'phoneCountry'];
  const cols = await columns();
  return [
    'a.id',
    'a.firstName',
    'a.lastName',
    'a.email',
    'a.phone',
    'a.country',
    ...optional.filter((c) => cols.has(c)).map((c) => `a.${c}`),
    date ? `a.${date} AS submittedAt` : 'NULL AS submittedAt',
    "COALESCE(v.status, 'not_started') AS verification"
  ].join(', ');
}

/** One page of applications, newest first. → { rows, total, page, pages } */
export async function listApplications(filter, page = 1) {
  const { sql, params } = await filters(filter);
  const total = Number((await queryOne(`SELECT COUNT(*) AS n ${FROM} ${sql}`, params)).n);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.min(Math.max(1, Math.floor(Number(page)) || 1), pages);
  const rows = await query(`SELECT ${await listColumns()} ${FROM} ${sql} ORDER BY a.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, params);
  return { rows, total, page, pages };
}

/** Everything matching the filter (for the CSV export), capped. */
export async function exportApplications(filter, cap = 5000) {
  const { sql, params } = await filters(filter);
  return query(`SELECT ${await listColumns()} ${FROM} ${sql} ORDER BY a.id DESC LIMIT ${Number(cap) | 0}`, params);
}

/** The numbers on top of the dashboard. */
export async function getStats() {
  const date = await dateColumn();
  const total = Number((await queryOne('SELECT COUNT(*) AS n FROM client_applications')).n);
  let today = 0;
  let week = 0;
  if (date) {
    const r = await queryOne(
      `SELECT SUM(${date} >= UTC_DATE()) AS today, SUM(${date} >= UTC_TIMESTAMP() - INTERVAL 7 DAY) AS week FROM client_applications`
    );
    today = Number(r?.today ?? 0);
    week = Number(r?.week ?? 0);
  }
  const byStatus = Object.fromEntries(STATUS_KEYS.map((k) => [k, 0]));
  for (const r of await query(`SELECT COALESCE(v.status, 'not_started') AS status, COUNT(*) AS n ${FROM} GROUP BY 1`)) {
    if (r.status in byStatus) byStatus[r.status] = Number(r.n);
  }
  const countries = await query('SELECT country, COUNT(*) AS n FROM client_applications GROUP BY country ORDER BY n DESC LIMIT 6');

  // applications per day for the last 14 days (Dubai days, oldest first); the chart is a nicety, so a failure here is ignored
  const daily = [];
  if (date) {
    try {
      const rows = await query(
        `SELECT DATE_FORMAT(CONVERT_TZ(${date}, '+00:00', '+04:00'), '%Y-%m-%d') AS d, COUNT(*) AS n FROM client_applications WHERE ${date} >= UTC_TIMESTAMP() - INTERVAL 16 DAY GROUP BY d`
      );
      const counts = Object.fromEntries(rows.map((r) => [r.d, Number(r.n)]));
      const dubaiNow = Date.now() + 4 * 3600 * 1000;
      for (let i = 13; i >= 0; i--) {
        const key = new Date(dubaiNow - i * 86400000).toISOString().slice(0, 10);
        daily.push({ date: key, n: counts[key] ?? 0 });
      }
    } catch (err) {
      console.error('[admin] daily chart:', err.message);
      daily.length = 0;
    }
  }
  return { total, today, week, byStatus, daily, countries: countries.map((c) => ({ country: c.country, n: Number(c.n) })) };
}

/** Countries that have applications (for the filter drop-down). */
export async function applicationCountries() {
  return (await query('SELECT DISTINCT country FROM client_applications WHERE country IS NOT NULL AND country <> \'\' ORDER BY country')).map((r) => r.country);
}

const asJson = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

/** One application with its verification, files and documents; null when there is no such id. */
export async function getApplication(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const row = await queryOne('SELECT * FROM client_applications WHERE id = ?', [id]);
  if (!row) return null;

  const app = { ...row };
  for (const c of SECRET_COLUMNS) delete app[c];
  app.hasIdNumber = Boolean(row.idNumberEncrypted);
  app.hasTin = Boolean(row.tinEncrypted);
  app.agreements = asJson(row.agreements) ?? [];
  app.company = asJson(row.company);

  const [verification, files, documents] = await Promise.all([
    queryOne('SELECT * FROM client_verifications WHERE application_id = ?', [id]),
    query('SELECT id, field, filename, content_type, size, doc_type, side FROM application_files WHERE application_id = ? ORDER BY id', [id]),
    query('SELECT id, doc_type, filename, content_type, size, review_status, uploaded_at FROM client_documents WHERE application_id = ? ORDER BY uploaded_at DESC, id DESC', [id])
  ]);
  app.submittedAt = row.submittedAt ?? row.createdAt ?? row.created_at ?? null;
  return {
    app,
    verification: verification ? { ...verification, reject_labels: asJson(verification.reject_labels) ?? [] } : null,
    files,
    documents
  };
}

/** The encrypted columns of one application, for revealSensitive. */
export const getEncrypted = (id) => queryOne('SELECT idNumberEncrypted, tinEncrypted FROM client_applications WHERE id = ?', [id]);

/** A stored form file (with its content), or null. */
export const getFormFile = (id) =>
  /^\d+$/.test(String(id)) ? queryOne('SELECT id, filename, content_type, content FROM application_files WHERE id = ? AND application_id IS NOT NULL', [id]) : null;

/** Agreement `n` (0-based) of an application with what is needed to show it → { app, agreement } or null. */
export async function getAgreement(id, n) {
  if (!/^\d+$/.test(String(id)) || !/^\d+$/.test(String(n))) return null;
  const app = await queryOne('SELECT id, applicationReference, agreements FROM client_applications WHERE id = ?', [id]);
  const agreement = (asJson(app?.agreements) ?? [])[Number(n)];
  return agreement?.accepted ? { app, agreement } : null;
}

/** A dashboard document row (the file itself is in OSS, key in storage_key), or null. */
export const getDocument = (id) =>
  /^\d+$/.test(String(id)) ? queryOne('SELECT id, filename, content_type, storage_key FROM client_documents WHERE id = ?', [id]) : null;
