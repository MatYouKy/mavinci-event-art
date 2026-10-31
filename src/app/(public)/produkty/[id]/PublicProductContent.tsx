"use client";
import { useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Info } from 'lucide-react';
import ProductPhoto from './ProductPhoto';

export type PublicProductContent = {
  product: { name: string; is_active: boolean; offer_image_alt: string; offer_short_description: string; sales_packages_enabled: boolean };
  imageUrl: string;
  description: string;
  variants: Array<{ id: string; name: string; short_description: string; description: string; benefits: Array<{ title: string; text: string }>; offer_image_path: string; offer_image_alt: string }>;
  packages: Array<{ id: string; name: string; description: string; scope: string; bonus: string; image_path: string; image_alt: string }>;
  relatedServices: Array<{ id: string; title: string; href: string }>;
  benefits: Array<{ title: string; text: string }>;
  requirements: Array<{ title: string; text: string }>;
  extras: Array<{ title: string; text: string }>;
};
const labels = {
  pl: {
    language: 'Język / Language', intro: 'MAVINCI · Poznaj możliwości',
    archived: 'Produkt archiwalny — aktualną dostępność potwierdź z opiekunem oferty.',
    relatedLabel: 'Powiązane usługi', relatedSingle: 'Ten produkt jest częścią naszej usługi', relatedMany: 'Poznaj usługi powiązane z tym produktem',
    relatedDescription: 'Przejdź do pełnego opisu i poznaj możliwości realizacji.',
    scopeNotice: 'Dokładny zakres, ilości i warunki realizacji znajdziesz w otrzymanej ofercie. Opis przedstawia możliwości produktu.',
    description: 'Opis produktu', requirements: 'Wymagania realizacyjne', elements: 'Poznaj elementy produktu', variants: 'Dostępne warianty',
    packages: 'Wybierz zakres dla swojego wydarzenia', packagesDescription: 'Poznaj możliwe zestawy. Wybrany zakres i uzgodnione ceny znajdziesz w swojej ofercie.',
    extras: 'Opcje dodatkowe', extrasDescription: 'Opcje wymagają wskazania w ofercie i uzgodnienia ceny. Nie są automatycznie zawarte w każdym pakiecie.', benefits: 'Co zyskujesz',
  },
  en: {
    language: 'Language / Język', intro: 'MAVINCI · Explore the possibilities',
    archived: 'Archived product — please confirm current availability with your account manager.',
    relatedLabel: 'Related services', relatedSingle: 'This product is part of our service', relatedMany: 'Explore services related to this product',
    relatedDescription: 'Explore the full service descriptions. These linked pages are in Polish.',
    scopeNotice: 'Your quotation confirms the exact scope, quantities and delivery terms. This page describes the available options.',
    description: 'Product description', requirements: 'Delivery requirements', elements: 'Explore the product elements', variants: 'Available options',
    packages: 'Choose the scope for your event', packagesDescription: 'Explore the available packages. Your quotation confirms the selected scope and agreed prices.',
    extras: 'Optional extras', extrasDescription: 'Extras must be specified in your quotation and priced by agreement. They are not automatically included in every package.', benefits: 'Benefits',
  },
};
const plain = (value: unknown) => typeof value === 'string'
  ? value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim() : '';
const entries = (value: unknown): { title: string; text: string }[] => !Array.isArray(value) ? [] : value.flatMap((item) => {
  if (typeof item === 'string') return plain(item) ? [{ title: '', text: plain(item) }] : [];
  if (!item || typeof item !== 'object') return [];
  const title = plain(item.title || item.name);
  const text = plain(item.description || item.text || item.content);
  return title || text ? [{ title, text }] : [];
});


