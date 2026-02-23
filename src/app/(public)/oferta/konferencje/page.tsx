export const dynamic = 'force-dynamic';
export const revalidate = 0;

import OfferLayout from '../OfferLayout';
import { buildMetadataForSlug } from '@/lib/seo-helpers';
import ConferencesPageClient from './ConferencesPage';

import { createSupabaseServerClient } from '@/lib/server';
import { getConferencesData } from '@/lib/conferences-data';
import CityMapEmbed from '@/components/CityMapEmbed/CityMapEmbed';
import { cookies } from 'next/headers';

const pageSlug = 'oferta/konferencje';

export async function generateMetadata() {
  return buildMetadataForSlug(pageSlug, cookies());
}

export default async function Page() {
  const supabase = createSupabaseServerClient();
  const { hero, services, caseStudies, advantages, process, pricing, faq, gallery, portfolio, cities, serviceCategories, relatedServices, allServiceItems } = await getConferencesData(supabase);
  const heroData = hero ?? null;

  return (
    <OfferLayout pageSlug={pageSlug} section="konferencje-hero">
      <ConferencesPageClient
        initialHeroData={heroData}
        initialServices={services ?? []}
        initialCaseStudies={caseStudies ?? []}
        initialAdvantages={advantages ?? []}
        initialProcess={process ?? []}
        initialPricing={pricing ?? []}
        initialFaq={faq ?? []}
        initialGallery={gallery ?? []}
        initialPortfolioProjects={portfolio ?? []}
        initialCities={cities ?? []}
        initialServiceCategories={serviceCategories ?? []}
        initialRelatedServices={relatedServices}
        initialAllServiceItems={allServiceItems ?? []}
        initialSelectedServiceIds={[...relatedServices]}
      />
       <CityMapEmbed query={`Olsztyn, Polska`} />
    </OfferLayout>
  );
}   