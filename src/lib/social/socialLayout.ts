import { SOCIAL_FORMAT_INFO, SOCIAL_FORMATS, type SocialFormat } from './socialShared';

/*
 * Układy grafik social media jako dane (kreator układów, kolaże). Jedna definicja JSON dla renderu na serwerze Next
 * (`buildSocialGraphicHtml` z `layout`), podglądu na żywo w CRM (ten sam HTML), warstwy podglądu na Macu (warstwa z serwera
 * + zdjęcia w prostokątach miejsc liczonych z tej samej definicji) i edytora płótna.
 *
 * Zasady: kolory, fonty i logo wyłącznie z szablonu marki (= księga znaku) — układ wskazuje tylko role (`overlay` —
 * przyciemnienie, `accent`, `text`; font `title` / `caption`). Położenie: prostokąt 0…1 grafiki (`rect`) z opcjonalnymi
 * nadpisaniami dla formatów (`formats`). Rozmiary w px względem szerokości 1080 (skala = szerokość formatu / 1080).
 * Rysowanie: tło (rola koloru) → zdjęcia miejsc (zawsze pod resztą) → pozostałe elementy w kolejności listy.
 * Miejsce 0 — zdjęcie wariantu posta, miejsca 1–3 — zdjęcia kolażu (`social_post_slots`).
 */

export const SOCIAL_LAYOUT_COLORS = ['overlay', 'accent', 'text'] as const;
export type SocialLayoutColor = (typeof SOCIAL_LAYOUT_COLORS)[number];
export const SOCIAL_LAYOUT_COLOR_LABELS: Record<SocialLayoutColor, string> = {
  overlay: 'Przyciemnienie',
  accent: 'Akcent',
  text: 'Tekst',
};

export type SocialLayoutRect = { x: number; y: number; w: number; h: number };
export type SocialLayoutAlign = 'left' | 'center' | 'right';
export type SocialLayoutVAlign = 'top' | 'middle' | 'bottom';
export type SocialLayoutDirection = 'up' | 'down' | 'left' | 'right';
export type SocialLayoutBind = 'headline' | 'subline' | 'kicker';

type ElementBase = { id: string; rect: SocialLayoutRect; formats?: Partial<Record<SocialFormat, SocialLayoutRect>> };

export type SocialLayoutPhoto = ElementBase & { type: 'photo'; slot: number; radius: number };
export type SocialLayoutShade = ElementBase & { type: 'shade'; color: SocialLayoutColor; direction: SocialLayoutDirection; from: number; to: number };
export type SocialLayoutBox = ElementBase & {
  type: 'box';
  fill: { color: SocialLayoutColor; opacity: number } | null;
  stroke: { color: SocialLayoutColor; width: number; opacity: number } | null;
  radius: number;
};
export type SocialLayoutLogo = ElementBase & { type: 'logo'; align: SocialLayoutAlign; valign: SocialLayoutVAlign };
export type SocialLayoutText = ElementBase & {
  type: 'text';
  bind: SocialLayoutBind;
  font: 'title' | 'caption';
  color: SocialLayoutColor;
  /** Wielkość pisma w px dla szerokości 1080 (tekst dłuższy niż prostokąt jest zmniejszany). */
  size: number;
  /** Odstęp liter (em). */
  tracking: number;
  align: SocialLayoutAlign;
};
export type SocialLayoutElement = SocialLayoutPhoto | SocialLayoutShade | SocialLayoutBox | SocialLayoutLogo | SocialLayoutText;
export type SocialLayoutElementType = SocialLayoutElement['type'];

export type SocialLayoutDefinition = { v: 1; background: SocialLayoutColor; elements: SocialLayoutElement[] };

export const SOCIAL_LAYOUT_LIMITS = { elements: 40, slots: 4, name: 80 };
export const SOCIAL_LAYOUT_BIND_LABELS: Record<SocialLayoutBind, string> = {
  headline: 'Tytuł',
  subline: 'Podpis',
  kicker: 'Napis nad tytułem',
};
export const SOCIAL_LAYOUT_ELEMENT_LABELS: Record<SocialLayoutElementType, string> = {
  photo: 'Zdjęcie',
  shade: 'Przyciemnienie',
  box: 'Prostokąt / ramka',
  logo: 'Logo',
  text: 'Tekst',
};

