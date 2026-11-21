'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bookmark, ChevronLeft, ChevronRight, Globe2, Heart, Images, MessageCircle, MoreHorizontal, Repeat2, Send, Share2, ThumbsUp } from 'lucide-react';
import { buildSocialGraphicHtml } from '@/lib/social/socialGraphic';
import { SOCIAL_FORMAT_INFO, type SocialCrop, type SocialFormat, type SocialGraphicStyle } from '@/lib/social/socialShared';
import {
  socialCanvasSeams, socialCanvasSize, socialCanvasTiles, socialLayoutFrame, type SocialCanvas, type SocialLayoutDefinition,
} from '@/lib/social/socialLayout';
import type { SocialSpec } from './socialApi';

/*
 * Podglądy posta w CRM: grafika (wyrenderowany plik albo podgląd na żywo z tym samym HTML co render na serwerze),
 * feed Instagrama (karuzela ze strzałkami i kropkami), siatka profilu z poprzednimi postami, relacja ze strefami
 * bezpiecznymi, post na Facebooku (kilka zdjęć — układ jak na Facebooku) i post strony firmowej LinkedIn.
 */

export type GraphicSource = {
  format: SocialFormat;
  renderedUrl: string | null;
  /** Podgląd na żywo; bez zdjęcia (`photoUrl: null`) — tło w kolorze przyciemnienia (np. miniatura stylu przed wyborem zdjęcia). */
  live: {
    spec: SocialSpec; photoUrl: string | null; crop: SocialCrop | null; headline: string; subline: string; style: SocialGraphicStyle; kicker: string;
    /** Układ jako dane (zamiast stylu) i zdjęcia kolażu (indeks = miejsce 1–3) z kadrami w proporcjach miejsc. */
    layout?: SocialLayoutDefinition | null;
    photos?: Array<{ src: string; crop: SocialCrop } | null>;
  } | null;
  /** Wycinek dużej grafiki w px (kafelek siatki, slajd panoramy) — podgląd na żywo tylko tej części. */
  viewport?: { x: number; y: number; width: number; height: number } | null;
};

