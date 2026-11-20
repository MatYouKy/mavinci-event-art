import { Suspense } from 'react';
import MaterialsWorkspace from '@/components/crm/materials/MaterialsWorkspace';

export const metadata = { title: 'Materiały' };

// Materiały — baza plików firmy: foldery marek, podgląd, wysyłka, kosz i wyszukiwanie z plikami wydarzeń (dostęp sprawdza API).
export default function MaterialsPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#0f1119] p-6 text-[#e5e4e2]/60">Ładowanie Materiałów…</main>}>
      <MaterialsWorkspace />
    </Suspense>
  );
}
