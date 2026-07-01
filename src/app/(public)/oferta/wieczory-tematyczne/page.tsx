export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { buildMetadataForSlug } from '@/lib/seo-helpers';
import { supabaseServer } from '@/lib/supabaseServer';
import OfferLayout from '../OfferLayout';
import WieczeoryTematycznePage from './WieczeoryTematycznePage';
import { cookies } from 'next/headers';

const pageSlug = 'oferta/wieczory-tematyczne';
const STORAGE_SECTION = 'themed-party';

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
      section="wieczory-tematyczne-hero"
    >
      <WieczeoryTematycznePage serverData={data || []} />
    </OfferLayout>
  );
}
