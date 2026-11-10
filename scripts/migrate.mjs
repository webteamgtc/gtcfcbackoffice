// Creates the tables in db/schema.sql (idempotent) and prints what is there. Run: npm run db:migrate
// Reads MYSQL_* from the environment (`node --env-file=.env.local`).
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const conn = await mysql
  .createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    ssl: process.env.MYSQL_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    multipleStatements: true,
    connectTimeout: 15000
  })
  .catch((err) => {
    console.error(`Could not connect to ${process.env.MYSQL_HOST} as ${process.env.MYSQL_USER}: ${err.message}`);
    process.exit(1);
  });

const sql = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
await conn.query(sql);

// upgrades for tables created by an earlier schema.sql (CREATE TABLE IF NOT EXISTS leaves existing tables alone)
const hasColumn = async (table, column) =>
  (await conn.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, column]))[0].length > 0;

// client_documents: file content moved from a MEDIUMBLOB column to OSS (storage_key)
if ((await hasColumn('client_documents', 'content')) && !(await hasColumn('client_documents', 'storage_key'))) {
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM client_documents');
  if (n > 0) {
    console.warn(`client_documents has ${n} file(s) stored in the database; move them to OSS before dropping the content column.`);
  } else {
    await conn.query('ALTER TABLE client_documents DROP COLUMN content, ADD COLUMN storage_key VARCHAR(512) NOT NULL AFTER size');
    console.log('client_documents: content column replaced by storage_key (files now in OSS).');
  }
}

// client_applications: the 3-step form (personal → contact → agreement) leaves the Sumsub-collected columns and the
// password empty, so they become optional; the mobile gets its own country code and verification time
const OPTIONAL = [
  'emailVerifiedAt', 'passwordHash', 'idNumberEncrypted', 'idType', 'idLastName', 'idFirstName', 'poaCountry', 'postalCode', 'address', 'education', 'employment',
  'industry', 'occupation', 'experienceYears', 'income', 'sourceOfFunds', 'investmentExperience', 'marketExperience', 'usCitizen', 'pep'
];
const [colInfo] = await conn.query(
  `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_COMMENT AS comment, CHARACTER_SET_NAME AS cs, COLLATION_NAME AS coll
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_applications'`
);
const stillRequired = colInfo.filter((c) => OPTIONAL.includes(c.name) && c.nullable === 'NO');
if (stillRequired.length) {
  // MODIFY restates the whole column, so type, character set and comment are kept as they are
  const modify = stillRequired.map(
    (c) => `MODIFY COLUMN \`${c.name}\` ${c.type}${c.cs ? ` CHARACTER SET ${c.cs} COLLATE ${c.coll}` : ''} NULL${c.comment ? ` COMMENT ${conn.escape(c.comment)}` : ''}`
  );
  await conn.query(`ALTER TABLE client_applications ${modify.join(', ')}`);
  console.log(`client_applications: made optional → ${stillRequired.map((c) => c.name).join(', ')}`);
}
const add = [];
if (!colInfo.some((c) => c.name === 'phoneCountry')) add.push("ADD COLUMN phoneCountry VARCHAR(16) NULL COMMENT 'Country code of the mobile''s dialling code (older rows: see country)' AFTER phone");
if (!colInfo.some((c) => c.name === 'phoneVerifiedAt')) add.push("ADD COLUMN phoneVerifiedAt DATETIME NULL COMMENT 'UTC time the WhatsApp code was verified' AFTER phoneCountry");
if (!colInfo.some((c) => c.name === 'accountType')) add.push("ADD COLUMN accountType VARCHAR(20) NULL COMMENT 'individual | corporate' AFTER agreements");
if (!colInfo.some((c) => c.name === 'company')) add.push("ADD COLUMN company JSON NULL COMMENT 'Corporate clients: company details, authorised person, shareholders, license' AFTER accountType");
if (add.length) {
  await conn.query(`ALTER TABLE client_applications ${add.join(', ')}`);
  console.log(`client_applications: ${add.map((a) => a.split(' ')[2]).join(', ')} added`);
}

const [tables] = await conn.query(
  "SELECT TABLE_NAME AS name, TABLE_ROWS AS approxRows FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('client_applications', 'application_files', 'client_verifications', 'email_otps', 'client_documents', 'max_onboarding')"
);
console.log(`Schema applied to ${process.env.MYSQL_DATABASE}:`);
console.table(tables);
await conn.end();
