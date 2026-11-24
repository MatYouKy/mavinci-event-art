import type { Metadata, Viewport } from 'next';
import '@/index.css';

// Osobny, lekki układ stron dla odbiorców linków do pobrania (`/pobierz/<token>`): bez menu, stopki i skryptów strony
// (bez Google Analytics), poza wyszukiwarkami. Wygląd marki linku (logo, kolor, font nagłówków) ustawia sama strona.
export const metadata: Metadata = {
  title: 'Pliki do pobrania',
  referrer: 'no-referrer',
  robots: { index: false, follow: false, nocache: true, nosnippet: true, googleBot: { index: false, follow: false, nosnippet: true } },
  icons: { icon: [{ url: '/signature.png', type: 'image/png' }], apple: '/signature.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#100207',
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body className="brand-theme min-h-screen bg-[#100207] text-[#e5e4e2] antialiased">{children}</body>
    </html>
  );
}
