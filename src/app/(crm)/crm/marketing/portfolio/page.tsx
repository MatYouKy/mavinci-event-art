import { Suspense } from 'react';
import PortfolioWorkspace from '@/components/crm/portfolio/PortfolioWorkspace';

export const metadata = { title: 'Realizacje — Marketing' };

// Marketing → „Realizacje”: portfolio strony mavinci.pl — kopie robocze, SEO, zdjęcia i publikacja (dostęp sprawdza API).
export default function PortfolioPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#0f1119] p-6 text-[#e5e4e2]/60">Ładowanie realizacji…</main>}>
      <PortfolioWorkspace />
    </Suspense>
  );
}
