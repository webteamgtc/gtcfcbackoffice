import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const encodedKey = new TextEncoder().encode(process.env.SESSION_SECRET);
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export async function encrypt(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(encodedKey);
}

export async function decrypt(session) {
  if (!session) return null;
  try {
    const { payload } = await jwtVerify(session, encodedKey, { algorithms: ['HS256'] });
    return payload;
  } catch {
    return null;
  }
}

export async function createSession(user) {
  const expiresAt = new Date(Date.now() + SEVEN_DAYS);
  const session = await encrypt({ userId: user.id, name: user.name });
  const cookieStore = await cookies();
  cookieStore.set('session', session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    sameSite: 'lax',
    path: '/'
  });
}

export async function getSession() {
  const cookieStore = await cookies();
  return decrypt(cookieStore.get('session')?.value);
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete('session');
}
