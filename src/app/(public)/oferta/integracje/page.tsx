export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { buildMetadataForSlug } from '@/lib/seo-helpers';
import { supabaseServer } from '@/lib/supabaseServer';
import OfferLayout from '../OfferLayout';
import IntegracjePage from './IntegracjePage';
import { cookies } from 'next/headers';

const pageSlug = 'oferta/integracje';
const STORAGE_SECTION = 'integrations';

export async function generateMetadata() {
  return buildMetadataForSlug(pageSlug, cookies());
}

export default async function Page() {
  const { data } = await supabaseServer
    .from('site_images')
    .select('*')
    .eq('section', STORAGE_SECTION)
    .eq('is_active', true)
    .order('order_index');

  return (
    <OfferLayout
      pageSlug={pageSlug}
      section="integracje"
    >
      <IntegracjePage serverData={data || []} />
    </OfferLayout>
  );
}
