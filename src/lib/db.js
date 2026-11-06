import 'server-only';
import mysql from 'mysql2/promise';

/**
 * MySQL (Alibaba Cloud RDS / PolarDB). Configure in .env:
 *   MYSQL_HOST, MYSQL_PORT (3306), MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, MYSQL_SSL ("true" to require TLS)
 * Tables: db/schema.sql (`npm run db:migrate`).
 */
// reuse one pool across hot reloads in dev and across requests in prod
const globalForDb = globalThis;

function createPool() {
  for (const k of ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DATABASE']) if (!process.env[k]) throw new Error(`${k} is not set`);
  return mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    ssl: process.env.MYSQL_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    charset: 'utf8mb4',
    timezone: 'Z', // DATETIME columns hold UTC
    dateStrings: ['DATE'], // DATE columns come back as 'YYYY-MM-DD', not shifted Date objects
    connectionLimit: 10,
    connectTimeout: 10000,
    waitForConnections: true
  });
}

export function getPool() {
  globalForDb._mysqlPool ??= createPool();
  return globalForDb._mysqlPool;
}

/** Runs a parameterised statement (`?` placeholders). SELECT → rows; INSERT/UPDATE/DELETE → result ({ insertId, affectedRows }). */
export async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

/** First row of a SELECT, or null. */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

export const isDuplicate = (err) => err?.code === 'ER_DUP_ENTRY';
