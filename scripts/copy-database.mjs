// Copies every table (structure, indexes, foreign keys, AUTO_INCREMENT) and all rows from one MySQL database to another,
// then checks the row counts match. Run: npm run db:copy
//
//   Source: MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE (what the app uses now)
//   Target: TARGET_MYSQL_DATABASE (required), and TARGET_MYSQL_HOST / _PORT / _USER / _PASSWORD when the target needs
//           another server or account (each falls back to the source value).
//
// Safe to re-run: it stops if the target already has a table with rows, and it never changes the source.
// Values are copied as they are (encrypted columns stay encrypted with the same FIELD_ENCRYPTION_KEY).
import mysql from 'mysql2/promise';

const env = (k) => process.env[`TARGET_${k}`] || process.env[k];
const source = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
};
const target = {
  host: env('MYSQL_HOST'),
  port: Number(env('MYSQL_PORT') || 3306),
  user: env('MYSQL_USER'),
  password: env('MYSQL_PASSWORD'),
  database: process.env.TARGET_MYSQL_DATABASE
};
if (!target.database) {
  console.error('Set TARGET_MYSQL_DATABASE (e.g. TARGET_MYSQL_DATABASE=gtcfc_cat5_onboarding).');
  process.exit(1);
}
if (target.database === source.database && target.host === source.host) {
  console.error('Source and target are the same database.');
  process.exit(1);
}

// opens a connection and makes sure the database itself is usable (access to it is checked after the login)
async function open(cfg, label) {
  try {
    const conn = await mysql.createConnection({ ...cfg, charset: 'utf8mb4', timezone: 'Z', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 15000 });
    conn.on('error', () => {}); // reported by the query below instead of crashing the script
    // both sides in UTC, so TIMESTAMP values are copied unchanged
    await conn.query("SET time_zone = '+00:00'");
    await conn.query('SELECT 1 FROM information_schema.TABLES LIMIT 1');
    return conn;
  } catch (err) {
    console.error(`Could not open the ${label} database "${cfg.database}" on ${cfg.host} as ${cfg.user}: ${err.message}`);
    if (/denied/i.test(err.message)) console.error(`→ Give ${cfg.user} read/write access to "${cfg.database}" (Alibaba Cloud RDS console → Accounts), or set TARGET_MYSQL_USER / TARGET_MYSQL_PASSWORD.`);
    process.exit(1);
  }
}
const src = await open(source, 'source');
const dst = await open(target, 'target');

const [tables] = await src.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
const names = tables.map((t) => t.name);

// tables a table points to (foreign keys) are created and filled first
const [fks] = await src.query(
  'SELECT TABLE_NAME AS t, REFERENCED_TABLE_NAME AS r FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL'
);
const order = [];
const visit = (n, seen = new Set()) => {
  if (order.includes(n) || seen.has(n)) return;
  seen.add(n);
  for (const f of fks.filter((f) => f.t === n && f.r !== n)) visit(f.r, seen);
  order.push(n);
};
names.forEach((n) => visit(n));

// refuse to mix with data already in the target
for (const n of order) {
  const [exists] = await dst.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [n]);
  if (!exists.length) continue;
  const [[{ c }]] = await dst.query(`SELECT COUNT(*) AS c FROM \`${n}\``);
  if (c > 0) {
    console.error(`Target table ${target.database}.${n} already has ${c} row(s). Nothing was copied; empty or drop it first.`);
    process.exit(1);
  }
}

console.log(`Copying ${source.database} → ${target.database} (${order.join(', ')})`);
await dst.query('SET FOREIGN_KEY_CHECKS = 0');
for (const n of order) {
  const [[{ 'Create Table': ddl }]] = await src.query(`SHOW CREATE TABLE \`${n}\``);
  await dst.query(`DROP TABLE IF EXISTS \`${n}\``); // only ever an empty table, checked above
  await dst.query(ddl); // keeps AUTO_INCREMENT, so new ids continue after the copied ones

  const [rows] = await src.query(`SELECT * FROM \`${n}\``);
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const cols = Object.keys(batch[0]);
    const values = batch.map((r) => cols.map((c) => (r[c] !== null && typeof r[c] === 'object' && !Buffer.isBuffer(r[c]) ? JSON.stringify(r[c]) : r[c])));
    await dst.query(`INSERT INTO \`${n}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES ?`, [values]);
  }
  console.log(`  ${n}: ${rows.length} row(s)`);
}
await dst.query('SET FOREIGN_KEY_CHECKS = 1');

// check: same tables, same row counts
let ok = true;
for (const n of order) {
  const [[{ a }]] = await src.query(`SELECT COUNT(*) AS a FROM \`${n}\``);
  const [[{ b }]] = await dst.query(`SELECT COUNT(*) AS b FROM \`${n}\``);
  if (Number(a) !== Number(b)) {
    ok = false;
    console.error(`  MISMATCH ${n}: source ${a}, target ${b}`);
  }
}
console.log(ok ? `Done: every table copied and counts match. Now set MYSQL_DATABASE=${target.database} in .env.local and restart the app.` : 'Finished with mismatches (see above).');
await src.end();
await dst.end();
process.exit(ok ? 0 : 1);
