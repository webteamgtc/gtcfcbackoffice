import 'server-only';
import { createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_LOGIN } from '@/lib/adminRoutes';

/**
 * Administrator access for the back office (src/app/dashboard-admin). Separate from the client session:
 *   · its own cookie ("admin_session", 8 hours) signed with a key derived from SESSION_SECRET, so a client session can
 *     never open the admin pages and the other way round;
 *   · the people allowed in are listed in .env, not in the database:
 *       ADMIN_USERS=anna@gtcfx.com:<base64 bcrypt hash>,omar@gtcfx.com:<base64 bcrypt hash>
 *     Make an entry with:  node scripts/admin-hash.mjs anna@gtcfx.com 'her password'
 *     (the hash is base64 because a raw bcrypt hash contains "$", which .env files treat as a variable)
 *   · every page re-checks the cookie AND that the e-mail is still listed, so removing someone from ADMIN_USERS locks them
 *     out straight away.
 */
const COOKIE = 'admin_session';
const TTL_SECONDS = 8 * 60 * 60;

function signingKey() {
  if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set');
  return createHmac('sha256', process.env.SESSION_SECRET).update('admin-session-v1').digest();
}

/** { 'anna@gtcfx.com': '$2b$…' } from ADMIN_USERS. */
function admins() {
  const out = {};
  for (const entry of String(process.env.ADMIN_USERS ?? '').split(',')) {
    const i = entry.indexOf(':');
    if (i < 1) continue;
    const email = entry.slice(0, i).trim().toLowerCase();
    const hash = Buffer.from(entry.slice(i + 1).trim(), 'base64').toString('utf8');
    if (email && /^\$2[aby]\$/.test(hash)) out[email] = hash;
  }
  return out;
}

export const adminConfigured = () => Object.keys(admins()).length > 0;

// a hash to compare against when the e-mail is unknown, so a wrong e-mail takes as long as a wrong password
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

// best effort, in this server's memory: 5 wrong tries per e-mail+address, then 15 minutes of waiting
const tries = (globalThis._adminTries ??= new Map());
const WINDOW = 15 * 60 * 1000;
const MAX_TRIES = 5;
const tooMany = (k) => {
  const t = tries.get(k);
  if (!t || Date.now() - t.at > WINDOW) return false;
  return t.n >= MAX_TRIES;
};
const fail = (k) => {
  const t = tries.get(k);
  tries.set(k, !t || Date.now() - t.at > WINDOW ? { n: 1, at: Date.now() } : { n: t.n + 1, at: t.at });
};

/** → { ok: true, email } | { ok: false, reason: 'locked' | 'invalid' | 'not_configured' } */
export async function checkAdminLogin(email, password, ip = '') {
  const list = admins();
  if (!Object.keys(list).length) return { ok: false, reason: 'not_configured' };
  email = String(email ?? '').trim().toLowerCase();
  const key = `${email}|${ip}`;
  if (tooMany(key)) return { ok: false, reason: 'locked' };
  const match = await bcrypt.compare(String(password ?? ''), list[email] ?? DUMMY_HASH);
  if (!match || !list[email]) {
    fail(key);
    return { ok: false, reason: 'invalid' };
  }
  tries.delete(key);
  return { ok: true, email };
}

export async function createAdminSession(email) {
  const token = await new SignJWT({ admin: email })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience('admin')
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(signingKey());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: TTL_SECONDS,
    path: '/' // the sign-in page (/dashboard/…) and the dashboard (/dashboard-admin/…) are different paths
  });
}

export async function deleteAdminSession() {
  (await cookies()).delete({ name: COOKIE, path: '/' });
}

/** The signed-in administrator's e-mail, or null. */
export async function getAdmin() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'], audience: 'admin' });
    const email = String(payload.admin ?? '').toLowerCase();
    return admins()[email] ? email : null; // removed from ADMIN_USERS → out
  } catch {
    return null;
  }
}

/** For admin pages, actions and routes: the administrator's e-mail, or sends the visitor to the sign-in page. */
export async function requireAdmin() {
  const email = await getAdmin();
  if (!email) redirect(ADMIN_LOGIN);
  return email;
}
