"use client";
import { ArrowUpRight, Check, CheckCircle2, ChevronDown } from 'lucide-react';
import type { PublicShowcaseBlock, PublicShowcaseCard, PublicShowcasePhoto } from '@/lib/showcase/showcaseProductPage.server';
import ProductPhoto from './ProductPhoto';

/*
 * Materiał z Prezentacji na stronie produktu (`showcaseProductPage.server.ts`): każda karta prezentacji powiązana z produktem —
 * hasło, wstęp, zdjęcie główne i bloki (zdjęcia, korzyści, kroki, „co obejmuje”, specyfikacja, pytania, tekst, realizacje,
 * powiązane produkty). Treść prezentacji jest po polsku — w wersji angielskiej strony pokazujemy same zdjęcia.
 */

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

/** „wrzesień 2025” z daty `RRRR-MM-DD` (bez strefy czasowej — ten sam wynik na serwerze i w przeglądarce). */
function monthYear(value: string | null): string {
  const match = /^(\d{4})-(\d{2})/.exec(value || '');
  if (!match) return '';
  const month = Number(match[2]) - 1;
  return month >= 0 && month < 12 ? `${MONTHS[month]} ${match[1]}` : match[1];
}

const paragraphs = (value: string) => value.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);

function Caption({ photo }: { photo: PublicShowcasePhoto }) {
  return photo.caption ? <figcaption className="mt-2 text-sm leading-6 text-[#e5e4e2]/60">{photo.caption}</figcaption> : null;
}

function Photos({ block }: { block: PublicShowcaseBlock }) {
  if (block.style === 'grid') {
    return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {block.photos.map((photo) => <figure key={photo.key}>
        <ProductPhoto language="pl" src={photo.thumb} full={photo.url} alt={photo.caption || block.title} className="aspect-square rounded-xl" />
        {photo.caption && <figcaption className="mt-2 line-clamp-2 text-xs leading-5 text-[#e5e4e2]/55">{photo.caption}</figcaption>}
      </figure>)}
    </div>;
  }
  return <div className={`grid gap-5 ${block.photos.length > 1 ? 'md:grid-cols-2' : ''}`}>
    {block.photos.map((photo) => <figure key={photo.key}>
      <ProductPhoto language="pl" src={photo.url} alt={photo.caption || block.title} className="aspect-[3/2] rounded-xl" />
      <Caption photo={photo} />
    </figure>)}
  </div>;
}

