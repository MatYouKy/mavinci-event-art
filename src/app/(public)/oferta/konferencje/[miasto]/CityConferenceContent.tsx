import Link from 'next/link';
import { SITE } from '@/lib/SEO/site';

type Props = { cityName: string; nearbyCities: { locality: string; name: string }[] };

export default function CityConferenceContent({ cityName, nearbyCities }: Props) {
  const subject = encodeURIComponent(`Obsługa konferencji — ${cityName}`);
  const body = encodeURIComponent(`Dzień dobry,\n\nPlanujemy konferencję.\nMiasto: ${cityName}\nData:\nObiekt i sala:\nLiczba uczestników:\nProgram wydarzenia:\nPotrzebny zakres (nagłośnienie / LED / światło / streaming):\nGodziny dostępu do sali:\n\nProsimy o kontakt w sprawie obsługi technicznej.`);
  return <section id="wycena-konferencji" className="scroll-mt-28 bg-white/[0.03] px-5 py-14 sm:px-6 md:py-20" aria-labelledby="conference-contact-heading">
    <div className="mx-auto max-w-5xl">
      <p className="mb-3 text-sm text-[#d3bb73]">MAVINCI · {cityName}</p>
      <h2 id="conference-contact-heading" className="text-2xl font-light uppercase text-[#e5e4e2] sm:text-4xl">Ustalmy technikę Twojej konferencji</h2>
      <p className="mt-5 max-w-3xl leading-7 text-white/75">Podaj termin, obiekt, liczbę uczestników i program. Uzgodnimy nagłośnienie, obraz, oświetlenie, streaming oraz transport i montaż. Możesz zamówić pełną realizację lub wybrany zakres.</p>
      <div className="mt-7 flex flex-col gap-3 sm:flex-row">
        <a href={`mailto:${SITE.email}?subject=${subject}&body=${body}`} className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#d3bb73] px-6 py-3 text-center font-medium text-[#1c1f33] hover:bg-[#e3cd8c]">Wyślij zapytanie o konferencję</a>
        <a href={SITE.phoneHref} className="inline-flex min-h-12 items-center justify-center rounded-full bg-white/[0.07] px-6 py-3 text-center text-[#e5e4e2] hover:bg-white/10">Zadzwoń: {SITE.telephone}</a>
      </div>
      <p className="mt-6 text-sm leading-6 text-white/60">Biuro i magazyn: {SITE.office.street}, {SITE.office.postalCode} {SITE.office.city}. Do miejsca konferencji przyjeżdżamy z techniką i zespołem. <a href={SITE.office.mapsUrl} className="text-[#d3bb73] underline underline-offset-4">Dojazd do naszego biura</a>.</p>
      <div className="mt-8 flex flex-wrap gap-x-6 gap-y-4 text-sm text-[#d3bb73]">
        <Link href="/dla-agencji-i-hoteli" className="underline underline-offset-4">Współpraca z agencjami i hotelami</Link>
        <Link href="/oferta/integracje" className="underline underline-offset-4">Konferencja z integracją</Link>
        <Link href="/oferta/konferencje" className="underline underline-offset-4">Pełna oferta konferencji</Link>
      </div>
      {nearbyCities.length > 0 && <nav aria-label="Inne lokalizacje konferencji w regionie" className="mt-10">
        <p className="mb-3 text-sm text-white/60">Rozważasz inną lokalizację wydarzenia w regionie?</p>
        <ul className="flex flex-wrap gap-2">
          {nearbyCities.map(city => <li key={city.locality}><Link prefetch={false} href={`/oferta/konferencje/${city.locality}`} className="inline-flex min-h-11 items-center rounded-full bg-white/[0.04] px-4 py-2 text-sm text-[#e5e4e2] hover:bg-white/10">{city.name}</Link></li>)}
        </ul>
      </nav>}
    </div>
  </section>;
}
