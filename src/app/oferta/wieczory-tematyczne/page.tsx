export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { buildMetadataForSlug } from '@/lib/seo-helpers';
import OfferLayout from '../OfferLayout';
import WieczeoryTematycznePage from './WieczeoryTematycznePage';

const pageSlug = 'oferta/wieczory-tematyczne';

export async function generateMetadata() {
  return buildMetadataForSlug(pageSlug);
}

export default async function Page() {
  return (
    <OfferLayout
      pageSlug={pageSlug}
      section="wieczory-tematyczne-hero"
    >
      <WieczeoryTematycznePage />
    </OfferLayout>
  );
}