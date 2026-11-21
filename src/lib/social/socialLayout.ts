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
 *
 * Duża grafika (`canvas`, Etap G): siatka profilu Instagram (3 kolumny × 1–3 rzędy kafelków) albo panorama w karuzeli
 * (2–5 slajdów). Prostokąty są wtedy względem całej dużej grafiki, rozmiary w px kafelka (1080 szerokości), a serwer tnie
 * render na kafelki 4:5 (1080 × 1350). Siatka profilu pokazuje środek kafelka w proporcjach 3:4 (1012,5 × 1350), więc
 * kafelki siatki zachodzą na siebie o 67,5 px — w profilu łączą się bez przesunięć, a w feedzie każdy wygląda naturalnie.
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

/** Duża grafika: siatka profilu (rzędy po 3 kafelki) albo panorama w karuzeli (slajdy obok siebie). */
export type SocialCanvas = { mode: 'grid'; rows: 1 | 2 | 3 } | { mode: 'panorama'; slides: 2 | 3 | 4 | 5 };

export type SocialLayoutDefinition = { v: 1; background: SocialLayoutColor; elements: SocialLayoutElement[]; canvas?: SocialCanvas };

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
  const canvas = parseSocialCanvas(source.canvas);
  return { v: 1, background: pick(source.background, SOCIAL_LAYOUT_COLORS, 'overlay'), elements, ...(canvas ? { canvas } : {}) };
}

/** Powód, dla którego definicji nie da się zapisać (komunikat dla edytora) — `null`, gdy w porządku. */
export function socialLayoutProblem(raw: unknown): string | null {
  const source = object(raw);
  if (!Array.isArray(source.elements) || !source.elements.length) return 'Dodaj elementy układu.';
  if ((source.elements as unknown[]).length > SOCIAL_LAYOUT_LIMITS.elements) return `Układ może mieć najwyżej ${SOCIAL_LAYOUT_LIMITS.elements} elementów.`;
  if (!parseSocialLayout(raw)) return 'Układ musi mieć zdjęcie 1, a kolejne zdjęcia kolażu numerowane po kolei (2, 3, 4).';
  return null;
}

// Duża grafika — siatka profilu i panorama --------------------------------------------------------------------------

/** Kafelek / slajd 4:5 (Instagram przez API przyjmuje najwyżej 4:5). */
export const SOCIAL_TILE = { width: 1080, height: 1350 } as const;
/** Widoczna szerokość kafelka w siatce profilu (środek 3:4 kafelka 1080 × 1350) i pas obcięty z każdego boku. */
export const SOCIAL_GRID_STEP = 1012.5;
export const SOCIAL_GRID_HIDDEN = (SOCIAL_TILE.width - SOCIAL_GRID_STEP) / 2;
export const SOCIAL_CANVAS_LIMITS = { gridRows: [1, 2, 3] as const, panoramaSlides: [2, 3, 4, 5] as const };

export function parseSocialCanvas(raw: unknown): SocialCanvas | null {
  const source = object(raw);
  if (source.mode === 'grid' && (source.rows === 1 || source.rows === 2 || source.rows === 3)) return { mode: 'grid', rows: source.rows };
  if (source.mode === 'panorama' && (source.slides === 2 || source.slides === 3 || source.slides === 4 || source.slides === 5)) {
    return { mode: 'panorama', slides: source.slides };
  }
  return null;
}

export const sameSocialCanvas = (a: SocialCanvas | null | undefined, b: SocialCanvas | null | undefined) =>
  (a?.mode || null) === (b?.mode || null)
  && (a?.mode === 'grid' ? a.rows : a?.mode === 'panorama' ? a.slides : 0) === (b?.mode === 'grid' ? b.rows : b?.mode === 'panorama' ? b.slides : 0);

/** Liczba kafelków (siatka) albo slajdów (panorama). */
export const socialCanvasTileCount = (canvas: SocialCanvas) => (canvas.mode === 'grid' ? canvas.rows * 3 : canvas.slides);

