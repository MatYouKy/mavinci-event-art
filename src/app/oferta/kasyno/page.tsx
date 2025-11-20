export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { buildMetadataForSlug } from '@/lib/seo-helpers';
import OfferLayout from '../OfferLayout';
import KasynoPage from './KasynoPage';

const pageSlug = 'oferta/konferencje';

export async function generateMetadata() {
  return buildMetadataForSlug(pageSlug);
}

export default async function Page() {
  return (
    <OfferLayout
      pageSlug={pageSlug}
      section="kasyno"
    >
      <KasynoPage />
    </OfferLayout>
  );
}