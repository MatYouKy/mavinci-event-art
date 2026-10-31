import Link from 'next/link';
import { Camera, Truck, Users } from 'lucide-react';
import type { ConferenceCityContent } from '@/lib/SEO/conferenceCityContent';

export default function ConferenceCityDetails({ content, cityName }: { content: ConferenceCityContent; cityName: string }) {
  return <section className="mx-auto max-w-7xl px-5 py-12 text-[#e5e4e2] sm:px-6 md:py-20" aria-labelledby="conference-formats-heading">
    <p className="mb-3 text-sm text-[#d3bb73]">Konferencje · Gale · Spotkania biznesowe</p>
    <h2 id="conference-formats-heading" className="max-w-4xl text-2xl font-light uppercase leading-snug sm:text-3xl">{content.formatsHeading || `${cityName} — oprawa techniczna dopasowana do programu`}</h2>
    <div className="mt-7 grid gap-4 md:grid-cols-3">
      {content.scenarios?.map((scenario, index) => <article key={index} className="rounded-2xl bg-white/[0.04] p-5 sm:p-6">
        <span className="text-sm text-[#d3bb73]" aria-hidden="true">0{index + 1}</span>
        <h3 className="mt-4 text-lg font-medium uppercase leading-7">{scenario.title}</h3>
        <p className="mt-3 text-sm leading-7 text-white/70">{scenario.description}</p>
      </article>)}
    </div>
    <div className="mt-10 grid gap-8 lg:grid-cols-2 lg:gap-12">
      <div className="space-y-8">
        <div><Truck className="mb-3 text-[#d3bb73]" aria-hidden="true" /><h3 className="text-xl font-light uppercase">Dojazd, montaż i obsługa sal</h3><p className="mt-3 leading-7 text-white/70">{content.logistics}</p></div>
        <div><Camera className="mb-3 text-[#d3bb73]" aria-hidden="true" /><h3 className="text-xl font-light uppercase">Streaming i nagranie konferencji</h3><p className="mt-3 leading-7 text-white/70">{content.recording}</p><Link href="/oferta/streaming" className="mt-3 inline-flex min-h-11 items-center text-sm text-[#d3bb73] underline underline-offset-4">Zakres transmisji i realizacji wideo</Link></div>
      </div>
      <div className="self-start rounded-2xl bg-[#491529]/25 p-5 sm:p-7">
        <h3 className="text-xl font-light uppercase">Ile kosztuje obsługa techniczna konferencji?</h3>
        <p className="mt-4 text-sm leading-7 text-white/70">Wycenę przygotowujemy na podstawie zakresu i warunków realizacji. Największy wpływ mają:</p>
        <ul className="mt-4 space-y-3">{content.costFactors?.map((factor, index) => <li key={index} className="flex gap-3 text-sm leading-6 text-white/75"><span className="text-[#d3bb73]" aria-hidden="true">{index + 1}.</span><span>{factor}</span></li>)}</ul>
        <Link href="#wycena-konferencji" className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-[#d3bb73] px-5 py-3 text-sm font-medium text-[#190f1b]">Przygotuj brief do wyceny</Link>
      </div>
    </div>
    <div className="mt-10 rounded-2xl bg-white/[0.03] p-5 sm:p-7"><Users className="mb-3 text-[#d3bb73]" aria-hidden="true" /><h3 className="text-xl font-light uppercase">Technika dla agencji i hoteli</h3><p className="mt-3 max-w-4xl leading-7 text-white/70">{content.partnership}</p><Link href="/dla-agencji-i-hoteli" className="mt-3 inline-flex min-h-11 items-center text-sm text-[#d3bb73] underline underline-offset-4">Poznaj zasady współpracy</Link></div>
    {!!content.benefits?.length && <div className="mt-12">
      <h2 className="max-w-4xl text-2xl font-light uppercase leading-snug sm:text-3xl">{content.benefitsHeading || `Dlaczego MAVINCI — ${cityName}`}</h2>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {content.benefits.map(benefit => <article key={benefit.title} className="rounded-2xl bg-[#491529]/25 p-5 sm:p-6">
          <h3 className="text-lg font-medium uppercase leading-7 text-[#d3bb73]">{benefit.title}</h3>
          <p className="mt-3 text-sm leading-7 text-white/75">{benefit.description}</p>
        </article>)}
      </div>
    </div>}
  </section>;
}
