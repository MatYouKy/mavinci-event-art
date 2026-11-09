import type { Metadata, Viewport } from 'next';
import '@/index.css';

// Osobny, lekki układ dla graczy na telefonach: bez menu, stopki i skryptów strony.
export const metadata: Metadata = {
  title: 'Mavinci LIVE — graj',
  description: 'Odpowiadaj w quizie Mavinci LIVE z telefonu.',
  robots: { index: false, follow: false },
  icons: { icon: [{ url: '/signature.png', type: 'image/png' }], apple: '/signature.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#1c1f33',
};

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body className="min-h-screen bg-[#0f1119] text-[#e5e4e2] antialiased">{children}</body>
    </html>
  );
}
