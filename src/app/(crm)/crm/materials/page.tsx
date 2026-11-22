import { Suspense } from 'react';
import DriveWorkspace from '@/components/crm/drive/DriveWorkspace';

export const metadata = { title: 'Dysk' };

// Dysk — chmura firmy jak w Finderze: Eventy, Materiały, Oferty, Kalkulacje, Umowy i Magazyn (działy i dostęp sprawdza API).
// Adres zostaje `/crm/materials` — dotychczasowe odnośniki do Materiałów (marka, folder) dalej otwierają Materiały.
export default function DrivePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#0f1119] p-6 text-[#e5e4e2]/60">Ładowanie Dysku…</main>}>
      <DriveWorkspace />
    </Suspense>
  );
}
