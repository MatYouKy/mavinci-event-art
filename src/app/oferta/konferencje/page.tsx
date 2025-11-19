export const dynamic = 'force-dynamic';
export const revalidate = 0;

import ConferencesPage from './ConferencesPage';
import { buildMetadataForSlug } from '@/lib/seo-helpers';
import OfferLayout from '../OfferLayout';
import { Mic, Presentation } from 'lucide-react';

const pageSlug = 'oferta/konferencje';

export async function generateMetadata() {
  return buildMetadataForSlug(pageSlug);
}

export default async function Page() {
  return (
    <OfferLayout 
      etykieta={{
        title: 'Obsługa Konferencji',
        icon: <Presentation className="w-5 h-5 text-[#d3bb73]" />
      }}
      pageSlug={pageSlug}
      heroImageBucket="conferences_hero"
      defaultHeroImage="https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/site-images/hero/1760377870398-c8qd5w.jpg"
      section="konferencje-hero"
      descriptionSection={{
        title: 'Profesjonalizm i Technika',
        description: 'Kompleksowa obsługa audio-video, streaming live, wielokamerowa realizacja. Od małych szkoleń po duże konferencje międzynarodowe.',
        icon: <Mic className="w-24 h-24 text-[#d3bb73] mb-6" />
      }}
      >
      <ConferencesPage />
    </OfferLayout>
  );
}