function Points({ block }: { block: PublicShowcaseBlock }) {
  if (block.style === 'steps') {
    return <ol className="space-y-4">{block.rows.map((row, index) => <li key={index} className="flex gap-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d3bb73] text-sm font-semibold text-[#250914]">{index + 1}</span>
      <div className="pt-1">{row.title && <p className="font-medium">{row.title}</p>}{row.text && <p className="mt-1 whitespace-pre-line text-sm leading-6 text-[#e5e4e2]/70">{row.text}</p>}</div>
    </li>)}</ol>;
  }
  if (block.style === 'checklist') {
    return <ul className={`grid gap-3 ${block.rows.length > 3 ? 'md:grid-cols-2' : ''}`}>{block.rows.map((row, index) => <li key={index} className="flex gap-3">
      <Check className="mt-1 h-5 w-5 shrink-0 text-[#d3bb73]" aria-hidden="true" />
      <div>{row.title && <p className="font-medium">{row.title}</p>}{row.text && <p className="whitespace-pre-line text-sm leading-6 text-[#e5e4e2]/70">{row.text}</p>}</div>
    </li>)}</ul>;
  }
  return <ul className={`grid gap-4 ${block.rows.length > 1 ? 'md:grid-cols-2' : ''}`}>{block.rows.map((row, index) => <li key={index} className="flex gap-3 rounded-xl bg-black/15 p-5">
    <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-[#d3bb73]" aria-hidden="true" />
    <div>{row.title && <p className="font-medium">{row.title}</p>}{row.text && <p className="mt-1 whitespace-pre-line text-sm leading-6 text-[#e5e4e2]/70">{row.text}</p>}</div>
  </li>)}</ul>;
}

function Specs({ block }: { block: PublicShowcaseBlock }) {
  return <dl className="divide-y divide-white/10 overflow-hidden rounded-xl bg-black/15">{block.rows.map((row, index) => <div key={index} className="grid gap-1 px-5 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-6">
    <dt className="text-sm text-[#e5e4e2]/60">{row.title}</dt>
    <dd className="whitespace-pre-line text-sm leading-6">{row.text}</dd>
  </div>)}</dl>;
}

function Faq({ block }: { block: PublicShowcaseBlock }) {
  return <div className="space-y-3">{block.rows.map((row, index) => <details key={index} className="group rounded-xl bg-black/15 px-5 py-4">
    <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
      <span>{row.title}</span><ChevronDown className="mt-1 h-4 w-4 shrink-0 text-[#d3bb73] transition-transform group-open:rotate-180" aria-hidden="true" />
    </summary>
    {row.text && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-[#e5e4e2]/70">{row.text}</p>}
  </details>)}</div>;
}

function Realizations({ block }: { block: PublicShowcaseBlock }) {
  return <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{block.realizations.map((realization) => {
    const meta = [realization.location, monthYear(realization.date)].filter(Boolean).join(' · ');
    const body = <>
      {realization.photo && <div className="aspect-[4/3] overflow-hidden bg-black/10"><img src={realization.photo.thumb} alt={realization.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" /></div>}
      <div className="p-5">
        <h4 className="uppercase text-[#d3bb73]">{realization.title}</h4>
        {meta && <p className="mt-2 text-sm text-[#e5e4e2]/60">{meta}</p>}
        {realization.href && <p className="mt-3 flex items-center gap-1 text-sm font-medium text-[#d3bb73]">Zobacz realizację<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></p>}
      </div>
    </>;
    return realization.href
      ? <a key={realization.id} href={realization.href} target="_blank" rel="noopener noreferrer" className="group overflow-hidden rounded-xl bg-black/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d3bb73]">{body}</a>
      : <article key={realization.id} className="group overflow-hidden rounded-xl bg-black/15">{body}</article>;
  })}</div>;
}

function RelatedProduct({ block }: { block: PublicShowcaseBlock }) {
  const product = block.product;
  if (!product) return null;
  return <a href={product.href} target="_blank" rel="noopener noreferrer"
    className={`group grid overflow-hidden rounded-xl bg-black/15 transition-colors hover:bg-black/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d3bb73] ${product.image ? 'sm:grid-cols-[200px_minmax(0,1fr)]' : ''}`}>
    {product.image && <div className="aspect-[4/3] overflow-hidden bg-black/10 sm:aspect-auto"><img src={product.image} alt={product.name} loading="lazy" className="h-full w-full object-cover" /></div>}
    <div className="flex flex-col justify-center gap-2 p-5">
      <p className="text-xs uppercase tracking-[0.16em] text-[#e5e4e2]/50">Zobacz też</p>
      <p className="flex items-center gap-2 uppercase text-[#d3bb73]">{product.name}<ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" /></p>
      {product.description && <p className="line-clamp-3 text-sm leading-6 text-[#e5e4e2]/70">{product.description}</p>}
    </div>
  </a>;
}

function Block({ block }: { block: PublicShowcaseBlock }) {
  const intro = block.kind !== 'text' && block.text ? <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#e5e4e2]/65">{block.text}</p> : null;
  return <div>
    {block.kind !== 'product' && <h3 className="text-lg uppercase text-[#d3bb73]">{block.title}</h3>}
    {intro}
    <div className={block.kind === 'product' ? '' : 'mt-5'}>
      {block.kind === 'photos' && <Photos block={block} />}
      {block.kind === 'points' && <Points block={block} />}
      {block.kind === 'specs' && <Specs block={block} />}
      {block.kind === 'faq' && <Faq block={block} />}
      {block.kind === 'text' && <div className="space-y-4">{paragraphs(block.text).map((part, index) => <p key={index} className="whitespace-pre-line leading-7 text-[#e5e4e2]/75">{part}</p>)}</div>}
      {block.kind === 'realizations' && <Realizations block={block} />}
      {block.kind === 'product' && <RelatedProduct block={block} />}
    </div>
  </div>;
}

export default function ProductShowcase({ cards, language, productName }: { cards: PublicShowcaseCard[]; language: 'pl' | 'en'; productName: string }) {
  if (!cards.length) return null;
  if (language === 'en') {
    // Treść prezentacji jest po polsku — po angielsku same zdjęcia (bez polskich podpisów).
    const photos = cards.flatMap((card) => [card.hero, ...card.blocks.flatMap((block) => (block.kind === 'photos' ? block.photos : []))])
      .filter((photo): photo is PublicShowcasePhoto => Boolean(photo));
    if (!photos.length) return null;
    return <section id="w-praktyce" className="scroll-mt-28 rounded-2xl bg-[#401525] p-7 md:p-9">
      <h2 className="text-lg uppercase text-[#d3bb73]">See it in action</h2>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
        {photos.map((photo, index) => <ProductPhoto key={photo.key} language="en" src={photo.thumb} full={photo.url}
          alt={`${productName} — photo ${index + 1}`} className="aspect-[4/3] rounded-xl" />)}
      </div>
    </section>;
  }
  return <>{cards.map((card, index) => <section key={card.id} id={index === 0 ? 'w-praktyce' : `w-praktyce-${index + 1}`}
    className="scroll-mt-28 rounded-2xl bg-[#401525] p-7 md:p-9">
    <p className="text-xs uppercase tracking-[0.18em] text-[#d3bb73]">Zobacz w praktyce</p>
    <h2 className="mt-3 text-2xl font-light uppercase leading-tight">{card.title}</h2>
    {card.tagline && <p className="mt-2 text-base leading-7 text-[#e5e4e2]/80">{card.tagline}</p>}
    {card.lead && <p className="mt-4 max-w-3xl whitespace-pre-line leading-7 text-[#e5e4e2]/75">{card.lead}</p>}
    {card.hero && <figure className="mt-6">
      <ProductPhoto language="pl" src={card.hero.url} alt={card.hero.caption || card.title} className="aspect-[16/9] max-h-[560px] rounded-xl" />
      {card.hero.caption && card.hero.caption !== card.title && <Caption photo={card.hero} />}
    </figure>}
    {card.blocks.length > 0 && <div className="mt-10 space-y-10">{card.blocks.map((block) => <Block key={block.id} block={block} />)}</div>}
  </section>)}</>;
}
