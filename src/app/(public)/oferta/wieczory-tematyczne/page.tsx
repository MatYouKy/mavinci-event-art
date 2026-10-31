export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { buildMetadataForSlug } from '@/lib/seo-helpers';
import { supabaseServer } from '@/lib/supabaseServer';
import OfferLayout from '../OfferLayout';
import WieczeoryTematycznePage from './WieczeoryTematycznePage';
import { cookies } from 'next/headers';
import ThemedPartyOlsztynLink from '@/components/ThemedPartyOlsztynLink';
import { getPublishedThemedPartyScenarios } from '@/lib/SEO/themedPartyScenarios.server';

const pageSlug = 'oferta/wieczory-tematyczne';
const STORAGE_SECTION = 'themed-party';

export async function generateMetadata() {
  return buildMetadataForSlug(pageSlug, cookies());
}

export default async function Page() {
  const [{ data, error }, scenarios] = await Promise.all([supabaseServer
    .from('site_images')
    .select('*')
    .eq('section', STORAGE_SECTION)
    .eq('is_active', true)
    .order('order_index'), getPublishedThemedPartyScenarios()]);
  if (error) throw new Error('Nie udało się pobrać oferty wieczorów tematycznych.');
  const scenarioPaths = Object.fromEntries(scenarios.flatMap(item => [item.slug, ...item.themeTitles].map(key => [key, item.href])));

  return (
    <OfferLayout
      pageSlug={pageSlug}
      section="wieczory-tematyczne-hero"
    >
      <WieczeoryTematycznePage serverData={data || []} scenarioPaths={scenarioPaths} />
      <ThemedPartyOlsztynLink />
    </OfferLayout>
  );
}
