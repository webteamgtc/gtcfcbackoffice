import './admin.css';
import { requireAdmin } from '@/lib/admin';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `Back office | ${BRAND.name}`, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }) {
  // sends a visitor who is not signed in to the sign-in page before anything (even the loading skeleton) is sent;
  // pages, actions and routes still check for themselves, because a layout is not re-run on every navigation
  await requireAdmin();
  return <div className="ad">{children}</div>;
}