/** Grafika w szerokości `width` px: plik z serwera albo ramka z podglądem na żywo (ten sam HTML co render, po `delay` ms bez zmian). */
export function GraphicView({ source, width, className = '', delay = 120 }: { source: GraphicSource | null; width: number; className?: string; delay?: number }) {
  const [html, setHtml] = useState('');
  const live = source && !source.renderedUrl ? source.live : null;
  // Wymiary strony: format posta albo duża grafika (siatka, panorama); widok — cała strona albo wycinek (kafelek).
  const info = live && source ? socialLayoutFrame(live.layout || null, source.format) : SOCIAL_FORMAT_INFO[source?.format || '4:5'];
  const view = live && source?.viewport ? source.viewport : { x: 0, y: 0, width: info.width, height: info.height };
  const height = Math.round((width * view.height) / view.width);
  const liveKey = live ? JSON.stringify([source?.format, live.photoUrl, live.crop, live.headline, live.subline, live.style, live.kicker, live.spec.templateId, live.spec.colors,
    live.layout || null, live.photos || null]) : '';

  useEffect(() => {
    if (!live || !source) { setHtml(''); return; }
    const timer = window.setTimeout(() => {
      setHtml(buildSocialGraphicHtml({
        format: source.format,
        photo: live.photoUrl && live.crop ? { src: live.photoUrl, crop: live.crop } : null,
        logo: live.spec.logo ? { src: live.spec.logo.src } : null,
        titleFont: live.spec.titleFont,
        captionFont: live.spec.captionFont,
        colors: live.spec.colors,
        settings: live.spec.settings,
        headline: live.headline,
        subline: live.subline,
        style: live.style,
        kicker: live.kicker,
        layout: live.layout || null,
        photos: live.photos || [],
      }));
    }, delay);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);

  if (!source || (!source.renderedUrl && !live)) {
    return <div className={`flex items-center justify-center bg-[#0f1119] text-[#d3bb73]/40 ${className}`} style={{ width, height }}><Images className="h-6 w-6" /></div>;
  }
  if (source.renderedUrl) return <img src={source.renderedUrl} alt="" className={`block object-cover ${className}`} style={{ width, height }} />;
  return (
    <div className={`relative overflow-hidden bg-[#0f1119] ${className}`} style={{ width, height }}>
      {html && (
        <iframe title="Podgląd grafiki" sandbox="allow-scripts" srcDoc={html} scrolling="no"
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
          style={{ width: info.width, height: info.height, transform: `scale(${width / view.width}) translate(${-view.x}px, ${-view.y}px)` }} />
      )}
    </div>
  );
}

/** Karuzela w podglądzie: bieżące zdjęcie, strzałki, licznik i kropki (jak w aplikacji Instagram). */
export function CarouselView({ sources, width, light = false }: { sources: Array<GraphicSource | null>; width: number; light?: boolean }) {
  const [index, setIndex] = useState(0);
  const count = sources.length;
  const current = Math.min(index, Math.max(0, count - 1));
  useEffect(() => { if (index > count - 1) setIndex(Math.max(0, count - 1)); }, [count, index]);
  if (count <= 1) return <GraphicView source={sources[0] || null} width={width} />;
  const arrow = 'absolute top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-black shadow';
  return (
    <div className="relative" style={{ width }}>
      <GraphicView source={sources[current]} width={width} />
      <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] text-white">{current + 1}/{count}</span>
      {current > 0 && <button type="button" aria-label="Poprzednie zdjęcie" className={`${arrow} left-2`} onClick={() => setIndex(current - 1)}><ChevronLeft className="h-4 w-4" /></button>}
      {current < count - 1 && <button type="button" aria-label="Następne zdjęcie" className={`${arrow} right-2`} onClick={() => setIndex(current + 1)}><ChevronRight className="h-4 w-4" /></button>}
      <div className="flex justify-center gap-1 py-1.5">
        {sources.map((_, dot) => (
          <span key={dot} className={`h-1.5 w-1.5 rounded-full ${dot === current ? 'bg-sky-500' : light ? 'bg-black/20' : 'bg-white/30'}`} />
        ))}
      </div>
    </div>
  );
}

function Avatar({ logoUrl }: { logoUrl: string | null }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#1c1f33] ring-2 ring-pink-500/60">
      {logoUrl ? <img src={logoUrl} alt="" className="h-6 w-6 object-contain" /> : null}
    </span>
  );
}

export function InstagramFeedPreview({ source, slides = [], account, logoUrl, caption }: {
  source: GraphicSource | null; slides?: Array<GraphicSource | null>; account: string; logoUrl: string | null; caption: string;
}) {
  const width = 340;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mx-auto overflow-hidden rounded-xl border border-white/10 bg-black text-white" style={{ width }}>
      <div className="flex items-center gap-2 px-3 py-2"><Avatar logoUrl={logoUrl} /><span className="flex-1 text-sm font-semibold">{account}</span><MoreHorizontal className="h-4 w-4" /></div>
      {slides.length ? <CarouselView sources={[source, ...slides]} width={width} /> : <GraphicView source={source} width={width} />}
      <div className="flex items-center gap-4 px-3 py-2"><Heart className="h-5 w-5" /><MessageCircle className="h-5 w-5" /><Send className="h-5 w-5" /><span className="flex-1" /><Bookmark className="h-5 w-5" /></div>
      <div className="px-3 pb-3 text-[13px] leading-snug">
        <span className="font-semibold">{account}</span>{' '}
        <span className="whitespace-pre-wrap">{expanded || caption.length <= 125 ? caption : `${caption.slice(0, 125)}…`}</span>
        {!expanded && caption.length > 125 && <button type="button" className="ml-1 text-white/50" onClick={() => setExpanded(true)}>więcej</button>}
      </div>
    </div>
  );
}

