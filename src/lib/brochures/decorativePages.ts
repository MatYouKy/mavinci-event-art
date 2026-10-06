import { isBrochureIcon, type BrochureIcon } from './brochureIcons';
export type BrochureImageBucket = 'offer-product-pages' | 'offer-template-pages' | 'seller-brand-assets';
export type BrochureImageAsset = { key: string; label: string; path: string; bucket: BrochureImageBucket };
export const BROCHURE_LAYOUTS = {
  signature: 'Okładka autorska', photo: 'Zdjęcie i hasło', editorial: 'Fotografia w ramce', statement: 'Plansza z hasłem',
  split: 'Zdjęcie obok tekstu', features: 'Korzyści / strefa sprzedawcy', 'features-photo': 'Zdjęcie nad kafelkami', process: 'Etapy współpracy', artwork: 'Gotowa grafika', showcase: 'Zdjęcie i karty usług', timeline: 'Oś czasu',
} as const;
export type BrochureLayout = keyof typeof BROCHURE_LAYOUTS;
export type PageRect = { x: number; y: number; width: number; height: number };
export type BrochurePageDesign = {
  text: PageRect; image: PageRect; details: PageRect;
  theme: 'light' | 'dark'; align: 'left' | 'center' | 'right'; fontSize: number;
  imageTint?: number; imageFade?: number; overlay: number; imageFit: 'cover' | 'contain'; imageX: number; showBrand: boolean; ornament?: 'none' | 'arc' | 'grid';
};
export type BrochureDecorativePage = {
  id: string; layout: BrochureLayout; slogan: string; caption: string;
  imagePath: string; imageBucket: BrochureImageBucket; imagePosition: number;
  afterItemId: string | null; isVisible: boolean;
  eyebrow?: string; icon?: BrochureIcon; pointIcons?: Array<BrochureIcon | ''>; points?: string[]; linkLabel?: string; linkUrl?: string; linkHint?: string; design?: BrochurePageDesign;
};
export type BrochureComposer = {
  pageOrder: string[]; hiddenPages: string[];
  coverImagePath: string; coverImageBucket: BrochureImageBucket;
  brandColor?: string; accentColor?: string;
  coverX: number; coverY: number; coverOverlay: number;
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const bounded = (value: unknown, fallback: number, min: number, max: number) => value !== null && value !== '' && Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
const short = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : '';
const stringList = (value: unknown, limit: number) => Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string'))].slice(0, limit) : [];
export const brochureAssetKey = (bucket: string, path: string) => `${bucket}:${path}`;
export const imageBucket = (value: unknown): BrochureImageBucket => value === 'seller-brand-assets' || value === 'offer-template-pages' ? value : 'offer-product-pages';
export const BROCHURE_SLOGANS = ['Państwa przestrzeń. Nasza realizacja.', 'Twoje wydarzenie. Nasza odpowiedzialność.', 'Dobra scena dla wielkich pomysłów.'];
export const requiresPageImage = (layout: BrochureLayout) => ['photo', 'editorial', 'split', 'artwork', 'showcase', 'signature', 'features-photo'].includes(layout);
export function pageDefaults(layout: BrochureLayout): BrochurePageDesign {
  const base: BrochurePageDesign = {
    text: { x: 10, y: 59, width: 80, height: 29 }, image: { x: 0, y: 0, width: 100, height: 100 },
    details: { x: 10, y: 47, width: 80, height: 41 }, theme: 'dark', align: 'left', fontSize: 36,
    overlay: 62, imageFit: 'cover', imageX: 50, showBrand: true,
  };
  if (layout === 'signature') return { ...base, text: { x: 8, y: 21, width: 84, height: 24 }, image: { x: 8, y: 46, width: 92, height: 39 }, details: { x: 8, y: 87, width: 84, height: 8 }, fontSize: 61, overlay: 8, imageTint: 82, imageFade: 90 };
  if (layout === 'editorial') return { ...base, theme: 'light', showBrand: false, text: { x: 10, y: 12, width: 80, height: 24 }, image: { x: 10, y: 40, width: 80, height: 46 }, overlay: 0, fontSize: 32 };
  if (layout === 'statement') return { ...base, text: { x: 10, y: 30, width: 80, height: 49 }, fontSize: 44, align: 'center', overlay: 0 };
  if (layout === 'split') return { ...base, theme: 'light', text: { x: 53, y: 24, width: 38, height: 56 }, image: { x: 0, y: 16, width: 47, height: 72 }, overlay: 0, fontSize: 29 };
  if (layout === 'features' || layout === 'process') return { ...base, theme: 'light', text: { x: 10, y: 14, width: 80, height: 29 }, overlay: 0, fontSize: 32 };
  if (layout === 'features-photo') return { ...base, theme: 'light', showBrand: false, overlay: 0, fontSize: 31, text: { x: 10, y: 8, width: 80, height: 23 }, image: { x: 10, y: 34, width: 80, height: 23 }, details: { x: 10, y: 61, width: 80, height: 30 } };
  if (layout === 'showcase') return { ...base, theme: 'light', showBrand: false, overlay: 0, fontSize: 31, text: { x: 10, y: 8, width: 80, height: 21 }, image: { x: 10, y: 31, width: 80, height: 31 }, details: { x: 10, y: 67, width: 80, height: 23 } };
  if (layout === 'timeline') return { ...base, theme: 'light', showBrand: false, overlay: 0, fontSize: 34, text: { x: 10, y: 10, width: 80, height: 24 }, details: { x: 10, y: 39, width: 80, height: 49 } };
  if (layout === 'artwork') return { ...base, showBrand: false, imageFit: 'contain', overlay: 0 };
  return base;
}
export function normalizeRect(value: unknown, fallback: PageRect): PageRect {
  const v = record(value);
  const width = bounded(v.width, fallback.width, 12, 100), height = bounded(v.height, fallback.height, 8, 100);
  return { x: bounded(v.x, fallback.x, 0, 100 - width), y: bounded(v.y, fallback.y, 0, 100 - height), width, height };
}
export function pageDesign(page: Pick<BrochureDecorativePage, 'layout' | 'design'>): BrochurePageDesign {
  const base = pageDefaults(page.layout), v = record(page.design);
  return { text: normalizeRect(v.text, base.text), image: normalizeRect(v.image, base.image), details: normalizeRect(v.details, base.details),
    ornament: v.ornament === 'arc' || v.ornament === 'grid' ? v.ornament : 'none',
    theme: v.theme === 'light' || v.theme === 'dark' ? v.theme : base.theme,
    align: v.align === 'left' || v.align === 'center' || v.align === 'right' ? v.align : base.align, fontSize: bounded(v.fontSize, base.fontSize, 20, 64),
    imageTint: bounded(v.imageTint, base.imageTint || 0, 0, 100), imageFade: bounded(v.imageFade, base.imageFade || 0, 0, 100),
    overlay: bounded(v.overlay, base.overlay, 0, 90), imageFit: v.imageFit === 'contain' || v.imageFit === 'cover' ? v.imageFit : base.imageFit,
    imageX: bounded(v.imageX, 50, 0, 100), showBrand: typeof v.showBrand === 'boolean' ? v.showBrand : base.showBrand };
}
export function parseDecorativePages(value: unknown): BrochureDecorativePage[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.filter((v) => {
    const id = record(v).id;
    if (typeof id !== 'string' || !id || ids.has(id)) return false;
    ids.add(id); return true;
  }).slice(0, 40).map((value) => {
    const v = record(value);
    const layout: BrochureLayout = typeof v.layout === 'string' && Object.prototype.hasOwnProperty.call(BROCHURE_LAYOUTS, v.layout) ? v.layout as BrochureLayout : 'photo';
    const page: BrochureDecorativePage = { id: String(v.id), layout, slogan: short(v.slogan, 120), caption: short(v.caption, 600),
      imagePath: short(v.imagePath, 2000), imageBucket: imageBucket(v.imageBucket), imagePosition: bounded(v.imagePosition, 50, 0, 100),
      afterItemId: typeof v.afterItemId === 'string' ? v.afterItemId : null, isVisible: v.isVisible !== false,
      eyebrow: short(v.eyebrow, 80), icon: isBrochureIcon(v.icon) ? v.icon : undefined, pointIcons: Array.isArray(v.pointIcons) ? v.pointIcons.slice(0, 6).map((icon) => isBrochureIcon(icon) ? icon : '') : [],
      points: Array.isArray(v.points) ? v.points.filter((p): p is string => typeof p === 'string').slice(0, 6).map((p) => p.slice(0, 240)) : [], linkLabel: short(v.linkLabel, 80), linkUrl: short(v.linkUrl, 1000), linkHint: short(v.linkHint, 160) };
    // Keep existing photo/editorial pages on their original renderer until edited visually.
    if (v.design && typeof v.design === 'object') page.design = pageDesign({ layout, design: v.design as BrochurePageDesign });
    return page;
  });
}
export function parseComposer(value: unknown): BrochureComposer {
  const v = record(value);
  return { brandColor: typeof v.brandColor === 'string' && /^#[0-9a-f]{6}$/i.test(v.brandColor) ? v.brandColor : '', accentColor: typeof v.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(v.accentColor) ? v.accentColor : '',
    pageOrder: stringList(v.pageOrder, 300), hiddenPages: stringList(v.hiddenPages, 3).filter((k) => ['cover', 'intro', 'closing'].includes(k)),
    coverImagePath: short(v.coverImagePath, 2000), coverImageBucket: imageBucket(v.coverImageBucket),
    coverX: bounded(v.coverX, 50, 0, 100), coverY: bounded(v.coverY, 50, 0, 100), coverOverlay: bounded(v.coverOverlay, 78, 0, 95) };
}
export function composeBrochureContent<T extends { id: string }, D extends BrochureDecorativePage>(items: T[], decorations: D[]) {
  const ids = new Set(items.map((item) => item.id));
  const groups = new Map<string | null, D[]>();
  for (const page of decorations.filter((page) => page.isVisible)) {
    const anchor = page.afterItemId === null || ids.has(page.afterItemId) ? page.afterItemId : items.at(-1)?.id || null;
    groups.set(anchor, [...(groups.get(anchor) || []), page]);
  }
  const content: Array<{ kind: 'product'; item: T } | { kind: 'decorative'; page: D }> = [];
  const append = (anchor: string | null) => (groups.get(anchor) || []).forEach((page) => content.push({ kind: 'decorative', page }));
  append(null);
  for (const item of items) { content.push({ kind: 'product', item }); append(item.id); }
  return content;
}
export function orderedBrochureKeys(items: Array<{ id: string }>, pages: BrochureDecorativePage[], order: string[] = []) {
  const keys = ['cover', 'intro', ...composeBrochureContent(items, pages).map((e) => e.kind === 'product' ? `product:${e.item.id}` : `decorative:${e.page.id}`), 'closing'];
  const available = new Set(keys), requested = [...new Set(order)].filter((k) => available.has(k));
  if (!requested.length) return keys;
  // New pages are inserted before the closing page without disturbing an existing composition.
  const missing = keys.filter((k) => !requested.includes(k));
  const closing = requested.indexOf('closing');
  requested.splice(closing < 0 ? requested.length : closing, 0, ...missing);
  return requested;
}
export function resolvedBenefits(custom: unknown, variant: unknown, product: unknown): string[] {
  const value = Array.isArray(custom) ? custom : Array.isArray(variant) && variant.length ? variant : product;
  return Array.isArray(value) ? value.map((v) => String(v || '').trim()).filter(Boolean) : [];
}
export function brochurePageProblem(page: BrochureDecorativePage): string | null {
  if (!page.isVisible) return null;
  if (page.layout !== 'artwork' && !page.slogan.trim()) return 'Uzupełnij tytuł strony.';
  if (requiresPageImage(page.layout) && !page.imagePath) return 'Wybierz zdjęcie lub grafikę.';
  if (['features', 'features-photo', 'process', 'timeline', 'showcase'].includes(page.layout) && !page.points?.some((p) => p.trim())) return 'Dodaj przynajmniej jeden punkt.';
  if (page.linkUrl && !/^https?:\/\/[^\s]+$/i.test(page.linkUrl)) return 'Link musi zaczynać się od https:// lub http://.';
  return null;
}
export const BROCHURE_PRESETS = {
  seller: { label: 'Strefa sprzedawcy', layout: 'features', slogan: 'Twoja marka. Większa oferta. Jeden partner.',
    caption: 'Klient pyta o konferencję, galę lub integrację? Połącz ofertę swojego hotelu lub agencji z usługami Mavinci. Pokaż klientowi gotowy PDF z własnym logo i kolorami, a szczegóły realizacji uzgodnij ze swoim opiekunem.',
    points: ['Katalog pod ręką | Dobieraj udostępnione usługi i warianty do potrzeb klienta.', 'Oferta dla Twojego klienta | Przygotuj dokument PDF z tożsamością organizacji skonfigurowaną w systemie.', 'Kontakt z opiekunem | Omawiaj ofertę i ustalenia w jednym miejscu.', 'Od oferty do realizacji | Korzystaj z wersji dokumentów i procesu uzgodnienia realizacji.'], linkLabel: 'Wypróbuj demo — stwórz własną ofertę', linkHint: 'Bez logowania. Twoje logo i kolory. Przykładowy PDF do pobrania.' },
  hotel: { label: 'Propozycja dla hotelu', layout: 'split', slogan: 'Państwa przestrzeń. Nasza realizacja.', caption: 'Propozycja dla {{klient}}. Wspólnie dobierzmy oprawę konferencji, gali lub spotkania firmowego do charakteru Państwa obiektu.', points: [] },
  news: { label: 'Nowość w ofercie', layout: 'editorial', slogan: 'Nowe możliwości dla Twoich wydarzeń.', caption: 'Opisz nowość, jej zastosowanie i korzyść dla odbiorcy.', points: [] },
  process: { label: 'Jak współpracujemy', layout: 'process', slogan: 'Od pomysłu do realizacji.', caption: 'Uzgodnijmy zakres wsparcia dopasowany do Państwa wydarzenia.', points: ['Rozmowa | Poznajemy cel, miejsce i oczekiwania.', 'Propozycja | Dobieramy usługi i zakres realizacji.', 'Przygotowanie | Uzgadniamy szczegóły techniczne i organizacyjne.', 'Realizacja | Prowadzimy ustaloną obsługę wydarzenia.'] },
} satisfies Record<string, { label: string; layout: BrochureLayout; slogan: string; caption: string; points: string[]; linkLabel?: string; linkHint?: string }>;
export function brochurePalette(colors: Array<{ role: string; hex: string }>) {
  // The renderer calls the accent primaryColor and the dark surface secondaryColor.
  // Resolve by brandbook roles instead of guessing a burgundy/gold palette from RGB.
  const valid = colors.filter((color) => /^#[0-9a-f]{6}$/i.test(color.hex));
  const accent = valid.find((c) => ['accent', 'gold'].includes(c.role));
  const primary = valid.find((c) => ['primary', 'brand_primary'].includes(c.role));
  const secondary = valid.find((c) => ['secondary', 'burgundy'].includes(c.role));
  return { primaryColor: accent?.hex || '#d3bb73', secondaryColor: primary?.hex || secondary?.hex || '#1c1f33' };
}
