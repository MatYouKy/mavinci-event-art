'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bookmark, Globe2, Heart, Images, MessageCircle, MoreHorizontal, Send, Share2, ThumbsUp } from 'lucide-react';
import { buildSocialGraphicHtml } from '@/lib/social/socialGraphic';
import { SOCIAL_FORMAT_INFO, type SocialCrop, type SocialFormat } from '@/lib/social/socialShared';
import type { SocialSpec } from './socialApi';

/*
 * Podglądy posta w CRM: grafika (wyrenderowany plik albo podgląd na żywo z tym samym HTML co render na serwerze),
 * feed Instagrama, siatka profilu z poprzednimi postami, relacja ze strefami bezpiecznymi i post na Facebooku.
 */

export type GraphicSource = {
  format: SocialFormat;
  renderedUrl: string | null;
  live: { spec: SocialSpec; photoUrl: string; crop: SocialCrop; headline: string; subline: string } | null;
};

/** Grafika w szerokości `width` px: plik z serwera albo ramka z podglądem na żywo (ten sam HTML co render). */
export function GraphicView({ source, width, className = '' }: { source: GraphicSource | null; width: number; className?: string }) {
  const [html, setHtml] = useState('');
  const live = source && !source.renderedUrl ? source.live : null;
  const info = source ? SOCIAL_FORMAT_INFO[source.format] : SOCIAL_FORMAT_INFO['4:5'];
  const height = Math.round((width * info.height) / info.width);
  const liveKey = live ? JSON.stringify([source?.format, live.photoUrl, live.crop, live.headline, live.subline, live.spec.templateId, live.spec.colors]) : '';

  useEffect(() => {
    if (!live || !source) { setHtml(''); return; }
    const timer = window.setTimeout(() => {
      setHtml(buildSocialGraphicHtml({
        format: source.format,
        photo: { src: live.photoUrl, crop: live.crop },
        logo: live.spec.logo ? { src: live.spec.logo.src } : null,
        titleFont: live.spec.titleFont,
        captionFont: live.spec.captionFont,
        colors: live.spec.colors,
        settings: live.spec.settings,
        headline: live.headline,
        subline: live.subline,
      }));
    }, 120);
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
          style={{ width: info.width, height: info.height, transform: `scale(${width / info.width})` }} />
      )}
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

export function InstagramFeedPreview({ source, account, logoUrl, caption }: { source: GraphicSource | null; account: string; logoUrl: string | null; caption: string }) {
  const width = 340;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mx-auto overflow-hidden rounded-xl border border-white/10 bg-black text-white" style={{ width }}>
      <div className="flex items-center gap-2 px-3 py-2"><Avatar logoUrl={logoUrl} /><span className="flex-1 text-sm font-semibold">{account}</span><MoreHorizontal className="h-4 w-4" /></div>
      <GraphicView source={source} width={width} />
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

export function FacebookPreview({ source, account, logoUrl, caption }: { source: GraphicSource | null; account: string; logoUrl: string | null; caption: string }) {
  const width = 360;
  return (
    <div className="mx-auto overflow-hidden rounded-xl border border-black/10 bg-white text-[#050505]" style={{ width }}>
      <div className="flex items-center gap-2 p-3">
        <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[#1c1f33]">{logoUrl && <img src={logoUrl} alt="" className="h-7 w-7 object-contain" />}</span>
        <span className="flex-1"><span className="block text-sm font-semibold">{account}</span><span className="flex items-center gap-1 text-[11px] text-[#65676b]">Teraz · <Globe2 className="h-3 w-3" /></span></span>
        <MoreHorizontal className="h-5 w-5 text-[#65676b]" />
      </div>
      <p className="whitespace-pre-wrap px-3 pb-2 text-[13px] leading-snug">{caption.length > 240 ? `${caption.slice(0, 240)}… Zobacz więcej` : caption}</p>
      <GraphicView source={source} width={width} />
      <div className="flex items-center justify-around border-t border-black/10 py-2 text-[13px] text-[#65676b]">
        <span className="flex items-center gap-1"><ThumbsUp className="h-4 w-4" />Lubię to!</span>
        <span className="flex items-center gap-1"><MessageCircle className="h-4 w-4" />Komentarz</span>
        <span className="flex items-center gap-1"><Share2 className="h-4 w-4" />Udostępnij</span>
      </div>
    </div>
  );
}

/** Nazwa konta w podglądach: z adresu Instagrama marki albo nazwa marki. */
export function useAccountName(companyName: string) {
  return useMemo(() => companyName.toLowerCase().replace(/[^a-z0-9._]+/g, '') || 'marka', [companyName]);
}