export function ProfileGridPreview({ current, grid }: { current: GraphicSource | null; grid: Array<{ id: string; imageUrl: string | null; source?: 'crm' | 'instagram' }> }) {
  const cell = 110;
  const cellHeight = Math.round((cell * 4) / 3);
  // Siatka profilu Instagrama: komórka 3:4, grafika wypełnia wysokość i jest przycinana po bokach.
  const currentWidth = Math.round(cellHeight * (current ? SOCIAL_FORMAT_INFO[current.format].width / SOCIAL_FORMAT_INFO[current.format].height : 0.8));
  return (
    <div className="mx-auto rounded-xl border border-white/10 bg-black p-1" style={{ width: cell * 3 + 8 }}>
      <div className="grid grid-cols-3 gap-0.5">
        <div className="relative overflow-hidden" style={{ width: cell, height: cellHeight }}>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"><GraphicView source={current} width={currentWidth} /></div>
          <span className="absolute left-1 top-1 rounded bg-[#d3bb73] px-1 text-[9px] font-semibold text-[#1c1f33]">TEN POST</span>
        </div>
        {grid.slice(0, 8).map((item) => (
          <div key={item.id} className="overflow-hidden bg-[#1c1f33]" style={{ width: cell, height: cellHeight }}>
            {item.imageUrl && <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />}
          </div>
        ))}
      </div>
      <p className="px-1 pt-1 text-[10px] text-white/40">Siatka profilu przycina posty do 3:4 — środek grafiki pozostaje widoczny.{grid.some((item) => item.source === 'instagram') ? ' Dalej: zaplanowane posty i ostatnie posty z profilu Instagram.' : ''}</p>
    </div>
  );
}

/**
 * Cała duża grafika (siatka profilu, panorama) z liniami cięcia: styki kafelków, pasy obcinane w siatce profilu (3:4),
 * numery kafelków i — w siatce — kolejność publikacji (od ostatniego kafelka).
 */
export function CanvasPreview({ source, canvas, width, warnings = [] }: { source: GraphicSource | null; canvas: SocialCanvas; width: number; warnings?: string[] }) {
  const size = socialCanvasSize(canvas);
  const height = Math.round((width * size.height) / size.width);
  const seams = socialCanvasSeams(canvas);
  const tiles = socialCanvasTiles(canvas);
  const pct = (value: number, total: number) => `${(value / total) * 100}%`;
  return (
    <div className="space-y-1.5">
      <div className="relative overflow-hidden rounded-lg bg-[#0f1119]" style={{ width, height }}>
        <GraphicView source={source} width={width} />
        {seams.hidden.map((strip) => (
          <span key={strip.x} className="pointer-events-none absolute top-0 h-full bg-black/45" style={{ left: pct(strip.x, size.width), width: pct(strip.w, size.width) }} />
        ))}
        {seams.x.map((x) => <span key={`x${x}`} className="pointer-events-none absolute top-0 h-full border-l border-dashed border-white/70" style={{ left: pct(x, size.width) }} />)}
        {seams.y.map((y) => <span key={`y${y}`} className="pointer-events-none absolute left-0 w-full border-t border-dashed border-white/70" style={{ top: pct(y, size.height) }} />)}
        {tiles.map((tile) => (
          <span key={tile.position} className="pointer-events-none absolute rounded bg-black/60 px-1 text-[10px] text-white"
            style={{ left: `calc(${pct(tile.visible.x, size.width)} + 4px)`, top: `calc(${pct(tile.visible.y, size.height)} + 4px)` }}>
            {tile.position}{canvas.mode === 'grid' ? ` · publikacja ${tiles.length - tile.position + 1}.` : ''}
          </span>
        ))}
      </div>
      <p className="text-[11px] text-[#e5e4e2]/45">
        {canvas.mode === 'grid'
          ? 'Linie — styki kafelków w siatce profilu; przyciemnione pasy siatka obcina (kafelki zachodzą na siebie, więc w profilu łączą się bez przesunięć). Logo i teksty trzymaj w obrębie jednego kafelka.'
          : 'Linie — granice slajdów karuzeli (na Instagramie przesuwane bez przerw; na Facebooku i LinkedIn — post z kilkoma zdjęciami).'}
      </p>
      {warnings.length > 0 && <p className="text-[11px] text-amber-200">{warnings.join(' ')}</p>}
    </div>
  );
}

