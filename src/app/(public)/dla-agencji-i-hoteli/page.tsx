import type { Metadata } from 'next';
import Link from 'next/link';
import PageLayout from '@/components/Layout/PageLayout';
import { SITE, ORGANIZATION_ID } from '@/lib/SEO/site';

const title = 'Partner techniczny dla agencji i hoteli | MAVINCI Olsztyn';
const description = 'Technika eventowa dla agencji i hoteli: Meyer Sound, LED i streaming. Wypróbuj demo, przygotuj ofertę PDF pod własną marką i poznaj współpracę z MAVINCI.';
const url = `${SITE.url}/dla-agencji-i-hoteli`;
// Public demo without a recipient-specific attribution token.
const sellerDemoHref = '/demo-sprzedawcy/796b93c3-ab4d-437f-8720-beb0970298c0';
const demoContactHref = `mailto:${SITE.email}?subject=${encodeURIComponent('Demo strefy sprzedawcy — współpraca')}&body=${encodeURIComponent('Dzień dobry,\n\nInteresuje mnie współpraca i dostęp do strefy sprzedawcy MAVINCI.\nHotel lub agencja:\nZakres planowanej współpracy:\n')}`;
const demoSteps = [
  { title: 'Dodaj swoją markę', description: 'Wybierz logo, zdjęcie okładki i kolory swojego hotelu lub agencji.' },
  { title: 'Uzupełnij przykład', description: 'Nadaj ofercie tytuł i wpisz przykładowe ceny usług. Możesz też skorzystać z ustawień domyślnych.' },
  { title: 'Pobierz ofertę PDF', description: 'Zobacz gotowy dokument ze stronami usług, kalkulacją i Twoją identyfikacją wizualną.' },
];
export const metadata: Metadata = {
  title: { absolute: title }, description, alternates: { canonical: url },
  openGraph: { title, description, url, siteName: SITE.name, locale: 'pl_PL', type: 'website',
    images: [{ url: `${SITE.url}/logo-mavinci-crm.png`, alt: SITE.name }] },
  twitter: { card: 'summary_large_image', title, description, images: [`${SITE.url}/logo-mavinci-crm.png`] },
};

