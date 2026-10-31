import 'server-only';
import Link from 'next/link';
import { ArrowUpRight, Check } from 'lucide-react';
import type { CasinoOfferProduct } from '@/lib/SEO/casinoReferences.server';

export default function CasinoCityProduct({ product }: { product: CasinoOfferProduct }) {
  return <section id="zestawy-kasyna" className="scroll-mt-24 bg-[#291320] px-5 py-14 text-[#e5e4e2] sm:px-6 md:py-20">
    <div className="mx-auto max-w-7xl">
      <div className="max-w-3xl">
        <p className="text-sm text-[#d3bb73]">Dobierz zakres do swojego wydarzenia</p>
        <h2 className="mt-3 text-3xl font-light uppercase sm:text-4xl">{product.name} — stoły i zestawy</h2>
        <p className="mt-5 text-lg leading-8 text-white/75">{product.lead}</p>
      </div>
      {product.packages.length > 0 && <div className="mt-8 grid gap-5 md:grid-cols-3">
        {product.packages.map((item, index) => <article key={item.id} className="flex min-w-0 flex-col rounded-2xl bg-white/[0.04] p-6 sm:p-7">
          <p aria-hidden="true" className="text-sm text-[#d3bb73]/70">0{index + 1}</p>
          <h3 className="mt-4 text-xl uppercase text-[#d3bb73]">{item.name}</h3>
          <p className="mt-4 leading-7 text-white/75">{item.description}</p>
          {item.scope && <p className="mt-5 flex gap-3 leading-7"><Check aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-[#d3bb73]" />{item.scope}</p>}
          {item.bonus && <p className="mt-4 rounded-lg bg-[#d3bb73]/10 p-3 text-sm leading-6 text-[#d3bb73]">{item.bonus}</p>}
          <Link href={item.href} className="mt-auto inline-flex min-h-12 items-center gap-2 pt-6 text-sm text-[#d3bb73] underline underline-offset-4">Zobacz szczegóły zestawów <ArrowUpRight size={18} aria-hidden="true" /></Link>
        </article>)}
      </div>}
      <p className="mt-6 max-w-4xl text-sm leading-7 text-white/65">Zestaw określa dobór stołów. Obsługę krupierską, czas pracy, transport i dodatkową oprawę potwierdzamy w indywidualnej ofercie dla Twojego wydarzenia.</p>
      {product.requirements.length > 0 && <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <h3 className="text-2xl uppercase">Sala, montaż i zasady wyceny</h3>
          <p className="mt-4 leading-7 text-white/70">Przekaż te informacje osobie odpowiedzialnej za salę. Pozwolą ustalić miejsce stołów i przygotować strefę przed wejściem gości.</p>
          <Link href={product.href} className="mt-5 inline-flex min-h-12 items-center gap-2 text-[#d3bb73] underline underline-offset-4">Pełny opis strefy i warunki oferty <ArrowUpRight size={18} aria-hidden="true" /></Link>
        </div>
        <div className="space-y-3">
          {product.requirements.map((item, index) => <details key={index} className="group rounded-xl bg-black/15">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 p-5 text-sm uppercase">
              <span>{item.title || 'Warunek realizacji'}</span><span aria-hidden="true" className="text-xl text-[#d3bb73] motion-safe:transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="px-5 pb-5 text-sm leading-7 text-white/75">{item.text}</p>
          </details>)}
        </div>
      </div>}
    </div>
  </section>;
}
