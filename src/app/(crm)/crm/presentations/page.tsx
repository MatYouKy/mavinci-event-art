import { Suspense } from 'react';
import ShowcaseWorkspace from '@/components/crm/showcase/ShowcaseWorkspace';

export const metadata = { title: 'Prezentacje — Strefa sprzedawcy' };

// Strefa sprzedawcy → „Prezentacje”: materiały na spotkania z klientami — działy, karty, podgląd jak na iPadzie
// (dostęp sprawdza API: podgląd — dostęp do ofert albo „Prezentacje — podgląd”, przygotowanie — „Prezentacje — przygotowanie”).
export default function PresentationsPage() {
  return (
    <Suspense fallback={<main className="text-sm text-[#e5e4e2]/60">Ładowanie prezentacji…</main>}>
      <ShowcaseWorkspace />
    </Suspense>
  );
}
