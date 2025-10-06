import type { Metadata } from 'next';
import { AuthProvider } from '@/contexts/AuthContext';
import { Providers } from './providers';
import '@/index.css';

export const metadata: Metadata = {
  title: 'MAVINCI Event & ART',
  description: 'Kompleksowa obsługa eventów - DJ, nagłośnienie, oświetlenie sceniczne, streamingi',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pl">
      <body>
        <Providers>
          <AuthProvider>
            {children}
          </AuthProvider>
        </Providers>
      </body>
    </html>
  );
}
