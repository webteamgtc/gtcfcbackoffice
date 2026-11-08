import { redirect } from 'next/navigation';
import Logo from '@/app/components/Logo';
import { adminConfigured, getAdmin } from '@/lib/admin';
import { ADMIN_HOME } from '@/lib/adminRoutes';
import { BRAND } from '@/lib/brand';
import AdminLoginForm from './AdminLoginForm';

export const dynamic = 'force-dynamic';

export default async function AdminLoginPage() {
  if (await getAdmin()) redirect(ADMIN_HOME);
  const configured = adminConfigured();

  return (
    <main className="ad-login">
      <div className="ad-login-card">
        <Logo />
        <span className="ad-badge">Back office</span>
        <h1>Administrator sign in</h1>
        <p className="ad-muted">Review client applications and verification results for {BRAND.name}.</p>
        {configured ? (
          <AdminLoginForm />
        ) : (
          <div className="ad-note" role="alert">
            <strong>Administrator access is not set up yet.</strong>
            <p>
              Create a login with <code>node scripts/admin-hash.mjs you@company.com &apos;your password&apos;</code>, put the printed text in{' '}
              <code>ADMIN_USERS</code> in <code>.env.local</code>, and restart the server.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