/** Wymiary dużej grafiki w px. Siatka: 2 × 1012,5 + 1080 = 3105 szerokości; panorama: slajdy po 1080 obok siebie. */
export function socialCanvasSize(canvas: SocialCanvas) {
  return canvas.mode === 'grid'
    ? { width: SOCIAL_GRID_STEP * 2 + SOCIAL_TILE.width, height: SOCIAL_TILE.height * canvas.rows }
    : { width: SOCIAL_TILE.width * canvas.slides, height: SOCIAL_TILE.height };
}

/** Np. „Siatka profilu — 6 kafelków”, „Panorama — 3 slajdy”. */
export function socialCanvasLabel(canvas: SocialCanvas) {
  const count = socialCanvasTileCount(canvas);
  return canvas.mode === 'grid'
    ? `Siatka profilu — ${count} ${count === 3 ? 'kafelki' : 'kafelków'}`
    : `Panorama — ${count} ${count === 5 ? 'slajdów' : 'slajdy'}`;
}

/**
 * Kafelki w kolejności czytania (1 — lewy górny): prostokąt wycinany z dużej grafiki (px, zaokrąglone do pełnych px)
 * i widoczna część w siatce profilu (px, bez zaokrągleń). Publikacja siatki — od ostatniego kafelka do pierwszego.
 */
export function socialCanvasTiles(canvas: SocialCanvas) {
  const tiles: Array<{ position: number; row: number; col: number; x: number; y: number; width: number; height: number; visible: SocialLayoutRect }> = [];
  if (canvas.mode === 'grid') {
    for (let row = 0; row < canvas.rows; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const left = col * SOCIAL_GRID_STEP;
        tiles.push({
          position: row * 3 + col + 1, row, col, x: Math.round(left), y: row * SOCIAL_TILE.height, width: SOCIAL_TILE.width, height: SOCIAL_TILE.height,
          visible: { x: left + SOCIAL_GRID_HIDDEN, y: row * SOCIAL_TILE.height, w: SOCIAL_GRID_STEP, h: SOCIAL_TILE.height },
        });
      }
    }
  } else {
    for (let col = 0; col < canvas.slides; col += 1) {
      const left = col * SOCIAL_TILE.width;
      tiles.push({
        position: col + 1, row: 0, col, x: left, y: 0, width: SOCIAL_TILE.width, height: SOCIAL_TILE.height,
        visible: { x: left, y: 0, w: SOCIAL_TILE.width, h: SOCIAL_TILE.height },
      });
    }
  }
  return tiles;
}

/** Styki kafelków widoczne po złożeniu (siatka — granice widocznych części, panorama — granice slajdów), w px. */
export function socialCanvasSeams(canvas: SocialCanvas) {
  const size = socialCanvasSize(canvas);
  if (canvas.mode === 'panorama') {
    return { x: Array.from({ length: canvas.slides - 1 }, (_, index) => (index + 1) * SOCIAL_TILE.width), y: [] as number[], hidden: [] as Array<{ x: number; w: number }> };
  }
  return {
    x: [1, 2].map((index) => SOCIAL_GRID_HIDDEN + index * SOCIAL_GRID_STEP),
    y: Array.from({ length: canvas.rows - 1 }, (_, index) => (index + 1) * SOCIAL_TILE.height),
    // Pasy obcinane w siatce: po bokach całej grafiki (w środku zakładki — widoczne w sąsiednim kafelku).
    hidden: [{ x: 0, w: SOCIAL_GRID_HIDDEN }, { x: size.width - SOCIAL_GRID_HIDDEN, w: SOCIAL_GRID_HIDDEN }],
  };
}

/**
 * Wymiary rysowania układu: duża grafika (`canvas`, rozmiary w px kafelka) albo format posta (skala = szerokość / 1080).
 */
export function socialLayoutFrame(layout: SocialLayoutDefinition | null | undefined, format: SocialFormat) {
  if (layout?.canvas) {
    const size = socialCanvasSize(layout.canvas);
    return { width: size.width, height: size.height, scale: SOCIAL_TILE.width / 1080 };
  }
  const { width, height } = SOCIAL_FORMAT_INFO[format];
  return { width, height, scale: width / 1080 };
}

/**
 * Elementy przechodzące przez styk kafelków (logo, teksty, prostokąty) albo wchodzące w pas obcinany w siatce — w feedzie
 * byłyby przecięte. Zwraca identyfikatory elementów (ostrzeżenie w kreatorze, bez blokady).
 */
