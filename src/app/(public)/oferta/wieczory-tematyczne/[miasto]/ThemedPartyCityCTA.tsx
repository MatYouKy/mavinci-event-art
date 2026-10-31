import Link from 'next/link';
import type { PolishCityCases } from '@/lib/polishCityCases';
import { SITE } from '@/lib/SEO/site';
import ConferenceContactLink from '@/components/ConferenceContactLink';
import ThemedPartyBriefForm from '@/components/ThemedPartyBriefForm';

export default function ThemedPartyCityCTA({ cityCases, citySlug }: { cityCases: PolishCityCases; citySlug?: string; content?: unknown }) {
  return <section id="wycena-wieczoru" className="scroll-mt-24 px-5 py-14 sm:px-6 md:py-20">
    <div className="mx-auto max-w-7xl rounded-3xl bg-[#341624] p-6 sm:p-10">
      <h2 className="max-w-3xl text-2xl font-light uppercase sm:text-3xl">Zaplanujmy imprezę tematyczną {cityCases.locative_preposition || 'w'} <span className="text-[#d3bb73]">{cityCases.locative}</span></h2>
      <p className="mt-5 max-w-3xl leading-7 text-white/75">Podaj termin, miejsce, liczbę gości i cel spotkania. Dodaj wybrany motyw lub opisz klimat, który chcesz uzyskać. Na tej podstawie dobierzemy program i przygotujemy zakres wyceny.</p>
      <ThemedPartyBriefForm sourcePath={`/oferta/wieczory-tematyczne/${citySlug || cityCases.city_key}`} cityName={cityCases.nominative} />
      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link href="/#kontakt" className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#d3bb73] px-6 text-sm font-medium text-[#190f1b] hover:bg-[#e3cd8c]">Wyślij zapytanie o wieczór</Link>
        <ConferenceContactLink href={SITE.phoneHref} method="phone" className="inline-flex min-h-12 items-center justify-center rounded-full bg-white/10 px-6 text-[#d3bb73] hover:bg-white/15">{SITE.telephone}</ConferenceContactLink>
        <ConferenceContactLink href={`mailto:${SITE.email}`} method="email" className="inline-flex min-h-12 items-center justify-center break-all px-3 text-white/80 hover:text-white">{SITE.email}</ConferenceContactLink>
      </div>
    </div>
  </section>;
}