type Row = Record<string, unknown>;
const object = (value: unknown): Row => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {});
const clamp = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const round = (value: number) => Math.round(value * 10000) / 10000;
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(String(value)) ? (value as T) : fallback;

function parseRect(raw: unknown): SocialLayoutRect | null {
  const source = object(raw);
  if (![source.x, source.y, source.w, source.h].every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  const x = clamp(source.x, 0, -0.5, 1.5);
  const y = clamp(source.y, 0, -0.5, 1.5);
  const w = clamp(source.w, 0.1, 0.005, 2);
  const h = clamp(source.h, 0.1, 0.005, 2);
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

/**
 * Definicja układu z bazy albo z edytora — w bezpiecznych zakresach (nieznane pola pomijane). `null`, gdy nie da się jej
 * użyć: brak elementów, brak miejsca na zdjęcie 0 albo miejsca nie po kolei (0, 1, 2…).
 */
export function parseSocialLayout(raw: unknown): SocialLayoutDefinition | null {
  const source = object(raw);
  if (!Array.isArray(source.elements)) return null;
  const used = new Set<string>();
  const elements: SocialLayoutElement[] = [];
  for (const [index, item] of (source.elements as unknown[]).slice(0, SOCIAL_LAYOUT_LIMITS.elements).entries()) {
    const element = object(item);
    const rect = parseRect(element.rect);
    if (!rect) continue;
    let id = typeof element.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(element.id) ? element.id : `e${index + 1}`;
    while (used.has(id)) id = `${id}x`;
    used.add(id);
    const formats: Partial<Record<SocialFormat, SocialLayoutRect>> = {};
    for (const format of SOCIAL_FORMATS) {
      const override = parseRect(object(element.formats)[format]);
      if (override) formats[format] = override;
    }
    const base = { id, rect, ...(Object.keys(formats).length ? { formats } : {}) };
    switch (element.type) {
      case 'photo': {
        const slot = Math.round(clamp(element.slot, -1, 0, SOCIAL_LAYOUT_LIMITS.slots - 1));
        if (slot < 0) continue;
        elements.push({ ...base, type: 'photo', slot, radius: clamp(element.radius, 0, 0, 400) });
        break;
      }
      case 'shade':
        elements.push({
          ...base, type: 'shade', color: pick(element.color, SOCIAL_LAYOUT_COLORS, 'overlay'),
          direction: pick(element.direction, ['up', 'down', 'left', 'right'] as const, 'down'),
          from: clamp(element.from, 0, 0, 1), to: clamp(element.to, 0.8, 0, 1),
        });
        break;
      case 'box': {
        const fill = object(element.fill);
        const stroke = object(element.stroke);
        elements.push({
          ...base, type: 'box',
          fill: element.fill ? { color: pick(fill.color, SOCIAL_LAYOUT_COLORS, 'overlay'), opacity: clamp(fill.opacity, 1, 0, 1) } : null,
          stroke: element.stroke ? {
            color: pick(stroke.color, SOCIAL_LAYOUT_COLORS, 'accent'), width: clamp(stroke.width, 2, 0.5, 60), opacity: clamp(stroke.opacity, 1, 0, 1),
          } : null,
          radius: clamp(element.radius, 0, 0, 400),
        });
        break;
      }
      case 'logo':
        elements.push({
          ...base, type: 'logo', align: pick(element.align, ['left', 'center', 'right'] as const, 'center'),
          valign: pick(element.valign, ['top', 'middle', 'bottom'] as const, 'middle'),
        });
        break;
      case 'text':
        elements.push({
          ...base, type: 'text', bind: pick(element.bind, ['headline', 'subline', 'kicker'] as const, 'headline'),
          font: pick(element.font, ['title', 'caption'] as const, 'title'), color: pick(element.color, SOCIAL_LAYOUT_COLORS, 'text'),
          size: clamp(element.size, 34, 6, 260), tracking: clamp(element.tracking, 0.2, 0, 1),
          align: pick(element.align, ['left', 'center', 'right'] as const, 'center'),
        });
        break;
      default:
        break;
    }
  }
  const slots = Array.from(new Set(elements.filter((item): item is SocialLayoutPhoto => item.type === 'photo').map((item) => item.slot))).sort();
  if (!slots.length || slots.some((slot, index) => slot !== index)) return null;
  return { v: 1, background: pick(source.background, SOCIAL_LAYOUT_COLORS, 'overlay'), elements };
}

/** Powód, dla którego definicji nie da się zapisać (komunikat dla edytora) — `null`, gdy w porządku. */
export function socialLayoutProblem(raw: unknown): string | null {
  const source = object(raw);
  if (!Array.isArray(source.elements) || !source.elements.length) return 'Dodaj elementy układu.';
  if ((source.elements as unknown[]).length > SOCIAL_LAYOUT_LIMITS.elements) return `Układ może mieć najwyżej ${SOCIAL_LAYOUT_LIMITS.elements} elementów.`;
  if (!parseSocialLayout(raw)) return 'Układ musi mieć zdjęcie 1, a kolejne zdjęcia kolażu numerowane po kolei (2, 3, 4).';
  return null;
}

/** Prostokąt elementu w formacie (nadpisanie formatu albo wspólny). */
export const socialLayoutRect = (element: SocialLayoutElement, format: SocialFormat): SocialLayoutRect => element.formats?.[format] || element.rect;

/** Liczba miejsc na zdjęcia (miejsce 0 — zdjęcie wariantu, kolejne — kolaż). */
export const socialLayoutSlots = (layout: SocialLayoutDefinition | null | undefined) =>
  layout ? Math.max(0, ...layout.elements.map((item) => (item.type === 'photo' ? item.slot + 1 : 0))) : 1;

/** Prostokąt miejsca na zdjęcie w formacie (pierwszy element zdjęcia z tym numerem). */
export function socialLayoutSlotRect(layout: SocialLayoutDefinition, slot: number, format: SocialFormat): SocialLayoutRect | null {
  const element = layout.elements.find((item): item is SocialLayoutPhoto => item.type === 'photo' && item.slot === slot);
  return element ? socialLayoutRect(element, format) : null;
}

/** Proporcje miejsca (szerokość / wysokość w px formatu) — kadr zdjęcia kolażu ma te proporcje. */
export function socialLayoutSlotAspect(layout: SocialLayoutDefinition | null | undefined, slot: number, format: SocialFormat): number {
  const { width, height } = SOCIAL_FORMAT_INFO[format];
  const rect = layout ? socialLayoutSlotRect(layout, slot, format) : null;
  if (!rect) return width / height;
  return Math.max(0.05, (rect.w * width) / Math.max(1, rect.h * height));
}

/** Kadr pośrodku zdjęcia w zadanych proporcjach (propozycja kadru miejsca kolażu). */
export function socialAspectCrop(imageWidth: number, imageHeight: number, aspect: number) {
  const imageAspect = imageWidth / Math.max(1, imageHeight);
  if (imageAspect > aspect) {
    const w = aspect / imageAspect;
    return { x: round((1 - w) / 2), y: 0, w: round(w), h: 1 };
  }
  const h = imageAspect / aspect;
  return { x: 0, y: round((1 - h) / 2), w: 1, h: round(h) };
}

/** Kadr dopasowany do proporcji miejsca (środek i szerokość zachowane, jak `fitCrop` dla formatu). */
export function fitAspectCrop(crop: { x: number; y: number; w: number; h: number }, imageWidth: number, imageHeight: number, aspect: number) {
  const centerX = crop.x + crop.w / 2;
  const centerY = crop.y + crop.h / 2;
  let widthPx = Math.min(1, Math.max(0.08, crop.w)) * imageWidth;
  let heightPx = widthPx / aspect;
  if (heightPx > imageHeight) {
    heightPx = imageHeight;
    widthPx = heightPx * aspect;
  }
  if (widthPx > imageWidth) {
    widthPx = imageWidth;
    heightPx = widthPx / aspect;
  }
  const w = widthPx / imageWidth;
  const h = heightPx / imageHeight;
  return {
    x: round(Math.min(Math.max(centerX - w / 2, 0), 1 - w)),
    y: round(Math.min(Math.max(centerY - h / 2, 0), 1 - h)),
    w: round(w),
    h: round(h),
  };
}

/** Kadr zgodny z proporcjami miejsca (tolerancja 1,5%) — inaczej trzeba zaproponować nowy. */
export function socialCropFitsAspect(crop: { w: number; h: number }, imageWidth: number, imageHeight: number, aspect: number) {
  const actual = (crop.w * imageWidth) / Math.max(1, crop.h * imageHeight);
  return Math.abs(actual / aspect - 1) < 0.015;
}

// Gotowe układy (punkt wyjścia; w edytorze płótna można je skopiować do układów marki) ---------------------------------

const text = (id: string, bind: SocialLayoutBind, rect: SocialLayoutRect, extra: Partial<SocialLayoutText> = {}): SocialLayoutText => ({
  id, type: 'text', bind, rect,
  font: bind === 'headline' ? 'title' : 'caption',
  color: bind === 'headline' ? 'text' : 'accent',
  size: bind === 'headline' ? 36 : bind === 'kicker' ? 16 : 18,
  tracking: bind === 'headline' ? 0.2 : bind === 'kicker' ? 0.42 : 0.35,
  align: 'center',
  ...extra,
});
const photo = (id: string, slot: number, rect: SocialLayoutRect, formats?: Partial<Record<SocialFormat, SocialLayoutRect>>): SocialLayoutPhoto => ({
  id, type: 'photo', slot, radius: 0, rect, ...(formats ? { formats } : {}),
});
const bottomShade = (rect: SocialLayoutRect = { x: 0, y: 0.5, w: 1, h: 0.5 }): SocialLayoutShade => ({
  id: 'shade-bottom', type: 'shade', color: 'overlay', direction: 'down', from: 0, to: 0.88, rect,
});
const topShade: SocialLayoutShade = { id: 'shade-top', type: 'shade', color: 'overlay', direction: 'up', from: 0, to: 0.55, rect: { x: 0, y: 0, w: 1, h: 0.24 } };
// Relacja 9:16: górne ~11% i dolne ~16% zasłania interfejs Instagrama — logo i teksty poza tymi strefami.
const logo = (rect: SocialLayoutRect = { x: 0.38, y: 0.04, w: 0.24, h: 0.11 }, extra: Partial<SocialLayoutLogo> = {}): SocialLayoutLogo => ({
  id: 'logo', type: 'logo', align: 'center', valign: 'top', rect, formats: { '9:16': { x: rect.x, y: 0.12, w: rect.w, h: 0.07 } }, ...extra,
});
const accentLine: SocialLayoutBox = {
  id: 'line', type: 'box', fill: { color: 'accent', opacity: 1 }, stroke: null, radius: 0, rect: { x: 0.4667, y: 0.893, w: 0.0667, h: 0.0016 },
  formats: { '9:16': { x: 0.4667, y: 0.7655, w: 0.0667, h: 0.0011 } },
};
const bottomTexts = [
  text('kicker', 'kicker', { x: 0.08, y: 0.755, w: 0.84, h: 0.03 }, { formats: { '9:16': { x: 0.08, y: 0.67, w: 0.84, h: 0.02 } } }),
  text('title', 'headline', { x: 0.08, y: 0.8, w: 0.84, h: 0.075 }, { formats: { '9:16': { x: 0.08, y: 0.7, w: 0.84, h: 0.05 } } }),
  accentLine,
  text('caption', 'subline', { x: 0.08, y: 0.91, w: 0.84, h: 0.04 }, { formats: { '9:16': { x: 0.08, y: 0.775, w: 0.84, h: 0.03 } } }),
];
const gap = 0.006;
const half = 0.5 - gap / 2;

export const SOCIAL_LAYOUT_PRESETS: Array<{ key: string; name: string; description: string; definition: SocialLayoutDefinition }> = [
  {
    key: 'preset-collage-2-side',
    name: 'Kolaż — 2 zdjęcia obok siebie',
    description: 'Dwa zdjęcia w pionowych połówkach (w relacji jedno nad drugim), teksty na dole.',
    definition: {
      v: 1, background: 'overlay', elements: [
        photo('photo-1', 0, { x: 0, y: 0, w: half, h: 1 }, { '9:16': { x: 0, y: 0, w: 1, h: half } }),
        photo('photo-2', 1, { x: 1 - half, y: 0, w: half, h: 1 }, { '9:16': { x: 0, y: 1 - half, w: 1, h: half } }),
        topShade, bottomShade(), logo(), ...bottomTexts,
      ],
    },
  },
  {
    key: 'preset-collage-2-stack',
    name: 'Kolaż — 2 zdjęcia jedno pod drugim',
    description: 'Dwa zdjęcia w poziomych połówkach, teksty na dole.',
    definition: {
      v: 1, background: 'overlay', elements: [
        photo('photo-1', 0, { x: 0, y: 0, w: 1, h: half }),
        photo('photo-2', 1, { x: 0, y: 1 - half, w: 1, h: half }),
        topShade, bottomShade(), logo(), ...bottomTexts,
      ],
    },
  },
  {
    key: 'preset-collage-3',
    name: 'Kolaż — 3 zdjęcia',
    description: 'Duże zdjęcie z lewej i dwa mniejsze z prawej (w relacji: duże na górze, dwa pod nim).',
    definition: {
      v: 1, background: 'overlay', elements: [
        photo('photo-1', 0, { x: 0, y: 0, w: 0.62 - gap / 2, h: 1 }, { '9:16': { x: 0, y: 0, w: 1, h: 0.62 - gap / 2 } }),
        photo('photo-2', 1, { x: 0.62 + gap / 2, y: 0, w: 0.38 - gap / 2, h: half }, { '9:16': { x: 0, y: 0.62 + gap / 2, w: half, h: 0.38 - gap / 2 } }),
        photo('photo-3', 2, { x: 0.62 + gap / 2, y: 1 - half, w: 0.38 - gap / 2, h: half }, { '9:16': { x: 1 - half, y: 0.62 + gap / 2, w: half, h: 0.38 - gap / 2 } }),
        topShade, bottomShade(), logo(), ...bottomTexts,
      ],
    },
  },
  {
    key: 'preset-collage-4',
    name: 'Kolaż — 4 zdjęcia',
    description: 'Cztery zdjęcia w siatce 2 × 2, teksty na dole.',
    definition: {
      v: 1, background: 'overlay', elements: [
        photo('photo-1', 0, { x: 0, y: 0, w: half, h: half }),
        photo('photo-2', 1, { x: 1 - half, y: 0, w: half, h: half }),
        photo('photo-3', 2, { x: 0, y: 1 - half, w: half, h: half }),
        photo('photo-4', 3, { x: 1 - half, y: 1 - half, w: half, h: half }),
        topShade, bottomShade(), logo(), ...bottomTexts,
      ],
    },
  },
  {
    key: 'preset-band',
    name: 'Zdjęcie z pasem tekstu',
    description: 'Zdjęcie u góry, pod nim pas w kolorze przyciemnienia z tekstami; logo na zdjęciu.',
    definition: {
      v: 1, background: 'overlay', elements: [
        photo('photo-1', 0, { x: 0, y: 0, w: 1, h: 0.72 }, { '9:16': { x: 0, y: 0, w: 1, h: 0.66 } }),
        { ...topShade, rect: { x: 0, y: 0, w: 1, h: 0.2 } },
        logo({ x: 0.06, y: 0.04, w: 0.22, h: 0.1 }, { align: 'left', formats: { '9:16': { x: 0.06, y: 0.12, w: 0.22, h: 0.07 } } }),
        { id: 'band-line', type: 'box', fill: { color: 'accent', opacity: 1 }, stroke: null, radius: 0, rect: { x: 0, y: 0.72, w: 1, h: 0.004 }, formats: { '9:16': { x: 0, y: 0.66, w: 1, h: 0.003 } } },
        text('kicker', 'kicker', { x: 0.08, y: 0.775, w: 0.84, h: 0.03 }, { formats: { '9:16': { x: 0.08, y: 0.71, w: 0.84, h: 0.025 } } }),
        text('title', 'headline', { x: 0.08, y: 0.815, w: 0.84, h: 0.075 }, { formats: { '9:16': { x: 0.08, y: 0.745, w: 0.84, h: 0.05 } } }),
        text('caption', 'subline', { x: 0.08, y: 0.9, w: 0.84, h: 0.04 }, { formats: { '9:16': { x: 0.08, y: 0.8, w: 0.84, h: 0.03 } } }),
      ],
    },
  },
];

export const socialLayoutPreset = (key: string) => SOCIAL_LAYOUT_PRESETS.find((preset) => preset.key === key) || null;
export const isSocialLayoutPresetKey = (value: unknown) => typeof value === 'string' && SOCIAL_LAYOUT_PRESETS.some((preset) => preset.key === value);
