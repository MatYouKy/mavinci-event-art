export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { buildMetadataForSlug } from '@/lib/seo-helpers';
import OfferLayout from '../OfferLayout';
import TechnikaScenicznaPage from './TechnikaScenicznaPage';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getPublishedTechnicalStageCities } from '@/lib/SEO/technicalStageData.server';

const pageSlug = 'oferta/technika-sceniczna';

export async function generateMetadata() {
  return buildMetadataForSlug(pageSlug, cookies());
}

export default async function Page() {
  const cities = await getPublishedTechnicalStageCities();
  const featuredCities = cities.filter(city => ['olsztyn', 'gdansk', 'bialystok', 'torun', 'ostroda', 'elblag', 'warszawa', 'gdynia'].includes(city.locality));
  return (
    <OfferLayout
      pageSlug={pageSlug}
      section="technika-sceniczna-hero"
    >
      <TechnikaScenicznaPage />
      <section className="bg-[#190f1b] px-5 py-14 text-[#e5e4e2] sm:px-6">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-2xl font-light uppercase sm:text-3xl">Technika sceniczna i eventowa w Twoim mieście</h2>
          <p className="mt-5 max-w-3xl leading-7 text-white/70">Nagłośnienie, oświetlenie, ekrany LED wewnętrzne i zewnętrzne, totemy oraz telewizory. Sprawdź zakres obsługi imprez w wybranej lokalizacji.</p>
          <nav aria-label="Lokalizacje techniki scenicznej i eventowej" className="mt-6 flex flex-wrap gap-x-7 gap-y-2">
            {featuredCities.map(city => <Link key={city.locality} href={`/oferta/technika-sceniczna/${city.locality}`} className="inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">{city.name}</Link>)}
            <Link href="/oferta/technika-sceniczna/lokalizacje" className="inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Wszystkie miasta</Link>
          </nav>
        </div>
      </section>
    </OfferLayout>
  );
} 