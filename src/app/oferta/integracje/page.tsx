export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { buildMetadataForSlug } from '@/lib/seo-helpers';
import OfferLayout from '../OfferLayout';
import IntegracjePage from './IntegracjePage';

const pageSlug = 'oferta/integracje';

export async function generateMetadata() {
  return buildMetadataForSlug(pageSlug);
}

export default async function Page() {
  return (
    <OfferLayout
      pageSlug={pageSlug}
      section="integracje"
    >
      <IntegracjePage />
    </OfferLayout>
  );
}