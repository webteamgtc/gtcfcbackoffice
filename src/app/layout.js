import './globals.css';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `Client portal | ${BRAND.name}`, robots: { index: false, follow: false } };
export const viewport = { themeColor: '#0b1440' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
