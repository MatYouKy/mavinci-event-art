export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { buildMetadataForSlug } from '@/lib/seo-helpers';
import OfferLayout from '../OfferLayout';
import TechnikaScenicznaPage from './TechnikaScenicznaPage';

const pageSlug = 'oferta/technika-sceniczna';

export async function generateMetadata() {
  return buildMetadataForSlug(pageSlug);
}

export default async function Page() {
  return (
    <OfferLayout
      pageSlug={pageSlug}
      section="technika-sceniczna-hero"
    >
      <TechnikaScenicznaPage />
    </OfferLayout>
  );
} 