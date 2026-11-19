import { Suspense } from 'react';
import SocialMediaWorkspace from '@/components/crm/social/SocialMediaWorkspace';

export const metadata = { title: 'Social media — Marketing' };

// Marketing → „Social media”: kalendarz publikacji, kreator grafik z szablonu marki i biblioteka zdjęć (dostęp sprawdza API).
export default function SocialMediaPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#0f1119] p-6 text-[#e5e4e2]/60">Ładowanie social media…</main>}>
      <SocialMediaWorkspace />
    </Suspense>
  );
}