export default function AgencyPartnersPage() {
  return <PageLayout pageSlug="dla-agencji-i-hoteli" customSchema={{ '@context': 'https://schema.org',
    '@type': 'Service', '@id': `${url}#service`, name: 'Partner techniczny dla agencji eventowych i hoteli',
    description, url, provider: { '@id': ORGANIZATION_ID },
    areaServed: [{ '@type': 'AdministrativeArea', name: 'województwo warmińsko-mazurskie' }, { '@type': 'Country', name: 'Polska' }] }}>
    <main className="min-h-screen bg-[#160c19] px-6 pb-24 pt-36 text-[#e5e4e2]">
      <div className="mx-auto max-w-5xl">
        <p className="mb-5 text-sm uppercase tracking-widest text-[#d3bb73]">MAVINCI Event & ART · Olsztyn</p>
        <h1 className="max-w-4xl text-4xl font-light uppercase md:text-5xl">Partner techniczny dla agencji eventowych i hoteli</h1>
        <p className="mt-8 max-w-3xl text-xl leading-relaxed text-white/75">Masz scenariusz konferencji, gali lub wydarzenia firmowego? MAVINCI zapewnia zaplecze techniczne i realizacyjne: własny system Meyer Sound LINA, ekrany LED, oświetlenie, multimedia i streaming. Pracujemy z bazy w Olsztynie, na Warmii i Mazurach oraz w innych regionach Polski.</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link href={sellerDemoHref} prefetch={false} className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#d3bb73] px-7 py-4 text-center font-medium text-[#160c19] transition-colors hover:bg-[#e3cd8c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d3bb73]/50">Przygotuj ofertę demo</Link>
          <Link href="/#kontakt" className="inline-flex min-h-12 items-center justify-center rounded-full bg-white/[0.06] px-7 py-4 text-center transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d3bb73]/50">Omów zakres współpracy</Link>
        </div>
        <section id="demo-dla-sprzedawcow" aria-labelledby="seller-demo-heading" className="mt-14 scroll-mt-28 overflow-hidden rounded-3xl bg-gradient-to-br from-[#d3bb73]/10 via-white/[0.04] to-white/[0.02] p-5 sm:mt-16 sm:p-8 lg:p-10">
          <p className="text-xs uppercase tracking-widest text-[#d3bb73]">Demo strefy sprzedawcy · Dla hoteli i agencji</p>
          <h2 id="seller-demo-heading" className="mt-4 max-w-3xl text-2xl font-light uppercase leading-snug sm:text-3xl">Twoja marka. Twoja przykładowa oferta.</h2>
          <p className="mt-5 max-w-3xl leading-7 text-white/75">Zobacz, jak usługi MAVINCI mogą stać się częścią Twojej oferty dla klienta. Wejdź do demo, dopasuj wygląd dokumentu do swojej marki i samodzielnie wygeneruj przykładową ofertę PDF.</p>
          <p className="mt-3 text-sm leading-6 text-[#d3bb73]">Bez logowania · Opcjonalne dane · Bez zobowiązań</p>
          <ol className="mt-7 grid gap-3 md:grid-cols-3 md:gap-4">
            {demoSteps.map((step, index) => <li key={step.title} className="min-w-0 rounded-2xl bg-black/15 p-5">
              <span aria-hidden="true" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#d3bb73]/10 text-sm text-[#d3bb73]">{index + 1}</span>
              <h3 className="mt-4 text-base font-medium uppercase leading-relaxed">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-white/65">{step.description}</p>
            </li>)}
          </ol>
          <div className="mt-7">
            <Link href={sellerDemoHref} prefetch={false} className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[#d3bb73] px-6 py-4 text-center font-medium text-[#160c19] transition-colors hover:bg-[#e3cd8c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d3bb73]/50 sm:w-auto">Otwórz demo i wygeneruj ofertę</Link>
            <p className="mt-3 max-w-2xl text-xs leading-6 text-white/55">PDF jest dokumentem demonstracyjnym. Wpisane kwoty służą do próbnej kalkulacji; warunki realizacji ustalamy wspólnie.</p>
          </div>
          <div className="mt-8 rounded-2xl bg-white/[0.04] p-5 sm:p-6">
            <h3 className="text-lg font-medium uppercase leading-relaxed">Podoba Ci się? Porozmawiajmy.</h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-white/75">Napisz do nas, jeśli chcesz w ten sposób przygotowywać oferty dla swoich klientów. Omówimy dostęp do strefy sprzedawcy, katalog usług i warunki współpracy z MAVINCI.</p>
            <a href={demoContactHref} className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-[#d3bb73] underline underline-offset-4 hover:text-[#e3cd8c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d3bb73]/50">Napisz o współpracy</a>
            <p className="mt-1 break-words text-sm text-white/55">{SITE.email}</p>
          </div>
        </section>
        <section className="mt-16"><h2 className="text-3xl font-light uppercase">Dobierz zakres do swojego projektu</h2>
          <ul className="mt-6 list-disc space-y-3 pl-5 text-lg leading-relaxed text-white/75">
            <li><Link href="/uslugi/systemy-line-array-meyer-sound-lina" className="underline">Nagłośnienie Meyer Sound</Link> — dobór systemu i realizacja dźwięku.</li>
            <li><Link href="/uslugi/ekrany-led-do-konferencji-i-gall" className="underline">Ekrany LED</Link>, prezentacje, multimedia i realizacja wizji.</li>
            <li><Link href="/oferta/streaming" className="underline">Streaming konferencji</Link> i realizacja wielokamerowa.</li>
            <li><Link href="/oferta/technika-sceniczna" className="underline">Technika sceniczna</Link>, oświetlenie i obsługa programu.</li>
            <li>Program wieczorny: <Link href="/oferta/dj-eventowy" className="underline">DJ</Link>, <Link href="/oferta/quizy-teleturnieje" className="underline">quizy i teleturnieje</Link>, <Link href="/oferta/kasyno" className="underline">kasyno eventowe</Link> i <Link href="/oferta/wieczory-tematyczne" className="underline">wieczory tematyczne</Link>.</li>
          </ul>
        </section>
        <section className="mt-16"><h2 className="text-3xl font-light uppercase">Współpraca od briefu do realizacji</h2>
          <p className="mt-6 leading-relaxed text-white/75">Ustalamy zakres odpowiedzialności, harmonogram montażu i prób, wymagania obiektu oraz sposób komunikacji z zespołem organizatora. Na tej podstawie dobieramy urządzenia i obsługę. Możemy uzupełnić zaplecze wydarzenia albo zająć się całym zakresem technicznym.</p>
          <p className="mt-4 leading-relaxed text-white/75">Biuro i magazyn: ul. Towarowa 20B, 10-417 Olsztyn. Przy zapytaniu podaj datę, miejsce, liczbę uczestników, program i potrzebne usługi. Warunki współpracy ustalamy dla konkretnego projektu.</p>
        </section>
        <section className="mt-16"><h2 className="text-3xl font-light uppercase">Zobacz zakres naszych realizacji</h2>
          <p className="mt-6 leading-relaxed text-white/75">W opisie <Link href="/portfolio/konferencja-psrwn" className="underline">konferencji PSRWN w Hotelu Przystań w Olsztynie</Link> przedstawiamy obsługę techniczną, streaming i oprawę bankietu. <Link href="/portfolio/latino-night-castorama" className="underline">Latino Night Castorama</Link> pokazuje część rozrywkową i tematyczną naszej oferty.</p>
        </section>
      </div>
    </main>
  </PageLayout>;
}