export default function PublicProductContentView({ polish, english, initialLanguage, imageUrls }: {
  polish: PublicProductContent; english: PublicProductContent | null; initialLanguage: 'pl' | 'en'; imageUrls: Record<string,string>;
}) {
  const [selected, setSelected] = useState<'pl' | 'en'>(initialLanguage);
  useEffect(() => { setSelected(initialLanguage); }, [initialLanguage, polish.product.name]);
  useEffect(() => {
    const sync = () => setSelected(new URL(window.location.href).searchParams.get('lang') === 'en' ? 'en' : 'pl');
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const language = selected === 'en' && english ? 'en' : 'pl';
  const text = labels[language];
  const { product, imageUrl, description, variants, packages, relatedServices, benefits, requirements, extras } = language === 'en' && english ? english : polish;
  const switchLanguage = (next: 'pl' | 'en') => {
    if (next === 'en' && !english) return;
    setSelected(next);
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  };
  return <main lang={language} className="min-h-screen bg-[#250914] px-4 pb-16 pt-32 text-[#e5e4e2] md:px-8">
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-sm text-[#e5e4e2]/65">{text.language}</span>
        <div role="group" aria-label="Język / Language" className="inline-flex gap-1 rounded-xl bg-[#401525] p-1">
          {(['pl', 'en'] as const).map(value => <button key={value} type="button" lang={value}
            aria-label={value === 'pl' ? 'Czytaj po polsku' : 'Read in English'} aria-pressed={language === value}
            disabled={value === 'en' && !english} onClick={() => switchLanguage(value)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3bb73] disabled:cursor-not-allowed disabled:opacity-40 ${language === value ? 'bg-[#d3bb73] text-[#250914]' : 'text-[#e5e4e2]/75 hover:bg-white/5'}`}>
            {value.toUpperCase()}
          </button>)}
        </div>
      </div>
      {!english && <p lang="en" role="status" className="text-right text-sm text-[#e5e4e2]/65">The English version is being updated. Please contact us for details in English.</p>}
      <section className={`overflow-hidden rounded-2xl bg-[#401525] shadow-lg ${imageUrl ? 'grid lg:grid-cols-2' : ''}`}>
        {imageUrl && <ProductPhoto language={language} src={imageUrl} alt={product.offer_image_alt || product.name} className="h-full max-h-[560px] min-h-[280px]" />}
        <div className="flex flex-col justify-center p-7 md:p-10">
          <p className="text-xs uppercase tracking-[0.18em] text-[#d3bb73]">{text.intro}</p>
          {product.is_active === false && <p className="mt-4 text-sm text-[#d3bb73]">{text.archived}</p>}
          <h1 className="mt-4 text-3xl font-light uppercase leading-tight">{product.name}</h1>
          <p className="mt-5 whitespace-pre-line text-base leading-7 text-[#e5e4e2]/75">{plain(product.offer_short_description) || description}</p>
          {relatedServices.length>0&&<nav aria-label={text.relatedLabel} className="mt-6 rounded-xl bg-[#d3bb73]/10 p-5">
            <p className="text-sm font-medium text-[#d3bb73]">{relatedServices.length===1 ? text.relatedSingle : text.relatedMany}</p>
            <p className="mt-2 text-sm leading-6 text-[#e5e4e2]/65">{text.relatedDescription}</p>
            <div className="mt-4 flex flex-col gap-2">{relatedServices.map(service=><a key={service.id} href={service.href} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 rounded-lg bg-[#d3bb73] px-4 py-3 text-sm font-semibold text-[#250914] transition-colors hover:bg-[#e1ca87]">{service.title}<ArrowUpRight aria-hidden="true" className="h-5 w-5 shrink-0"/></a>)}</div>
          </nav>}
          <p className="mt-7 rounded-xl bg-black/15 p-4 text-sm leading-6 text-[#e5e4e2]/60">{text.scopeNotice}</p>
        </div>
      </section>
      {description && description !== plain(product.offer_short_description) && <section className="rounded-2xl bg-[#401525] p-7 md:p-9">
        <h2 className="flex items-center gap-2 text-lg uppercase text-[#d3bb73]"><Info size={20} />{text.description}</h2>
        <div className="mt-5 space-y-6">{description.split(/\n\s*\n/).map((section, index) => {
          const [first, ...body] = section.split('\n');
          return <div key={index}>{body.length > 0 && first.length < 100 ? <><h3 className="mb-2 text-base font-medium text-[#e5e4e2]">{first}</h3><p className="whitespace-pre-line leading-7 text-[#e5e4e2]/75">{body.join('\n')}</p></> : <p className="whitespace-pre-line leading-7 text-[#e5e4e2]/75">{section}</p>}</div>;
        })}</div>
      </section>}
      {!!requirements.length && <section className="rounded-2xl bg-[#401525] p-7">
        <h2 className="text-lg uppercase text-[#d3bb73]">{text.requirements}</h2>
        <ul className="mt-5 space-y-4">{requirements.map((item, index) => <li key={index} className="flex gap-3"><CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-[#d3bb73]" /><div>{item.title && <p className="font-medium">{item.title}</p>}<p className="whitespace-pre-line text-sm leading-6 text-[#e5e4e2]/70">{item.text}</p></div></li>)}</ul>
      </section>}
      {!!variants?.length && <section id="elementy" className="scroll-mt-28 rounded-2xl bg-[#401525] p-7">
        <h2 className="text-lg uppercase text-[#d3bb73]">{product.sales_packages_enabled ? text.elements : text.variants}</h2>
        <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{variants.map(variant => {
          const photo = imageUrls[variant.offer_image_path || ''];
          return <article key={variant.id} id={`element-${variant.id}`} className="scroll-mt-28 overflow-hidden rounded-xl bg-black/15">
            {photo && <ProductPhoto language={language} src={photo} alt={variant.offer_image_alt || variant.name} className="aspect-[118/100]"/>}
            <div className="p-5"><h3 className="uppercase text-[#d3bb73]">{variant.name}</h3>
              {plain(variant.short_description)&&<p className="mt-3 text-sm leading-6 text-[#e5e4e2]/85">{plain(variant.short_description)}</p>}
              {plain(variant.description)!==plain(variant.short_description)&&<p className="mt-3 whitespace-pre-line text-sm leading-6 text-[#e5e4e2]/70">{plain(variant.description)}</p>}
              {!!entries(variant.benefits).length&&<ul className="mt-4 space-y-2 text-sm text-[#e5e4e2]/70">{entries(variant.benefits).map((benefit,index)=><li key={index} className="flex gap-2"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#d3bb73]"/><span>{benefit.title} {benefit.text}</span></li>)}</ul>}
            </div>
          </article>;
        })}</div>
      </section>}
      {!!packages.length && <section id="pakiety" className="scroll-mt-28 rounded-2xl bg-[#401525] p-7">
        <h2 className="text-lg uppercase text-[#d3bb73]">{text.packages}</h2>
        <p className="mt-3 text-sm leading-6 text-[#e5e4e2]/60">{text.packagesDescription}</p>
        <div className="mt-5 space-y-5">{packages.map(p=>{
          const photo=imageUrls[p.image_path];
          return <article key={p.id} className={`overflow-hidden rounded-xl bg-black/15 ${photo?'grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]':''}`}>
            {photo&&<ProductPhoto language={language} src={photo} alt={p.image_alt||p.name} className="aspect-[4/3] h-full"/>}
            <div className="flex flex-col justify-center p-6"><h3 className="uppercase text-[#d3bb73]">{p.name}</h3><p className="mt-3 text-sm leading-6 text-[#e5e4e2]/75">{p.description}</p><p className="mt-4 text-sm leading-6 text-[#e5e4e2]">{p.scope}</p>{p.bonus&&<p className="mt-4 rounded-lg bg-[#d3bb73]/10 px-4 py-3 text-sm text-[#d3bb73]">{p.bonus}</p>}</div>
          </article>;
        })}</div>
      </section>}
      {!!extras.length && <section className="rounded-2xl bg-[#401525] p-7 md:p-9"><h2 className="text-lg uppercase text-[#d3bb73]">{text.extras}</h2><p className="mt-3 text-sm text-[#e5e4e2]/60">{text.extrasDescription}</p><div className="mt-5 grid gap-5 md:grid-cols-2">{extras.map((extra, index) => <article key={index} className="rounded-xl bg-black/15 p-5"><h3 className="font-medium text-[#d3bb73]">{extra.title}</h3><p className="mt-2 whitespace-pre-line text-sm leading-6 text-[#e5e4e2]/75">{extra.text}</p></article>)}</div></section>}
      {!!benefits.length && <section id="korzysci" className="scroll-mt-28 rounded-2xl bg-[#401525] p-7 md:p-9">
        <h2 className="text-lg uppercase text-[#d3bb73]">{text.benefits}</h2>
        <ul className={`mt-5 grid gap-6 ${benefits.length > 1 ? 'md:grid-cols-2' : ''}`}>{benefits.map((item, index) => <li key={index} className="flex gap-3"><CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-[#d3bb73]" /><div>{item.title && <p className="font-medium">{item.title}</p>}<p className="whitespace-pre-line text-sm leading-6 text-[#e5e4e2]/70">{item.text}</p></div></li>)}</ul>
      </section>}
    </div>
  </main>;
}
