import '@/app/dashboard-admin/admin.css';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `Administrator sign in | ${BRAND.name}`, robots: { index: false, follow: false } };

export default function AdminLoginLayout({ children }) {
  return <div className="ad">{children}</div>;
}
