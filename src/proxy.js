import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { PORTAL_LOGIN_ENABLED } from '@/lib/features';

const encodedKey = new TextEncoder().encode(process.env.SESSION_SECRET);

// optimistic check only — pages and server actions verify the session themselves
export default async function proxy(req) {
  const { pathname } = req.nextUrl;

  // portal hidden: "/" shows the application form, everything else goes back to "/"
  if (!PORTAL_LOGIN_ENABLED) {
    if (pathname === '/') return NextResponse.rewrite(new URL('/apply', req.nextUrl));
    if (pathname === '/apply') return NextResponse.next();
    return NextResponse.redirect(new URL('/', req.nextUrl));
  }

  const token = req.cookies.get('session')?.value;
  let loggedIn = false;
  if (token) {
    try {
      await jwtVerify(token, encodedKey, { algorithms: ['HS256'] });
      loggedIn = true;
    } catch {}
  }

  if (pathname === '/login' && loggedIn) return NextResponse.redirect(new URL('/', req.nextUrl));
  if (pathname !== '/login' && !loggedIn) return NextResponse.redirect(new URL('/login', req.nextUrl));
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|pdf)$).*)']
};
