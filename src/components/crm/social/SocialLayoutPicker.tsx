'use client';

import { LayoutTemplate, Paintbrush } from 'lucide-react';
import { SOCIAL_FORMAT_INFO, type SocialFormat } from '@/lib/social/socialShared';
import { socialLayoutRect, type SocialLayoutColor, type SocialLayoutDefinition } from '@/lib/social/socialLayout';
import type { SocialLayoutOption } from './socialApi';

/*
 * Wybór układu grafiki w kreatorze posta: „Styl grafiki” (bez układu — styl z listy stylów) albo układ jako dane
 * (układy marki i gotowe kolaże). Miniatura to schemat z tej samej definicji co render: miejsca na zdjęcia z numerami,
 * przyciemnienia, prostokąty, logo i linie tekstów — w proporcjach aktywnego formatu i w kolorach szablonu marki.
 */

export type SocialLayoutChoice = { id: string | null; key: string | null } | null;

export const sameLayoutChoice = (a: SocialLayoutChoice, b: SocialLayoutChoice) =>
  (a?.id || null) === (b?.id || null) && (a?.key || null) === (b?.key || null) && Boolean(a) === Boolean(b);

const fallbackColors: Record<SocialLayoutColor, string> = { overlay: '#1c1f33', accent: '#d3bb73', text: '#ffffff' };

/** Schemat układu (SVG) w proporcjach formatu. */
export function LayoutThumb({ definition, format, width, colors }: {
  definition: SocialLayoutDefinition; format: SocialFormat; width: number; colors?: Partial<Record<SocialLayoutColor, string | null>> | null;
}) {
  const info = SOCIAL_FORMAT_INFO[format];
  const height = Math.round((width * info.height) / info.width);
  const color = (role: SocialLayoutColor) => colors?.[role] || fallbackColors[role];
  const photos = definition.elements.filter((item) => item.type === 'photo');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block rounded" aria-hidden="true">
      <rect x={0} y={0} width={width} height={height} fill={color(definition.background)} />
      {photos.map((element) => {
        const rect = socialLayoutRect(element, format);
        const x = rect.x * width; const y = rect.y * height; const w = rect.w * width; const h = rect.h * height;
        return (
          <g key={element.id}>
            <rect x={x} y={y} width={w} height={h} fill="#6b7280" opacity={0.85} />
            {element.type === 'photo' && <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fontSize={Math.max(8, Math.min(w, h) * 0.28)} fill="#ffffff" opacity={0.8}>{element.slot + 1}</text>}
          </g>
        );
      })}
      {definition.elements.map((element) => {
        if (element.type === 'photo') return null;
        const rect = socialLayoutRect(element, format);
        const x = rect.x * width; const y = rect.y * height; const w = rect.w * width; const h = rect.h * height;
        if (element.type === 'shade') {
          const id = `g-${element.id}-${format}`.replace(/[^A-Za-z0-9_-]/g, '');
          const vertical = element.direction === 'up' || element.direction === 'down';
          const reverse = element.direction === 'up' || element.direction === 'left';
          return (
            <g key={element.id}>
              <defs>
                <linearGradient id={id} x1="0" y1="0" x2={vertical ? '0' : '1'} y2={vertical ? '1' : '0'}>
                  <stop offset="0" stopColor={color(element.color)} stopOpacity={reverse ? element.to : element.from} />
                  <stop offset="1" stopColor={color(element.color)} stopOpacity={reverse ? element.from : element.to} />
                </linearGradient>
              </defs>
              <rect x={x} y={y} width={w} height={h} fill={`url(#${id})`} />
            </g>
          );
        }
        if (element.type === 'box') {
          return <rect key={element.id} x={x} y={y} width={w} height={Math.max(h, 0.6)} rx={element.radius * (width / 1080)}
            fill={element.fill ? color(element.fill.color) : 'none'} fillOpacity={element.fill?.opacity ?? 0}
            stroke={element.stroke ? color(element.stroke.color) : 'none'} strokeOpacity={element.stroke?.opacity ?? 0} strokeWidth={element.stroke ? Math.max(0.6, element.stroke.width * (width / 1080)) : 0} />;
        }
        if (element.type === 'logo') {
          return <rect key={element.id} x={x + w * 0.2} y={y + h * 0.2} width={w * 0.6} height={h * 0.6} rx={2} fill="none" stroke={color('accent')} strokeDasharray="2 2" strokeWidth={0.8} />;
        }
        const line = Math.max(1, Math.min(h * 0.5, (element.size * width) / 1080));
        const length = w * (element.bind === 'headline' ? 0.8 : element.bind === 'kicker' ? 0.3 : 0.6);
        const left = element.align === 'left' ? x : element.align === 'right' ? x + w - length : x + (w - length) / 2;
        return <rect key={element.id} x={left} y={y + (h - line) / 2} width={length} height={line} rx={line / 2} fill={color(element.color)} opacity={0.9} />;
      })}
    </svg>
  );
}

/** Siatka wyboru: styl grafiki (bez układu) i układy (marki, gotowe). */
export default function SocialLayoutPicker({ options, value, format, colors, disabled, onChange }: {
  options: SocialLayoutOption[];
  value: SocialLayoutChoice;
  format: SocialFormat;
  colors?: Partial<Record<SocialLayoutColor, string | null>> | null;
  disabled?: boolean;
  onChange: (choice: SocialLayoutChoice) => void;
}) {
  const brand = options.filter((option) => option.id);
  const presets = options.filter((option) => !option.id);
  const tile = (selected: boolean) => `flex flex-col items-center gap-1 rounded-lg border p-1.5 text-center text-[11px] transition-colors ${selected ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]' : 'border-[#d3bb73]/15 text-[#e5e4e2]/70 hover:border-[#d3bb73]/40'} disabled:opacity-50`;
  const renderOption = (option: SocialLayoutOption) => {
    const choice = { id: option.id, key: option.key };
    const selected = sameLayoutChoice(value, choice);
    return (
      <button key={option.id || option.key} type="button" disabled={disabled} title={option.description || option.name} className={tile(selected)} onClick={() => onChange(choice)}>
        <LayoutThumb definition={option.definition} format={format} width={76} colors={colors} />
        <span className="line-clamp-2 leading-tight">{option.name}{option.archived ? ' (archiwum)' : ''}</span>
        <span className="text-[10px] text-[#e5e4e2]/40">{option.slots === 1 ? '1 zdjęcie' : `${option.slots} zdjęcia`}</span>
      </button>
    );
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
        <button type="button" disabled={disabled} className={tile(!value)} onClick={() => onChange(null)} title="Bez układu — wygląd z wybranego stylu grafiki">
          <span className="flex h-[95px] w-[76px] items-center justify-center rounded bg-[#0f1119]"><Paintbrush className="h-6 w-6 text-[#d3bb73]/60" /></span>
          <span className="leading-tight">Styl grafiki</span>
          <span className="text-[10px] text-[#e5e4e2]/40">1 zdjęcie</span>
        </button>
        {brand.map(renderOption)}
        {presets.map(renderOption)}
      </div>
      {!brand.length && (
        <p className="flex items-center gap-1.5 text-[11px] text-[#e5e4e2]/40"><LayoutTemplate className="h-3.5 w-3.5" />Gotowe układy i kolaże; własne układy marki dodasz w edytorze układów.</p>
      )}
    </div>
  );
}
