'use client';

import { Check, Star } from 'lucide-react';
import {
  SOCIAL_GRAPHIC_STYLES, SOCIAL_GRAPHIC_STYLE_HINTS, SOCIAL_GRAPHIC_STYLE_LIST, type SocialCrop, type SocialFormat,
  type SocialGraphicStyle,
} from '@/lib/social/socialShared';
import type { SocialSpec } from './socialApi';
import { GraphicView } from './SocialPreviews';

/*
 * Wybór stylu grafiki w kreatorze posta: miniatury wszystkich stylów z bieżącym zdjęciem, kadrem i tekstami (ten sam HTML
 * co render na serwerze, więc miniatura wygląda jak grafika po zapisie). Gwiazdka — domyślny styl szablonu marki.
 */

const THUMB_WIDTH = 80;

export default function SocialStylePicker({ spec, format, photoUrl, crop, headline, subline, kicker, value, defaultStyle, disabled, onChange }: {
  spec: SocialSpec | null;
  format: SocialFormat;
  photoUrl: string | null;
  crop: SocialCrop | null;
  headline: string;
  subline: string;
  kicker: string;
  value: SocialGraphicStyle;
  defaultStyle: SocialGraphicStyle | null;
  disabled: boolean;
  onChange: (style: SocialGraphicStyle) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {SOCIAL_GRAPHIC_STYLE_LIST.map((style) => (
          <button key={style} type="button" disabled={disabled} onClick={() => onChange(style)} title={SOCIAL_GRAPHIC_STYLE_HINTS[style]}
            aria-pressed={value === style}
            className={`flex flex-col items-center rounded-lg border p-1 transition-colors disabled:cursor-not-allowed ${value === style
              ? 'border-[#d3bb73] bg-[#d3bb73]/10' : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/40'}`}>
            {spec?.ready ? (
              // Miniatury odświeżają się po chwili bez zmian (pisanie, przesuwanie kadru) — nie przy każdym znaku.
              <GraphicView width={THUMB_WIDTH} className="rounded" delay={600}
                source={{ format, renderedUrl: null, live: { spec, photoUrl, crop, headline, subline, kicker, style } }} />
            ) : null}
            <span className={`mt-1 flex items-center gap-0.5 text-[11px] ${value === style ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/70'}`}>
              {value === style && <Check className="h-3 w-3" />}
              {SOCIAL_GRAPHIC_STYLES[style]}
              {defaultStyle === style && <Star className="h-2.5 w-2.5 text-[#d3bb73]/70" aria-label="domyślny styl marki" />}
            </span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-[#e5e4e2]/45">{SOCIAL_GRAPHIC_STYLE_HINTS[value]} Logo, kolory i fonty zawsze z księgi znaku marki.</p>
    </div>
  );
}
