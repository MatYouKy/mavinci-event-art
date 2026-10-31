import Link from 'next/link';
import { OLSZTYN_CONFERENCE_PATH } from '@/lib/SEO/conferenceOverview';

export default function ConferenceOverviewIntro({ showOlsztyn }: { showOlsztyn: boolean }) {
  return (
    <section className="mx-auto max-w-7xl px-5 py-10 sm:px-6 md:py-14" aria-labelledby="conference-overview-heading">
      <p className="text-sm text-[#d3bb73]">Konferencje · Kongresy · Spotkania hybrydowe</p>
      <h2 id="conference-overview-heading" className="mt-3 max-w-4xl text-2xl font-light uppercase text-[#e5e4e2] sm:text-3xl">Technika dopasowana do programu konferencji</h2>
      <p className="mt-5 max-w-3xl leading-7 text-white/75">Zapewniamy nagłośnienie Meyer Sound, ekrany LED, oświetlenie, multimedia i streaming wraz z realizatorami. Przygotowujemy technikę wystąpień, paneli dyskusyjnych oraz gal towarzyszących konferencji. Zakres, transport i harmonogram ustalamy dla wybranego obiektu w Polsce.</p>
      <p className="mt-4 max-w-3xl leading-7 text-white/75">Możesz zamówić całą obsługę albo uzupełnienie wyposażenia sali. Współpracujemy bezpośrednio z organizatorami, agencjami eventowymi i hotelami.</p>
      {showOlsztyn && <div className="mt-6 rounded-xl bg-white/[0.04] px-5 py-4 text-sm leading-6">
        <p className="text-white/65">Planujesz wydarzenie w Olsztynie lub okolicach? Zobacz lokalną ofertę i realizację w Hotelu Przystań.</p>
        <Link href={OLSZTYN_CONFERENCE_PATH} className="mt-2 inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Obsługa techniczna konferencji w Olsztynie</Link>
      </div>}
    </section>
  );
}
