import Link from 'next/link';
import { ArrowUpRight, MonitorPlay, Radio, Volume2 } from 'lucide-react';

import type { ConferenceCityContent } from '@/lib/SEO/conferenceCityContent';
import { SITE } from '@/lib/SEO/site';

const technicalLinks = [
  { title: 'Meyer Sound LINA', text: 'Własny system nagłośnienia i realizacja dźwięku dopasowana do sali oraz programu.', href: '/uslugi/systemy-line-array-meyer-sound-lina', icon: Volume2 },
  { title: 'Ekrany LED', text: 'Prezentacje, materiały wideo i obraz z kamer. Dobór wielkości ekranu do publiczności.', href: '/uslugi/ekrany-led-do-konferencji-i-gall', icon: MonitorPlay },
  { title: 'Streaming', text: 'Transmisja konferencji, połączenia zdalne i nagranie. Jeden plan obrazu i dźwięku.', href: '/oferta/streaming', icon: Radio },
];

type Props = { citySlug: string; cityName: string; content: ConferenceCityContent | null };

export default function RegionalConferenceIntro({ citySlug, cityName, content }: Props) {
  return <section className="mx-auto max-w-7xl px-5 py-10 text-[#e5e4e2] sm:px-6 md:py-16" aria-labelledby="city-technical-heading">
    <p className="mb-3 text-sm text-[#d3bb73]">Własny sprzęt · Doświadczony zespół</p>
    <h2 id="city-technical-heading" className="max-w-4xl text-2xl font-light uppercase sm:text-3xl">{content?.heading || `${cityName}: technika, która wspiera program`}</h2>
    <p className="mt-5 max-w-3xl leading-7 text-white/75">{content?.intro || 'Konferencja, gala czy wydarzenie hybrydowe — powierz nam całą oprawę techniczną lub wybrane stanowiska. Łączymy nagłośnienie, multimedia i światło z pracą realizatorów.'}</p>

    <div className="mt-7 grid gap-3 md:grid-cols-3 md:gap-5">
      {technicalLinks.map(({ title, text, href, icon: Icon }) => <Link key={href} href={href} prefetch={false} className="group rounded-2xl bg-white/[0.04] p-5 transition-colors hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3bb73]/50 sm:p-6">
        <div className="flex items-center justify-between text-[#d3bb73]"><Icon size={24} strokeWidth={1.5} aria-hidden="true" /><ArrowUpRight size={19} aria-hidden="true" /></div>
        <h3 className="mt-4 text-lg font-medium uppercase">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-white/70">{text}</p>
      </Link>)}
    </div>

    <div className="mt-10 grid gap-8 lg:grid-cols-2 lg:gap-12">
      <div>
        <h3 className="text-xl font-light uppercase">Przygotowanie wydarzenia</h3>
        <p className="mt-4 leading-7 text-white/75">{content?.planning || 'Zakres techniczny dopasowujemy do obiektu, liczby uczestników, programu oraz wymagań transmisji. Przed wyceną ustalamy możliwości montażu i warunki pracy w sali.'}</p>
        {content && <>
          <h4 className="mt-6 text-base font-medium text-[#d3bb73]">Co ustalamy przed wyceną</h4>
          <ul className="mt-3 space-y-3">
            {content.checks.map((item, index) => <li key={index} className="flex items-start gap-3 text-sm leading-6 text-white/75">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/10 text-xs text-[#d3bb73]" aria-hidden="true">{index + 1}</span>
              <span>{item}</span>
            </li>)}
          </ul>
          <details className="group mt-6 rounded-xl bg-white/[0.04] open:bg-white/[0.07]">
            <summary className="cursor-pointer px-5 py-4 text-sm font-medium leading-6 text-[#d3bb73] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3bb73]/50">Przykład planowania: {content.venue.name}</summary>
            <div className="px-5 pb-5">
              <p className="text-sm leading-6 text-white/75">{content.venue.fact}</p>
              <a href={content.venue.url} className="mt-3 inline-flex min-h-11 items-center text-sm text-[#d3bb73] underline underline-offset-4">Informacje o obiekcie — oficjalne źródło</a>
              <p className="mt-2 text-xs leading-5 text-white/55">Opis oparto na publicznej ofercie obiektu. Wyposażenie, zakres najmu i dostępność potwierdza gospodarz. Potwierdzone realizacje MAVINCI znajdziesz w portfolio.</p>
            </div>
          </details>
        </>}
        <p className="mt-5 text-sm leading-6 text-white/60">Biuro i magazyn MAVINCI: {SITE.office.street} w Olsztynie. Do miejsca wydarzenia przyjeżdżamy z techniką i zespołem. Ta strona opisuje obszar obsługi.</p>
        <Link href="#wycena-konferencji" className="mt-5 inline-flex min-h-12 items-center gap-3 rounded-full bg-[#d3bb73] px-5 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#e3cd8c]">Ustal zakres i wycenę <ArrowUpRight size={18} aria-hidden="true" /></Link>
      </div>
      <figure className="self-start overflow-hidden rounded-2xl bg-white/[0.04]">
        <Link href="/portfolio/konferencja-psrwn" prefetch={false}>
          <img src="/images/expertise/technika-768.webp" srcSet="/images/expertise/technika-480.webp 480w, /images/expertise/technika-768.webp 768w, /images/expertise/technika-1280.webp 1280w" sizes="(min-width: 1280px) 580px, (min-width: 1024px) 45vw, (min-width: 768px) 720px, calc(100vw - 40px)" width={1280} height={854} loading="lazy" decoding="async" alt="Realizator MAVINCI przy stanowisku multimediów podczas konferencji PSRWN w Olsztynie" className="aspect-[16/10] w-full object-cover" />
        </Link>
        <figcaption className="p-5">
          <p className="text-xs text-[#d3bb73]">{citySlug === 'olsztyn' ? 'Realizacja w Olsztynie' : 'Przykład naszej pracy · Olsztyn'}</p>
          <Link href="/portfolio/konferencja-psrwn" className="mt-2 inline-flex items-center gap-3 text-base leading-6 hover:text-[#d3bb73]">Konferencja PSRWN · Hotel Przystań <ArrowUpRight className="shrink-0" size={18} aria-hidden="true" /></Link>
          <p className="mt-3 text-sm leading-6 text-white/70">Dwudniowa konferencja: multimedia, nagłośnienie, oświetlenie i streaming. Wieczorem także obsługa nagłośnienia bankietu z zespołem TRIO.</p>
          <Link href="/dla-agencji-i-hoteli" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm text-[#d3bb73] underline underline-offset-4">Technika dla agencji i hoteli <ArrowUpRight size={16} aria-hidden="true" /></Link>
        </figcaption>
      </figure>
    </div>
  </section>;
}
