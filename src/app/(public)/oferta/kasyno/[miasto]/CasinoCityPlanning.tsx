import 'server-only';
import Link from 'next/link';
import { SITE } from '@/lib/SEO/site';
import type { getCasinoLocalCopy } from '@/lib/SEO/casinoCityContent';

type Props = { slug: string; location: string; copy: ReturnType<typeof getCasinoLocalCopy> };
export default function CasinoCityPlanning({ slug, location, copy }: Props) {
  return <section className="bg-[#291320]/60 px-5 py-14 text-[#e5e4e2] sm:px-6 md:py-20">
    <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-2 lg:gap-14">
      <div>
        <h2 className="text-3xl font-light uppercase sm:text-4xl">{copy.heading}</h2>
        <p className="mt-6 leading-8 text-white/75">{copy.text}</p>
        {slug === 'olsztyn' ? <a href={SITE.office.mapsUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center text-sm text-[#d3bb73] underline underline-offset-4">Dokładna lokalizacja biura i magazynu MAVINCI</a>
          : <p className="mt-4 text-sm leading-7 text-white/60">Nasze biuro i magazyn są w Olsztynie. Transport oraz dostęp do sali w miejscu Twojego wydarzenia ustalimy podczas przygotowania oferty.</p>}
      </div>
      <div className="rounded-2xl bg-black/15 p-6 sm:p-8">
        <h3 className="text-xl uppercase text-[#d3bb73]">Ustalmy to przed wydarzeniem</h3>
        <ul className="mt-6 space-y-4">{copy.checklist.map(item => <li key={item} className="flex gap-3 leading-7 text-white/80"><span className="text-[#d3bb73]" aria-hidden="true">•</span>{item}</li>)}</ul>
        <nav aria-label="Rozbuduj wydarzenie" className="mt-8 space-y-3">
          <Link href={`/oferta/konferencje/${slug}`} className="flex min-h-11 items-center text-sm text-[#d3bb73] underline underline-offset-4">Obsługa konferencji {location}</Link>
          <Link href="/oferta/integracje" className="flex min-h-11 items-center text-sm text-[#d3bb73] underline underline-offset-4">Organizacja integracji firmowej</Link>
          <Link href="/oferta/wieczory-tematyczne" className="flex min-h-11 items-center text-sm text-[#d3bb73] underline underline-offset-4">Wieczory tematyczne i oprawa wydarzenia</Link>
        </nav>
      </div>
    </div>
  </section>;
}
