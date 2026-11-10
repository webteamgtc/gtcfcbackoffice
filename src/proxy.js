import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { ADMIN_HOME, ADMIN_LOGIN } from '@/lib/adminRoutes';
import { PORTAL_LOGIN_ENABLED } from '@/lib/features';

const encodedKey = new TextEncoder().encode(process.env.SESSION_SECRET);

async function signedIn(req) {
  const token = req.cookies.get('session')?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, encodedKey, { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

// optimistic check only — pages and server actions verify the session themselves
export default async function proxy(req) {
  const { pathname } = req.nextUrl;

  // back office: has its own sign-in (src/lib/admin.js); every admin page, action and route checks it itself
  if (pathname === ADMIN_LOGIN || pathname === ADMIN_HOME || pathname.startsWith(`${ADMIN_HOME}/`)) return NextResponse.next();

  const loggedIn = await signedIn(req);

  // portal hidden: "/" is the application form, or the client's own page once they are signed in (by applying, or with
  // an e-mail code on /login); everything else apart from the application pages goes back to "/"
  if (!PORTAL_LOGIN_ENABLED) {
    if (pathname === '/') return loggedIn ? NextResponse.next() : NextResponse.rewrite(new URL('/apply', req.nextUrl));
    if (['/apply', '/success', '/failed', '/login'].includes(pathname)) return NextResponse.next();
    return NextResponse.redirect(new URL('/', req.nextUrl));
  }

  if (pathname === '/login' && loggedIn) return NextResponse.redirect(new URL('/', req.nextUrl));
  if (pathname !== '/login' && !loggedIn) return NextResponse.redirect(new URL('/login', req.nextUrl));
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|pdf)$).*)']
};
