export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { buildMetadataForSlug } from '@/lib/seo-helpers';
import OfferLayout from '../OfferLayout';
import QuizyTeleturniejePage from './QuizyTeleturniejePage';

const pageSlug = 'oferta/quizy-teleturnieje'; 

export async function generateMetadata() {
  return buildMetadataForSlug(pageSlug);
}

export default async function Page() {
  return (
    <OfferLayout
      pageSlug={pageSlug}
      section="quizy-teleturnieje-hero"
    >
      <QuizyTeleturniejePage />
    </OfferLayout>
  );
}