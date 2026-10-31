import Link from 'next/link';
import { ArrowUpRight, MapPin } from 'lucide-react';
import type { ConferenceCityContent } from '@/lib/SEO/conferenceCityContent';
import { SITE } from '@/lib/SEO/site';

type Props = {
  citySlug: string;
  cityName: string;
  region?: string | null;
  content: ConferenceCityContent;
  nearbyCities: { locality: string; name: string }[];
};

/** Service coverage is distinct from the only physical MAVINCI office. */
export default function ConferenceServiceArea({ citySlug, cityName, region, content, nearbyCities }: Props) {
  const isOfficeCity = citySlug === 'olsztyn';
  const query = isOfficeCity
    ? `${SITE.office.latitude},${SITE.office.longitude}`
    : [cityName, region, 'Polska'].filter(Boolean).join(', ');
  const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=${isOfficeCity ? 10 : 11}&output=embed`;
  const mapUrl = isOfficeCity ? SITE.office.mapsUrl : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  const area = content.serviceArea;

  return <section id="obszar-obslugi" aria-labelledby="conference-area-heading" className="scroll-mt-28 px-5 py-12 text-[#e5e4e2] sm:px-6 md:py-16">
    <div className="mx-auto max-w-7xl overflow-hidden rounded-3xl bg-white/[0.04]">
      <div className="grid lg:grid-cols-2">
        <div className="min-w-0 p-5 sm:p-8 lg:p-10">
          <p className="mb-3 flex items-center gap-2 text-sm text-[#d3bb73]"><MapPin size={18} aria-hidden="true" /> Dojazd i obszar obsługi</p>
          <h2 id="conference-area-heading" className="text-2xl font-light uppercase leading-snug sm:text-3xl">{area?.heading || <>Konferencje — <span className="text-[#d3bb73]">{cityName}</span> i okolice</>}</h2>
          <p className="mt-5 text-sm leading-7 text-white/75 sm:text-base">{area?.description || `Miasto wydarzenia: ${cityName}. Do wybranego obiektu przyjeżdżamy z nagłośnieniem, multimediami i zespołem z naszej bazy w Olsztynie. Przekaż dokładny adres sali, plan programu i godziny dostępne na montaż. Transport oraz zakres obsługi potwierdzamy w ofercie.`}</p>
          {!!area?.locations.length && <ul aria-label="Przykładowe miejscowości w obszarze obsługi" className="mt-5 flex flex-wrap gap-2">
            {area.locations.map(name => <li key={name} className="rounded-full bg-[#491529]/30 px-3 py-2 text-sm text-white/80">{name}</li>)}
          </ul>}
          <a href={mapUrl} className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm text-[#d3bb73] underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d3bb73]/50">
            {isOfficeCity ? 'Dokładna lokalizacja biura i magazynu' : `Otwórz mapę okolicy: ${cityName}`}<ArrowUpRight size={16} aria-hidden="true" />
          </a>
          {!isOfficeCity && <p className="mt-3 text-xs leading-6 text-white/60">Baza MAVINCI: {SITE.office.street}, {SITE.office.city}. <a href={SITE.office.mapsUrl} className="text-[#d3bb73] underline underline-offset-4">Zobacz lokalizację naszego biura</a>.</p>}
        </div>
        <figure className="min-w-0 bg-black/20">
          <iframe title={isOfficeCity ? 'Mapa Olsztyna i okolic z lokalizacją biura MAVINCI' : `Mapa obszaru obsługi konferencji: ${cityName} i okolice`}
            src={mapSrc} width="640" height="380" loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen
            className="block h-[280px] w-full border-0 sm:h-[360px] lg:h-[380px]" />
          <figcaption className="px-5 py-4 text-xs leading-6 text-white/60">
            {isOfficeCity ? 'Znacznik wskazuje konkretny budynek MAVINCI przy Towarowej 20B. Obsługujemy również wydarzenia poza widocznym fragmentem mapy.' : `Mapa przedstawia okolice miasta ${cityName}, a nie lokalny oddział MAVINCI. Obszar widoczny na mapie nie wyznacza granicy dojazdu.`}
          </figcaption>
        </figure>
      </div>
      {nearbyCities.length > 0 && <nav aria-label="Obsługa konferencji w pobliskich miastach" className="px-5 pb-6 sm:px-8 lg:px-10">
        <p className="mb-3 text-sm text-white/60">Zobacz również obsługę konferencji w regionie:</p>
        <ul className="flex flex-wrap gap-2">{nearbyCities.map(city => <li key={city.locality}>
          <Link href={`/oferta/konferencje/${city.locality}`} prefetch={false} className="inline-flex min-h-11 items-center rounded-full bg-white/[0.05] px-4 py-2 text-sm hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3bb73]/50">{city.name}</Link>
        </li>)}</ul>
      </nav>}
    </div>
  </section>;
}