/** Siatka profilu z kafelkami tej siatki na początku (najnowsze) i dalej postami z CRM / z profilu Instagram. */
export function CanvasGridPreview({ tiles, grid }: { tiles: GraphicSource[]; grid: Array<{ id: string; imageUrl: string | null; source?: 'crm' | 'instagram' }> }) {
  const cell = 110;
  const cellHeight = Math.round((cell * 4) / 3);
  const tileWidth = Math.round(cellHeight * 0.8);
  return (
    <div className="mx-auto rounded-xl border border-white/10 bg-black p-1" style={{ width: cell * 3 + 8 }}>
      <div className="grid grid-cols-3 gap-0.5">
        {tiles.map((tile, index) => (
          <div key={`tile-${index}`} className="relative overflow-hidden" style={{ width: cell, height: cellHeight }}>
            <div className="absolute left-1/2 top-0 -translate-x-1/2"><GraphicView source={tile} width={tileWidth} /></div>
            {index === 0 && <span className="absolute left-1 top-1 rounded bg-[#d3bb73] px-1 text-[9px] font-semibold text-[#1c1f33]">TA SIATKA</span>}
          </div>
        ))}
        {grid.slice(0, Math.max(0, 12 - tiles.length)).map((item) => (
          <div key={item.id} className="overflow-hidden bg-[#1c1f33]" style={{ width: cell, height: cellHeight }}>
            {item.imageUrl && <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />}
          </div>
        ))}
      </div>
      <p className="px-1 pt-1 text-[10px] text-white/40">Siatka profilu przycina kafelki do 3:4 — tu widać, jak złożą się na profilu. Przypięte posty przesuwają siatkę; kolejne posty publikuj po 3, żeby została równa.</p>
    </div>
  );
}

export function StoryPreview({ source, account, logoUrl }: { source: GraphicSource | null; account: string; logoUrl: string | null }) {
  const width = 260;
  const height = Math.round((width * 16) / 9);
  return (
    <div className="relative mx-auto overflow-hidden rounded-[22px] border border-white/10 bg-black" style={{ width, height }}>
      <GraphicView source={source} width={width} />
      <div className="absolute left-0 top-0 w-full p-2">
        <div className="mb-2 h-0.5 w-full rounded bg-white/40"><div className="h-full w-1/3 rounded bg-white" /></div>
        <div className="flex items-center gap-2 text-xs text-white"><Avatar logoUrl={logoUrl} /><span className="font-semibold">{account}</span><span className="text-white/60">2 godz.</span></div>
      </div>
      <div className="absolute bottom-0 left-0 flex w-full items-center gap-2 p-2">
        <span className="flex-1 rounded-full border border-white/50 px-3 py-1.5 text-[11px] text-white/80">Wyślij wiadomość</span>
        <Heart className="h-5 w-5 text-white" /><Send className="h-5 w-5 text-white" />
      </div>
    </div>
  );
}

