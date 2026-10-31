import Link from 'next/link';

type Props = { cities: { locality: string; name: string; region?: string | null }[]; portfolio?: boolean };

/** Receives published cities only. These links describe service availability, not past locations. */
export default function ConferenceCityLinks({ cities, portfolio = false }: Props) {
  if (!cities.length) return null;
  return <section id={portfolio ? undefined : 'lokalizacje-konferencji'} className="mx-auto max-w-7xl scroll-mt-28 px-5 py-12 text-[#e5e4e2] sm:px-6">
    <h2 className="text-2xl font-light uppercase sm:text-3xl">{portfolio ? 'Zaplanuj podobną konferencję' : 'Gdzie obsługujemy konferencje'}</h2>
    <p className="mt-4 max-w-3xl leading-7 text-white/65">{portfolio ? 'Tę realizację pokazujemy jako przykład naszego zaplecza i sposobu pracy. Sprawdź zakres obsługi w planowanym miejscu Twojego wydarzenia.' : 'Wybierz miejsce wydarzenia. Na stronach miast znajdziesz zakres techniki, przygotowanie realizacji oraz zapytanie o wycenę. Dojeżdżamy z własnym sprzętem i zespołem.'}</p>
    <nav aria-label={portfolio ? 'Obsługa podobnych konferencji w innych miastach' : 'Lokalne oferty obsługi konferencji'} className="mt-6">
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{cities.map(city => <li key={city.locality}><Link prefetch={false} href={`/oferta/konferencje/${city.locality}`} className="block rounded-xl bg-white/[0.04] px-4 py-4 text-sm leading-6 transition-colors hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d3bb73]/40">Obsługa techniczna konferencji — <span className="text-[#d3bb73]">{city.name}</span></Link></li>)}</ul>
    </nav>
    {portfolio && <Link href="/oferta/konferencje#lokalizacje-konferencji" className="mt-5 inline-flex min-h-11 items-center text-sm text-[#d3bb73] underline underline-offset-4">Zobacz pozostałe lokalizacje</Link>}
  </section>;
}
