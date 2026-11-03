import './globals.css';

export const metadata = { title: 'GTCFX' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