/** Facebook z kilkoma zdjęciami: pierwsze duże, pod nim do trzech mniejszych (na ostatnim „+N”). */
function FacebookPhotos({ sources, width }: { sources: Array<GraphicSource | null>; width: number }) {
  const rest = sources.slice(1, 4);
  const hidden = sources.length - 1 - rest.length;
  const small = Math.floor((width - (rest.length - 1) * 2) / rest.length);
  return (
    <div style={{ width }}>
      <GraphicView source={sources[0]} width={width} />
      <div className="mt-0.5 flex gap-0.5">
        {rest.map((item, index) => (
          <div key={index} className="relative overflow-hidden" style={{ width: small, height: small }}>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"><GraphicView source={item} width={small} /></div>
            {index === rest.length - 1 && hidden > 0 && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-semibold text-white">+{hidden}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FacebookPreview({ source, slides = [], account, logoUrl, caption }: {
  source: GraphicSource | null; slides?: Array<GraphicSource | null>; account: string; logoUrl: string | null; caption: string;
}) {
  const width = 360;
  return (
    <div className="mx-auto overflow-hidden rounded-xl border border-black/10 bg-white text-[#050505]" style={{ width }}>
      <div className="flex items-center gap-2 p-3">
        <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[#1c1f33]">{logoUrl && <img src={logoUrl} alt="" className="h-7 w-7 object-contain" />}</span>
        <span className="flex-1"><span className="block text-sm font-semibold">{account}</span><span className="flex items-center gap-1 text-[11px] text-[#65676b]">Teraz · <Globe2 className="h-3 w-3" /></span></span>
        <MoreHorizontal className="h-5 w-5 text-[#65676b]" />
      </div>
      <p className="whitespace-pre-wrap px-3 pb-2 text-[13px] leading-snug">{caption.length > 240 ? `${caption.slice(0, 240)}… Zobacz więcej` : caption}</p>
      {slides.length ? <FacebookPhotos sources={[source, ...slides]} width={width} /> : <GraphicView source={source} width={width} />}
      <div className="flex items-center justify-around border-t border-black/10 py-2 text-[13px] text-[#65676b]">
        <span className="flex items-center gap-1"><ThumbsUp className="h-4 w-4" />Lubię to!</span>
        <span className="flex items-center gap-1"><MessageCircle className="h-4 w-4" />Komentarz</span>
        <span className="flex items-center gap-1"><Share2 className="h-4 w-4" />Udostępnij</span>
      </div>
    </div>
  );
}

/** Post strony firmowej LinkedIn: nazwa strony, opis (po ~210 znakach „…więcej”), grafika albo kilka zdjęć, pasek akcji. */
export function LinkedInPreview({ source, slides = [], account, logoUrl, caption }: {
  source: GraphicSource | null; slides?: Array<GraphicSource | null>; account: string; logoUrl: string | null; caption: string;
}) {
  const width = 360;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mx-auto overflow-hidden rounded-xl border border-black/10 bg-white text-[#191919]" style={{ width }}>
      <div className="flex items-start gap-2 p-3">
        <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded bg-[#1c1f33]">{logoUrl && <img src={logoUrl} alt="" className="h-9 w-9 object-contain" />}</span>
        <span className="flex-1"><span className="block text-sm font-semibold leading-tight">{account}</span><span className="block text-[11px] text-[#666666]">Obserwujący</span><span className="flex items-center gap-1 text-[11px] text-[#666666]">Teraz · <Globe2 className="h-3 w-3" /></span></span>
        <MoreHorizontal className="h-5 w-5 text-[#666666]" />
      </div>
      <p className="whitespace-pre-wrap px-3 pb-2 text-[13px] leading-snug">
        {expanded || caption.length <= 210 ? caption : `${caption.slice(0, 210)}…`}
        {!expanded && caption.length > 210 && <button type="button" className="ml-1 text-[#666666]" onClick={() => setExpanded(true)}>więcej</button>}
      </p>
      {slides.length ? <FacebookPhotos sources={[source, ...slides]} width={width} /> : <GraphicView source={source} width={width} />}
      <div className="flex items-center justify-around border-t border-black/10 py-2 text-[12px] font-semibold text-[#666666]">
        <span className="flex items-center gap-1"><ThumbsUp className="h-4 w-4" />Lubię to</span>
        <span className="flex items-center gap-1"><MessageCircle className="h-4 w-4" />Skomentuj</span>
        <span className="flex items-center gap-1"><Repeat2 className="h-4 w-4" />Udostępnij</span>
        <span className="flex items-center gap-1"><Send className="h-4 w-4" />Wyślij</span>
      </div>
    </div>
  );
}

/** Nazwa konta w podglądach: z adresu Instagrama marki albo nazwa marki. */
export function useAccountName(companyName: string) {
  return useMemo(() => companyName.toLowerCase().replace(/[^a-z0-9._]+/g, '') || 'marka', [companyName]);
}
