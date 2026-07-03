export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { buildMetadataForSlug } from '@/lib/seo-helpers';
import OfferLayout from '../OfferLayout';
import TechnikaScenicznaPage from './TechnikaScenicznaPage';
import { cookies } from 'next/headers';

const pageSlug = 'oferta/technika-sceniczna';

export async function generateMetadata() {
  return buildMetadataForSlug(pageSlug, cookies());
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