export function socialCanvasCrossings(layout: SocialLayoutDefinition): string[] {
  if (!layout.canvas) return [];
  const size = socialCanvasSize(layout.canvas);
  const seams = socialCanvasSeams(layout.canvas);
  const result: string[] = [];
  for (const element of layout.elements) {
    if (element.type === 'photo' || element.type === 'shade') continue;
    const left = element.rect.x * size.width;
    const right = (element.rect.x + element.rect.w) * size.width;
    const top = element.rect.y * size.height;
    const bottom = (element.rect.y + element.rect.h) * size.height;
    const crosses = seams.x.some((x) => left < x - 1 && right > x + 1) || seams.y.some((y) => top < y - 1 && bottom > y + 1)
      || seams.hidden.some((strip) => left < strip.x + strip.w - 1 && right > strip.x + 1);
    if (crosses) result.push(element.id);
  }
  return result;
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

/** Proporcje miejsca (szerokość / wysokość w px formatu albo dużej grafiki) — kadr zdjęcia w miejscu ma te proporcje. */
export function socialLayoutSlotAspect(layout: SocialLayoutDefinition | null | undefined, slot: number, format: SocialFormat): number {
  const { width, height } = socialLayoutFrame(layout, format);
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

// Gotowe układy dużej grafiki (siatka profilu, panorama) — każdy element w obrębie jednego kafelka, żeby kafelek w feedzie
// był czytelny sam w sobie; zdjęcie i przyciemnienia mogą przechodzić przez kafelki. Rozmiary pisma — w px kafelka.

const r4 = (value: number) => Math.round(value * 10000) / 10000;

/** Prostokąt względem widocznej części kafelka (kolumna, rząd; panorama — slajd) → względem całej dużej grafiki. */
function tileRect(canvas: SocialCanvas, col: number, row: number, rect: SocialLayoutRect): SocialLayoutRect {
  const size = socialCanvasSize(canvas);
  const tile = socialCanvasTiles(canvas).find((item) => item.col === col && item.row === row);
  if (!tile) return rect;
  const view = tile.visible;
  return {
    x: r4((view.x + rect.x * view.w) / size.width), y: r4((view.y + rect.y * view.h) / size.height),
    w: r4((rect.w * view.w) / size.width), h: r4((rect.h * view.h) / size.height),
  };
}
/** Prostokąt w px dużej grafiki → 0…1. */
const canvasRect = (canvas: SocialCanvas, x: number, y: number, w: number, h: number): SocialLayoutRect => {
  const size = socialCanvasSize(canvas);
  return { x: r4(x / size.width), y: r4(y / size.height), w: r4(w / size.width), h: r4(h / size.height) };
};
const bigText = (id: string, bind: SocialLayoutBind, rect: SocialLayoutRect, extra: Partial<SocialLayoutText> = {}): SocialLayoutText => text(id, bind, rect, {
  size: bind === 'headline' ? 80 : bind === 'kicker' ? 30 : 34,
  tracking: bind === 'headline' ? 0.12 : bind === 'kicker' ? 0.38 : 0.28,
  ...extra,
});
const canvasLogo = (rect: SocialLayoutRect, align: SocialLayoutAlign = 'center', valign: SocialLayoutVAlign = 'middle'): SocialLayoutLogo => ({
  id: 'logo', type: 'logo', align, valign, rect,
});
const canvasLine = (rect: SocialLayoutRect): SocialLayoutBox => ({
  id: 'line', type: 'box', fill: { color: 'accent', opacity: 1 }, stroke: null, radius: 0, rect,
});
const shade = (id: string, rect: SocialLayoutRect, direction: SocialLayoutDirection, from: number, to: number): SocialLayoutShade => ({
  id, type: 'shade', color: 'overlay', direction, from, to, rect,
});
/** Teksty wyśrodkowane w kafelku (napis nad tytułem, tytuł, kreska, podpis) od wysokości `top` (0…1 kafelka). */
function tileTexts(canvas: SocialCanvas, col: number, row: number, top: number, headline = 80): SocialLayoutElement[] {
  return [
    bigText('kicker', 'kicker', tileRect(canvas, col, row, { x: 0.08, y: top, w: 0.84, h: 0.05 })),
    bigText('title', 'headline', tileRect(canvas, col, row, { x: 0.06, y: top + 0.06, w: 0.88, h: 0.1 }), { size: headline }),
    canvasLine(tileRect(canvas, col, row, { x: 0.44, y: top + 0.185, w: 0.12, h: 0.004 })),
    bigText('caption', 'subline', tileRect(canvas, col, row, { x: 0.08, y: top + 0.215, w: 0.84, h: 0.05 })),
  ];
}

const GRID_1: SocialCanvas = { mode: 'grid', rows: 1 };
const GRID_2: SocialCanvas = { mode: 'grid', rows: 2 };
const GRID_3: SocialCanvas = { mode: 'grid', rows: 3 };
const fullPhoto = () => photo('photo-1', 0, { x: 0, y: 0, w: 1, h: 1 });
/** Zdjęcie w dwóch pierwszych kolumnach siatki — do widocznego styku z trzecią kolumną. */
const twoColumnPhoto = (canvas: SocialCanvas) => photo('photo-1', 0, canvasRect(canvas, 0, 0, SOCIAL_GRID_HIDDEN + 2 * SOCIAL_GRID_STEP, socialCanvasSize(canvas).height));

function panoramaPreset(slides: 2 | 3 | 4 | 5): { key: string; name: string; description: string; definition: SocialLayoutDefinition } {
  const canvas: SocialCanvas = { mode: 'panorama', slides };
  return {
    key: `preset-pano-${slides}`,
    name: `Panorama — ${slides} ${slides === 5 ? 'slajdów' : 'slajdy'}`,
    description: 'Jedno zdjęcie przez wszystkie slajdy karuzeli; logo i teksty na pierwszym slajdzie, przyciemnionym od lewej.',
    definition: {
      v: 1, background: 'overlay', canvas, elements: [
        fullPhoto(),
        shade('shade-first', tileRect(canvas, 0, 0, { x: 0, y: 0, w: 1, h: 1 }), 'left', 0, 0.78),
        shade('shade-bottom', { x: 0, y: 0.62, w: 1, h: 0.38 }, 'down', 0, 0.55),
        canvasLogo(tileRect(canvas, 0, 0, { x: 0.08, y: 0.06, w: 0.4, h: 0.12 }), 'left', 'top'),
        bigText('kicker', 'kicker', tileRect(canvas, 0, 0, { x: 0.08, y: 0.68, w: 0.84, h: 0.04 }), { align: 'left' }),
        bigText('title', 'headline', tileRect(canvas, 0, 0, { x: 0.08, y: 0.73, w: 0.86, h: 0.09 }), { align: 'left', size: 72 }),
        canvasLine(tileRect(canvas, 0, 0, { x: 0.08, y: 0.835, w: 0.1, h: 0.004 })),
        bigText('caption', 'subline', tileRect(canvas, 0, 0, { x: 0.08, y: 0.86, w: 0.84, h: 0.045 }), { align: 'left' }),
      ],
    },
  };
}

export const SOCIAL_CANVAS_PRESETS: Array<{ key: string; name: string; description: string; definition: SocialLayoutDefinition }> = [
  {
    key: 'preset-grid-1-photo',
    name: 'Baner — zdjęcie przez 3 kafelki',
    description: 'Jeden rząd: zdjęcie przez całą szerokość, logo w pierwszym kafelku, teksty w środkowym. Dobry do przypięcia na górze profilu.',
    definition: {
      v: 1, background: 'overlay', canvas: GRID_1, elements: [
        fullPhoto(),
        shade('shade-all', { x: 0, y: 0, w: 1, h: 1 }, 'down', 0.15, 0.55),
        canvasLogo(tileRect(GRID_1, 0, 0, { x: 0.15, y: 0.38, w: 0.7, h: 0.24 })),
        ...tileTexts(GRID_1, 1, 0, 0.36),
      ],
    },
  },
  {
    key: 'preset-grid-1-panel',
    name: 'Baner — zdjęcie i pole marki',
    description: 'Jeden rząd: zdjęcie w dwóch kafelkach, trzeci kafelek w kolorze marki z logo i tekstami.',
    definition: {
      v: 1, background: 'overlay', canvas: GRID_1, elements: [
        twoColumnPhoto(GRID_1),
        canvasLogo(tileRect(GRID_1, 2, 0, { x: 0.2, y: 0.12, w: 0.6, h: 0.16 })),
        ...tileTexts(GRID_1, 2, 0, 0.42, 66),
      ],
    },
  },
  {
    key: 'preset-grid-2-photo',
    name: 'Siatka 6 — zdjęcie przez 6 kafelków',
    description: 'Dwa rzędy: zdjęcie przez całą siatkę, logo w lewym górnym kafelku, teksty w środkowym dolnym.',
    definition: {
      v: 1, background: 'overlay', canvas: GRID_2, elements: [
        fullPhoto(),
        shade('shade-top', { x: 0, y: 0, w: 1, h: 0.2 }, 'up', 0, 0.5),
        shade('shade-bottom', { x: 0, y: 0.5, w: 1, h: 0.5 }, 'down', 0, 0.85),
        canvasLogo(tileRect(GRID_2, 0, 0, { x: 0.15, y: 0.08, w: 0.7, h: 0.2 })),
        ...tileTexts(GRID_2, 1, 1, 0.5),
      ],
    },
  },
  {
    key: 'preset-grid-2-panel',
    name: 'Siatka 6 — zdjęcie z kolumną marki',
    description: 'Dwa rzędy: zdjęcie w dwóch kolumnach, prawa kolumna w kolorze marki — logo u góry, teksty na dole.',
    definition: {
      v: 1, background: 'overlay', canvas: GRID_2, elements: [
        twoColumnPhoto(GRID_2),
        canvasLogo(tileRect(GRID_2, 2, 0, { x: 0.18, y: 0.32, w: 0.64, h: 0.36 })),
        ...tileTexts(GRID_2, 2, 1, 0.34, 66),
      ],
    },
  },
  {
    key: 'preset-grid-3-photo',
    name: 'Siatka 9 — zdjęcie przez 9 kafelków',
    description: 'Trzy rzędy: zdjęcie przez całą siatkę, logo w środkowym kafelku, teksty w środkowym dolnym.',
    definition: {
      v: 1, background: 'overlay', canvas: GRID_3, elements: [
        fullPhoto(),
        shade('shade-all', { x: 0, y: 0, w: 1, h: 1 }, 'down', 0.1, 0.4),
        shade('shade-bottom', { x: 0, y: 2 / 3, w: 1, h: 1 / 3 }, 'down', 0, 0.7),
        canvasLogo(tileRect(GRID_3, 1, 1, { x: 0.15, y: 0.38, w: 0.7, h: 0.24 })),
        ...tileTexts(GRID_3, 1, 2, 0.4),
      ],
    },
  },
  {
    key: 'preset-grid-3-center',
    name: 'Siatka 9 — pole marki w środku',
    description: 'Trzy rzędy: zdjęcie przez całą siatkę, środkowy kafelek w kolorze marki z logo i tekstami.',
    definition: {
      v: 1, background: 'overlay', canvas: GRID_3, elements: [
        fullPhoto(),
        { id: 'panel', type: 'box', fill: { color: 'overlay', opacity: 0.94 }, stroke: null, radius: 0, rect: tileRect(GRID_3, 1, 1, { x: 0, y: 0, w: 1, h: 1 }) },
        canvasLogo(tileRect(GRID_3, 1, 1, { x: 0.2, y: 0.12, w: 0.6, h: 0.18 })),
        ...tileTexts(GRID_3, 1, 1, 0.44, 66),
      ],
    },
  },
  panoramaPreset(2),
  panoramaPreset(3),
  panoramaPreset(4),
  panoramaPreset(5),
];

/** Gotowe układy dużej grafiki w danym kształcie (np. siatka 2 rzędy). */
export const socialCanvasPresets = (canvas: SocialCanvas | null | undefined) =>
  SOCIAL_CANVAS_PRESETS.filter((preset) => !canvas || sameSocialCanvas(preset.definition.canvas, canvas));

export const socialLayoutPreset = (key: string) =>
  SOCIAL_LAYOUT_PRESETS.find((preset) => preset.key === key) || SOCIAL_CANVAS_PRESETS.find((preset) => preset.key === key) || null;
export const isSocialLayoutPresetKey = (value: unknown) => typeof value === 'string' && Boolean(socialLayoutPreset(value));
