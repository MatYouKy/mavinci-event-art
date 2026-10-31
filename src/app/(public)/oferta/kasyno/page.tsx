export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { buildMetadataForSlug } from '@/lib/seo-helpers';
import OfferLayout from '../OfferLayout';
import KasynoPage from './KasynoPage';
import Link from 'next/link';

const pageSlug = 'oferta/kasyno';

export async function generateMetadata() {
  return buildMetadataForSlug(pageSlug);
}

export default async function Page() {
  return (
    <OfferLayout
      pageSlug={pageSlug}
      section="kasyno-hero"
    >
      <KasynoPage />
      <section className="mx-auto max-w-7xl px-6 py-12 text-[#e5e4e2]">
        <h2 className="text-2xl uppercase">Kasyno na wydarzenia w Twoim mieście</h2>
        <p className="mt-4 max-w-3xl leading-7 text-white/70">Obsługujemy imprezy firmowe, integracje i gale w Olsztynie oraz innych miastach Polski. Sprawdź lokalną ofertę i ustal z nami zakres swojego wydarzenia.</p>
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/oferta/kasyno/olsztyn" className="inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Kasyno eventowe w Olsztynie</Link>
          <Link href="/oferta/kasyno/lokalizacje" className="inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Zobacz wszystkie miasta</Link>
        </div>
      </section>
    </OfferLayout>
  );
}
