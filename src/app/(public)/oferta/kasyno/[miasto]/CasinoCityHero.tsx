import 'server-only';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import CasinoCityHeroEditor from './CasinoCityHeroEditor';

export type CasinoHeroSettings = {
  image_url?: string | null;
  alt_text?: string | null;
  opacity?: number | null;
  image_metadata?: { desktop?: { src?: string }; mobile?: { src?: string }; object_position?: string; [key: string]: unknown } | null;
};
type Props = { pageSlug: string; cityName: string; cityForms: string[]; title: string; lead: string; image: string; canEdit: boolean; settings: CasinoHeroSettings; localSettings: CasinoHeroSettings };

export default function CasinoCityHero({ pageSlug, cityName, cityForms, title, lead, image, canEdit, settings, localSettings }: Props) {
  const desktopImage = settings.image_metadata?.desktop?.src || image;
  const mobileImage = settings.image_url ? settings.image_metadata?.mobile?.src : undefined;
  const imageSizes = '(min-width: 1280px) 608px, (min-width: 1024px) calc(50vw - 48px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 40px)';
  const cityPattern = Array.from(new Set([cityName, ...cityForms].map(name => name.trim()).filter(Boolean)))
    .sort((a, b) => b.length - a.length)
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const titleParts = cityPattern ? title.split(new RegExp(`(${cityPattern})`, 'gi')) : [title];

  return <header className="relative isolate overflow-hidden bg-[#190f1b] px-5 pb-14 pt-28 text-[#e5e4e2] sm:px-6 md:pb-20 md:pt-36">
    <picture aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      {mobileImage && <source media="(max-width: 767px)" srcSet={mobileImage} />}
      <img src={desktopImage}  sizes={imageSizes} alt="" width={1920} height={1080} decoding="async" className="h-full w-full object-cover" style={{ opacity: settings.opacity ?? 0.25, objectPosition: settings.image_metadata?.object_position || 'center' }} />
    </picture>
    <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-[#190f1b] via-[#190f1b]/25 to-[#190f1b]/40" />
    <div className="mx-auto max-w-7xl">
      <Link href="/oferta/kasyno" className="inline-flex min-h-11 items-center text-sm text-white/65 hover:text-white">← Kasyno na eventy</Link>
      <div className="mt-5 grid items-center gap-8 sm:gap-10 lg:grid-cols-2 lg:gap-12 xl:gap-16">
        <div className="min-w-0">
          <p className="text-sm text-[#d3bb73]">Wieczory w kasynie · MAVINCI</p>
          <h1 className="mt-4 break-words text-3xl font-light uppercase leading-tight sm:text-4xl xl:text-5xl">{titleParts.map((part, index) => index % 2 === 1 ? <span key={index} className="text-[#d3bb73]">{part}</span> : part)}</h1>
          <p className="mt-6 max-w-3xl text-base leading-7 text-white/80 sm:text-lg sm:leading-8">{lead}</p>
          <Link href="#wycena-kasyna" className="mt-7 inline-flex min-h-12 items-center gap-3 rounded-full bg-[#d3bb73] px-5 py-3 text-sm font-medium text-[#190f1b] hover:bg-[#e3cd8c]">Ustal zakres i wycenę <ArrowUpRight size={18} aria-hidden="true" /></Link>
        </div>
        <figure className="group min-w-0 overflow-hidden rounded-2xl bg-white/[0.04] shadow-[0_20px_60px_rgba(0,0,0,0.25)] sm:rounded-3xl">
          <picture>
            {mobileImage && <source media="(max-width: 767px)" srcSet={mobileImage} />}
            <img
              src={desktopImage}
              
              sizes={imageSizes}
              alt={settings.alt_text || 'Kasyno eventowe MAVINCI ze stołami do gier'}
              width={1280}
              height={800}
              fetchPriority="high"
              loading="eager"
              decoding="async"
              className="aspect-[16/10] w-full object-cover motion-safe:transition-transform motion-safe:duration-700 motion-safe:group-hover:scale-[1.02]"
              style={{ objectPosition: settings.image_metadata?.object_position || 'center' }}
            />
          </picture>
        </figure>
      </div>
      {canEdit && <CasinoCityHeroEditor pageSlug={pageSlug} cityName={cityName} title={title} lead={lead} settings={settings} localSettings={localSettings} />}
    </div>
  </header>;
}
