/*
 * Strefa sprzedawcy → „Prezentacje” (materiały na spotkania z klientami) — wspólne dla CRM i serwera Next; aplikacja na Maca
 * ma ten sam model w `desktop/mac/Sources/Mavinci/Showcase/ShowcaseModels.swift`, telefon / iPad dostanie kopię w etapie 2.
 * Bez importów.
 *
 * Dział (`sales_showcase_sections`) grupuje karty (`sales_showcase_items`). Karta = tytuł, hasło, produkty katalogu i treść:
 * wstęp, zdjęcie główne i bloki w ustalonej kolejności (przeciąganie). Bloki „Z katalogu produktów” nie kopiują treści —
 * opis, korzyści, warianty, ceny, pakiety i przygotowanie serwer czyta na bieżąco z Oferty → Produkty (jedno źródło prawdy).
 * Puste bloki nie pokazują się na spotkaniu (lista kontrolna w edytorze o nich przypomina).
 */

export const SHOWCASE_LIMITS = {
  sectionTitle: 80,
  sectionSubtitle: 240,
  title: 120,
  tagline: 240,
  lead: 1500,
  products: 12,
  blocks: 30,
  blockTitle: 80,
  blockText: 4000,
  photos: 60,
  photosTotal: 240,
  caption: 200,
  rows: 40,
  rowTitle: 200,
  rowText: 1500,
  refs: 24,
  mediaPath: 800,
  uploadBytes: 40 * 1024 * 1024,
} as const;

/** Ikony działów (CRM: lucide, Mac: SF Symbols — odwzorowanie w każdej aplikacji po kluczu). */
export const SHOWCASE_ICONS = [
  { key: 'sparkles', label: 'Efekty' },
  { key: 'monitor', label: 'Ekrany' },
  { key: 'tv', label: 'Telewizory i monitory' },
  { key: 'speaker', label: 'Nagłośnienie' },
  { key: 'lightbulb', label: 'Oświetlenie' },
  { key: 'stage', label: 'Scena' },
  { key: 'mic', label: 'Konferencje' },
  { key: 'music', label: 'Muzyka' },
  { key: 'camera', label: 'Foto i wideo' },
  { key: 'gamepad', label: 'Atrakcje' },
  { key: 'party', label: 'Imprezy' },
  { key: 'users', label: 'Obsługa' },
  { key: 'building', label: 'Obiekty' },
  { key: 'utensils', label: 'Gastronomia' },
  { key: 'gift', label: 'Pakiety' },
  { key: 'star', label: 'Wyróżnione' },
  { key: 'layers', label: 'Inne' },
  { key: 'award', label: 'Realizacje' },
] as const;
export type ShowcaseIcon = (typeof SHOWCASE_ICONS)[number]['key'];
export const isShowcaseIcon = (value: unknown): value is ShowcaseIcon => SHOWCASE_ICONS.some((icon) => icon.key === value);

/** Urządzenia w podglądzie (poziomo, w punktach ekranu). */
export const SHOWCASE_DEVICES = [
  { key: 'ipad13', label: 'iPad Pro 13″', width: 1376, height: 1032 },
  { key: 'ipad11', label: 'iPad Air 11″', width: 1180, height: 820 },
] as const;
export type ShowcaseDevice = (typeof SHOWCASE_DEVICES)[number]['key'];

/**
 * Zdjęcie w prezentacji. `upload` — wersje WebP w prywatnym buckecie `sales-showcase` (`path` — duża do 2560 px, `thumb` —
 * miniatura 640 px); `product` — zdjęcie produktu z katalogu (`offer-product-pages`, bez kopii); `site` — zdjęcie realizacji
 * ze strony (publiczny adres naszego Storage); `material` — zdjęcie z Materiałów (główna baza zdjęć): odnośnik do pliku,
 * a do pokazu jedna wspólna wersja WebP na wersję treści pliku (`materials/<plik>/v<wersja>.webp` + `-t.webp` w
 * `sales-showcase`) — ten sam plik w wielu kartach nie tworzy kopii.
 */
export type ShowcaseMediaSource = 'upload' | 'product' | 'site' | 'material';
export type ShowcaseMedia = {
  id: string;
  source: ShowcaseMediaSource;
  path: string;
  thumb: string | null;
  width: number | null;
  height: number | null;
  caption: string;
};

export const SHOWCASE_BLOCK_KINDS = ['photos', 'points', 'catalog', 'specs', 'faq', 'text', 'realizations'] as const;
export type ShowcaseBlockKind = (typeof SHOWCASE_BLOCK_KINDS)[number];

export const SHOWCASE_KIND_LABELS: Record<ShowcaseBlockKind, string> = {
  photos: 'Zdjęcia',
  points: 'Punkty',
  catalog: 'Z katalogu produktów',
  specs: 'Specyfikacja',
  faq: 'Pytania klientów',
  text: 'Tekst',
  realizations: 'Realizacje',
};

/** Warianty bloku: klucz, opis w edytorze, domyślny tytuł. Pierwszy — domyślny. */
export const SHOWCASE_BLOCK_STYLES: Record<ShowcaseBlockKind, ReadonlyArray<{ key: string; label: string; title: string }>> = {
  photos: [
    { key: 'large', label: 'Duże zdjęcia — jak to wygląda', title: 'Jak to wygląda' },
    { key: 'grid', label: 'Siatka — galeria', title: 'Galeria' },
  ],
  points: [
    { key: 'benefits', label: 'Kafelki — korzyści', title: 'Korzyści' },
    { key: 'steps', label: 'Kroki z numerami — przygotowanie', title: 'Jak przygotowujemy' },
    { key: 'checklist', label: 'Lista z ✓ — co obejmuje', title: 'Co obejmuje' },
  ],
  catalog: [
    { key: 'variants', label: 'Warianty i ceny', title: 'Warianty' },
    { key: 'benefits', label: 'Korzyści z karty produktu', title: 'Korzyści' },
    { key: 'preparation', label: 'Przygotowanie i wymagania', title: 'Przygotowanie i wymagania' },
    { key: 'packages', label: 'Pakiety sprzedażowe', title: 'Pakiety' },
  ],
  specs: [{ key: '', label: 'Tabela: parametr — wartość', title: 'Specyfikacja' }],
  faq: [{ key: '', label: 'Pytanie — odpowiedź', title: 'Pytania klientów' }],
  text: [{ key: '', label: 'Akapity tekstu', title: 'Opis' }],
  realizations: [{ key: '', label: 'Realizacje ze strony www', title: 'Nasze realizacje' }],
};

/** Wiersz bloku: punkt (tytuł + opis), parametr (nazwa + wartość) albo pytanie (pytanie + odpowiedź). */
export type ShowcaseRow = { id: string; title: string; text: string };

export type ShowcaseBlock = {
  id: string;
  kind: ShowcaseBlockKind;
  title: string;
  /** Ukryty blok zostaje w karcie, ale nie pokazuje się na spotkaniu. */
  hidden: boolean;
  /** Wariant (`SHOWCASE_BLOCK_STYLES`). */
  style: string;
  /** Blok „Z katalogu produktów” — produkt (`offer_products.id`). */
  productId: string | null;
  /** Treść bloku „Tekst”; w pozostałych — krótkie wprowadzenie pod tytułem. */
  text: string;
  photos: ShowcaseMedia[];
  rows: ShowcaseRow[];
  /** Blok „Realizacje” — realizacje ze strony (`portfolio_projects.id`). */
  refs: string[];
};

export type ShowcaseContent = {
  /** Wstęp — 1–3 zdania na ekranie startowym karty. */
  lead: string;
  hero: ShowcaseMedia | null;
  blocks: ShowcaseBlock[];
};

// Widoki z serwera (`/bridge/native/v1/showcase`) -------------------------------------------------------------------------

export type ShowcaseAccess = { view: boolean; manage: boolean };
export type ShowcaseFont = { family: string; url: string | null };
/** Marka z księgi znaku domyślnej firmy (logo, sygnet, kolory i fonty według ról). */
export type ShowcaseBrand = {
  name: string;
  logoUrl: string | null;
  sygnetUrl: string | null;
  accent: string;
  surface: string;
  headingFont: ShowcaseFont | null;
  bodyFont: ShowcaseFont | null;
};
export type ShowcaseUrls = Record<string, { url: string | null; thumb: string | null }>;

export type ShowcaseSectionView = {
  id: string;
  title: string;
  subtitle: string;
  icon: ShowcaseIcon;
  cover: ShowcaseMedia | null;
  isActive: boolean;
  sortOrder: number;
  version: number;
  itemCount: number;
};

export type ShowcaseItemSummary = {
  id: string;
  sectionId: string;
  title: string;
  tagline: string;
  isActive: boolean;
  sortOrder: number;
  version: number;
  /** Klucz zdjęcia na liście (`showcaseMediaKey`) — adres w `urls`. */
  thumbKey: string | null;
  productNames: string[];
  blockCount: number;
  problems: number;
  updatedAt: string;
};

export type ShowcaseHome = {
  access: ShowcaseAccess;
  sections: ShowcaseSectionView[];
  items: ShowcaseItemSummary[];
  urls: ShowcaseUrls;
  brand: ShowcaseBrand;
};

export type ShowcasePoint = { title: string; text: string };
export type ShowcaseProductVariant = {
  id: string;
  name: string;
  shortDescription: string;
  description: string;
  benefits: string[];
  image: ShowcaseMedia | null;
  priceNet: number | null;
  priceGross: number | null;
  recommended: boolean;
};
export type ShowcaseProductPackage = {
  id: string;
  name: string;
  description: string;
  scope: string;
  bonus: string;
  image: ShowcaseMedia | null;
  priceNet: number | null;
  priceOnRequest: boolean;
  highlighted: boolean;
};
/** Ustalenia z obiektem przed wydarzeniem (z przygotowania produktu: „potwierdzenie z obiektem”, X dni wcześniej). */
export type ShowcasePreparationStep = { title: string; details: string; leadDays: number | null };

/** Produkt katalogu na bieżąco (Oferty → Produkty). */
export type ShowcaseProductView = {
  id: string;
  name: string;
  category: string;
  isActive: boolean;
  /**
   * Produkt z konfiguratorem (scena, ekran LED) — do oferty ze spotkania przez konfigurator (aplikacja na tablecie i telefonie,
   * `showcaseOfferConfiguredLine`); w CRM i na Macu — w edytorze oferty po jej utworzeniu.
   */
  configurable: boolean;
  shortDescription: string;
  description: string;
  image: ShowcaseMedia | null;
  unit: string;
  priceNet: number | null;
  priceGross: number | null;
  vatRate: number | null;
  benefits: ShowcasePoint[];
  variants: ShowcaseProductVariant[];
  packages: ShowcaseProductPackage[];
  /** Co zapewnia klient / obiekt (wymagania z karty produktu). */
  requirements: ShowcasePoint[];
  preparation: ShowcasePreparationStep[];
  setupHours: number | null;
  teardownHours: number | null;
};

export type ShowcaseRealizationView = {
  id: string;
  title: string;
  location: string;
  date: string | null;
  category: string;
  description: string;
  photos: ShowcaseMedia[];
  siteUrl: string | null;
};

export type ShowcaseItemDetail = {
  item: {
    id: string;
    sectionId: string;
    title: string;
    tagline: string;
    isActive: boolean;
    productIds: string[];
    content: ShowcaseContent;
    version: number;
    createdAt: string;
    createdByName: string | null;
    updatedAt: string;
    updatedByName: string | null;
  };
  products: ShowcaseProductView[];
  realizations: ShowcaseRealizationView[];
  urls: ShowcaseUrls;
};

/** Zdjęcie do wyboru (okno wyboru: baza zdjęć — Materiały i albumy, produkty, realizacje, biblioteka social media). */
export type ShowcasePickPhoto = {
  /** `material` / `social` — identyfikator pliku; `product` / `site` — gotowe zdjęcie (bez kopiowania). */
  id: string;
  name: string;
  thumbnailUrl: string | null;
  /** Pełne zdjęcie (podgląd w oknie wyboru), gdy serwer je zna. */
  url?: string | null;
  width: number | null;
  height: number | null;
  media: ShowcaseMedia | null;
};

/** Album bazy zdjęć (Materiały → Albumy) w oknie wyboru zdjęć. */
export type ShowcaseAlbumOption = {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  count: number;
  thumbnailUrl: string | null;
};

/** Gdzie trafiają zdjęcia z dysku (baza zdjęć: Materiały → marka → Zdjęcia). `null` — brak uprawnień do Materiałów. */
export type ShowcasePhotoBase = { companyId: string; companyName: string; folderId: string | null; folderName: string } | null;

// Normalizacja -----------------------------------------------------------------------------------------------------------

type Raw = Record<string, unknown>;
const object = (value: unknown): Raw => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
export const isShowcaseUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** Tekst jednowierszowy: bez znaków sterujących i podwójnych spacji, przycięty do limitu. */
export function showcaseLine(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit).trim();
}

/** Tekst wielowierszowy: akapity zachowane (najwyżej jedna pusta linia), bez znaków sterujących. */
export function showcaseText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
    .split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, limit)
    .trim();
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;
/** Identyfikator bloku, wiersza albo zdjęcia (losowy, gdy go brak). */
export function showcaseId(): string {
  const random = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.();
  if (random) return random.replace(/-/g, '').slice(0, 20);
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
const keepId = (value: unknown, used: Set<string>) => {
  let id = typeof value === 'string' && ID.test(value) ? value : showcaseId();
  while (used.has(id)) id = showcaseId();
  used.add(id);
  return id;
};

const UPLOAD_PATH = /^(items|sections)\/[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}\/[A-Za-z0-9._-]{1,100}$/;
const MATERIAL_PATH = /^materials\/([\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})\/v\d{1,9}(?:-t)?\.webp$/;
const PRODUCT_PATH = /^[A-Za-z0-9][A-Za-z0-9/_.() -]{0,299}$/;
const SITE_URL = /^https:\/\/[^\s"'<>\\]+\/storage\/v1\/object\/public\/[^\s"'<>\\]+$/;
const dimension = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number < 100000 ? Math.round(number) : null;
};

/** Poprawna ścieżka zdjęcia dla źródła (ochrona przed dowolnymi ścieżkami i adresami). */
export function isShowcaseMediaPath(source: ShowcaseMediaSource, path: string): boolean {
  if (!path || path.length > SHOWCASE_LIMITS.mediaPath || path.includes('..')) return false;
  if (source === 'upload') return UPLOAD_PATH.test(path);
  if (source === 'material') return MATERIAL_PATH.test(path);
  if (source === 'product') return PRODUCT_PATH.test(path) && !path.startsWith('/') && !/^[a-z]+:/i.test(path);
  return SITE_URL.test(path);
}

export function normalizeShowcaseMedia(raw: unknown, used: Set<string> = new Set()): ShowcaseMedia | null {
  const value = object(raw);
  const source = value.source === 'upload' || value.source === 'product' || value.source === 'site' || value.source === 'material' ? value.source : null;
  const path = typeof value.path === 'string' ? value.path.trim() : '';
  if (!source || !isShowcaseMediaPath(source, path)) return null;
  const thumbRaw = typeof value.thumb === 'string' ? value.thumb.trim() : '';
  const thumb = thumbRaw && source !== 'product' && isShowcaseMediaPath(source, thumbRaw) ? thumbRaw : null;
  return {
    id: keepId(value.id, used),
    source,
    path,
    thumb,
    width: dimension(value.width),
    height: dimension(value.height),
    caption: showcaseLine(value.caption, SHOWCASE_LIMITS.caption),
  };
}

/** Plik Materiałów, z którego pochodzi zdjęcie (`material`), albo `null`. */
export function showcaseMaterialFileId(media: Pick<ShowcaseMedia, 'source' | 'path'> | null | undefined): string | null {
  if (!media || media.source !== 'material') return null;
  return MATERIAL_PATH.exec(media.path)?.[1] || null;
}

/** Ścieżki wersji WebP zdjęcia z Materiałów (wspólne dla wszystkich kart): pełna i miniatura. */
export const showcaseMaterialPaths = (fileId: string, contentVersion: number) => ({
  path: `materials/${fileId.toLowerCase()}/v${Math.max(1, Math.round(contentVersion))}.webp`,
  thumb: `materials/${fileId.toLowerCase()}/v${Math.max(1, Math.round(contentVersion))}-t.webp`,
});

/** Stały klucz zdjęcia (adres w `urls`, nazwa w kopii na dysku) — źródło i ścieżka, nie losowy identyfikator. */
export const showcaseMediaKey = (media: Pick<ShowcaseMedia, 'source' | 'path'>) => `${media.source}:${media.path}`;

export function isShowcaseBlockKind(value: unknown): value is ShowcaseBlockKind {
  return typeof value === 'string' && (SHOWCASE_BLOCK_KINDS as readonly string[]).includes(value);
}

export function showcaseStyleOf(kind: ShowcaseBlockKind, style: unknown): string {
  const styles = SHOWCASE_BLOCK_STYLES[kind];
  return styles.some((item) => item.key === style) ? String(style) : styles[0].key;
}

export const showcaseDefaultTitle = (kind: ShowcaseBlockKind, style: string) =>
  (SHOWCASE_BLOCK_STYLES[kind].find((item) => item.key === style) || SHOWCASE_BLOCK_STYLES[kind][0]).title;

/** Nowy pusty blok z domyślnym tytułem wariantu. */
export function emptyShowcaseBlock(kind: ShowcaseBlockKind, style?: string, productId: string | null = null): ShowcaseBlock {
  const resolved = showcaseStyleOf(kind, style);
  return {
    id: showcaseId(),
    kind,
    title: showcaseDefaultTitle(kind, resolved),
    hidden: false,
    style: resolved,
    productId: kind === 'catalog' && isShowcaseUuid(productId) ? productId.toLowerCase() : null,
    text: '',
    photos: [],
    rows: [],
    refs: [],
  };
}

/** Treść nowej karty: szkielet pokazu do uzupełnienia (puste bloki nie pokazują się na spotkaniu). */
export function defaultShowcaseContent(): ShowcaseContent {
  return {
    lead: '',
    hero: null,
    blocks: [
      emptyShowcaseBlock('photos', 'large'),
      emptyShowcaseBlock('points', 'benefits'),
      emptyShowcaseBlock('photos', 'grid'),
      emptyShowcaseBlock('points', 'steps'),
      emptyShowcaseBlock('faq'),
    ],
  };
}

function normalizeRows(raw: unknown, used: Set<string>): ShowcaseRow[] {
  return list(raw).slice(0, SHOWCASE_LIMITS.rows * 2).map((item) => {
    const row = object(item);
    return { id: row.id, title: showcaseLine(row.title, SHOWCASE_LIMITS.rowTitle), text: showcaseText(row.text, SHOWCASE_LIMITS.rowText) };
  }).filter((row) => row.title || row.text).slice(0, SHOWCASE_LIMITS.rows).map((row) => ({ ...row, id: keepId(row.id, used) }));
}

export function normalizeShowcaseBlock(raw: unknown, used: Set<string> = new Set(), budget = { photos: SHOWCASE_LIMITS.photosTotal }): ShowcaseBlock | null {
  const value = object(raw);
  if (!isShowcaseBlockKind(value.kind)) return null;
  const kind = value.kind;
  const style = showcaseStyleOf(kind, value.style);
  const photos: ShowcaseMedia[] = [];
  if (kind === 'photos') {
    for (const item of list(value.photos)) {
      if (photos.length >= SHOWCASE_LIMITS.photos || budget.photos <= 0) break;
      const media = normalizeShowcaseMedia(item, used);
      if (media && !photos.some((photo) => showcaseMediaKey(photo) === showcaseMediaKey(media))) {
        photos.push(media);
        budget.photos -= 1;
      }
    }
  }
  const refs = kind === 'realizations'
    ? Array.from(new Set(list(value.refs).filter(isShowcaseUuid).map((id) => id.toLowerCase()))).slice(0, SHOWCASE_LIMITS.refs)
    : [];
  return {
    id: keepId(value.id, used),
    kind,
    title: showcaseLine(value.title, SHOWCASE_LIMITS.blockTitle) || showcaseDefaultTitle(kind, style),
    hidden: value.hidden === true,
    style,
    productId: kind === 'catalog' && isShowcaseUuid(value.productId) ? value.productId.toLowerCase() : null,
    text: kind === 'text' ? showcaseText(value.text, SHOWCASE_LIMITS.blockText) : showcaseText(value.text, 600),
    photos,
    rows: kind === 'points' || kind === 'specs' || kind === 'faq' ? normalizeRows(value.rows, used) : [],
    refs,
  };
}

export function normalizeShowcaseContent(raw: unknown): ShowcaseContent {
  const value = object(raw);
  const used = new Set<string>();
  const budget = { photos: SHOWCASE_LIMITS.photosTotal };
  const hero = normalizeShowcaseMedia(value.hero, used);
  const blocks: ShowcaseBlock[] = [];
  for (const item of list(value.blocks)) {
    if (blocks.length >= SHOWCASE_LIMITS.blocks) break;
    const block = normalizeShowcaseBlock(item, used, budget);
    if (block) blocks.push(block);
  }
  return { lead: showcaseText(value.lead, SHOWCASE_LIMITS.lead), hero, blocks };
}

/** Produkty karty: identyfikatory bez powtórzeń, w podanej kolejności. */
export function normalizeShowcaseProductIds(raw: unknown): string[] {
  return Array.from(new Set(list(raw).filter(isShowcaseUuid).map((id) => id.toLowerCase()))).slice(0, SHOWCASE_LIMITS.products);
}

/** Wszystkie zdjęcia karty (zdjęcie główne i bloki zdjęć). */
export function showcaseContentMedia(content: ShowcaseContent): ShowcaseMedia[] {
  return [...(content.hero ? [content.hero] : []), ...content.blocks.flatMap((block) => block.photos)];
}

/** Produkty potrzebne do pokazu karty: produkty karty i bloków z katalogu. */
export function showcaseContentProductIds(productIds: string[], content: ShowcaseContent): string[] {
  return Array.from(new Set([...productIds, ...content.blocks.map((block) => block.productId).filter((id): id is string => Boolean(id))]));
}

export const showcaseContentRealizationIds = (content: ShowcaseContent) =>
  Array.from(new Set(content.blocks.flatMap((block) => (block.kind === 'realizations' ? block.refs : []))));

/** Czy produkt ma treść dla wariantu bloku katalogu. */
export function showcaseCatalogHasContent(product: ShowcaseProductView | null | undefined, style: string): boolean {
  if (!product) return false;
  switch (style) {
    case 'variants': return product.variants.length > 0;
    case 'benefits': return product.benefits.length > 0 || product.variants.some((variant) => variant.benefits.length > 0);
    case 'preparation': return product.requirements.length > 0 || product.preparation.length > 0 || product.setupHours != null || product.teardownHours != null;
    case 'packages': return product.packages.length > 0;
    default: return false;
  }
}

/** Blok bez treści (nie pokazuje się na spotkaniu). `products` — produkty z serwera (bloki katalogu). */
export function showcaseBlockIsEmpty(block: ShowcaseBlock, products?: ShowcaseProductView[]): boolean {
  switch (block.kind) {
    case 'photos': return block.photos.length === 0;
    case 'points':
    case 'specs':
    case 'faq': return block.rows.length === 0;
    case 'text': return !block.text;
    case 'realizations': return block.refs.length === 0;
    case 'catalog':
      if (!block.productId) return true;
      return products ? !showcaseCatalogHasContent(products.find((product) => product.id === block.productId), block.style) : false;
    default: return true;
  }
}

/** Bloki widoczne na spotkaniu (bez ukrytych i pustych). */
export const showcaseVisibleBlocks = (content: ShowcaseContent, products?: ShowcaseProductView[]) =>
  content.blocks.filter((block) => !block.hidden && !showcaseBlockIsEmpty(block, products));

export type ShowcaseCheck = { key: string; label: string; ok: boolean; hint: string; blockId?: string };

/** Lista kontrolna karty (edytor). */
export function showcaseChecklist(input: { title: string; productIds: string[]; content: ShowcaseContent }, products?: ShowcaseProductView[]): ShowcaseCheck[] {
  const { content } = input;
  const checks: ShowcaseCheck[] = [
    { key: 'title', label: 'Tytuł', ok: Boolean(showcaseLine(input.title, SHOWCASE_LIMITS.title)), hint: 'Krótka nazwa, którą klient od razu zrozumie.' },
    { key: 'hero', label: 'Zdjęcie główne', ok: Boolean(content.hero), hint: 'Duże zdjęcie na ekranie startowym karty.' },
    { key: 'lead', label: 'Wstęp', ok: content.lead.length >= 25, hint: '1–3 zdania: co klient dostaje i dlaczego warto.' },
    { key: 'products', label: 'Produkty z katalogu', ok: input.productIds.length > 0, hint: 'Warianty, ceny i przygotowanie zaciągną się z Oferty → Produkty.' },
    {
      key: 'photos', label: 'Zdjęcia', ok: showcaseContentMedia(content).length >= 4,
      hint: `Co najmniej 4 zdjęcia — „Jak to wygląda” i galeria (teraz ${showcaseContentMedia(content).length}).`,
    },
  ];
  for (const block of content.blocks) {
    if (block.hidden) continue;
    if (block.kind === 'catalog' && !block.productId) {
      checks.push({ key: `block-${block.id}`, label: `Blok „${block.title}”`, ok: false, hint: 'Wybierz produkt z katalogu.', blockId: block.id });
    } else if (showcaseBlockIsEmpty(block, products)) {
      checks.push({
        key: `block-${block.id}`, label: `Blok „${block.title}”`, ok: false,
        hint: block.kind === 'catalog' ? 'Produkt nie ma tej treści w katalogu — blok się nie pokaże.' : 'Pusty — nie pokaże się na spotkaniu.',
        blockId: block.id,
      });
    }
  }
  return checks;
}

export const showcaseProblemCount = (input: { title: string; productIds: string[]; content: ShowcaseContent }, products?: ShowcaseProductView[]) =>
  showcaseChecklist(input, products).filter((check) => !check.ok).length;

/** Cena do pokazu: „1 200 zł netto” (bez groszy, gdy pełne złote). */
export function formatShowcasePrice(value: number | null | undefined, kind: 'netto' | 'brutto' = 'netto'): string {
  if (value == null || !Number.isFinite(value)) return '';
  const whole = Math.abs(value - Math.round(value)) < 0.005;
  const formatted = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(value);
  return `${formatted} zł ${kind}`;
}

// Oferta ze spotkania ----------------------------------------------------------------------------------------------------
// Klient ogląda pokaz i mówi „chcę ofertę”: sprzedawca dodaje warianty i pakiety („Do oferty”), wybiera klienta i od razu
// tworzy ofertę (zapytanie + oferta jako wariant zapytania, PDF, wysyłka). Szkic (koszyk i formularz) zostaje na urządzeniu;
// ceny, rabat i akceptację liczy serwer (`src/lib/showcase/showcaseOffer.server.ts`).

export const SHOWCASE_OFFER_LIMITS = {
  lines: 30,
  quantity: 9999,
  days: 30,
  note: 2000,
  search: 80,
  /** Ważność oferty (dni) — jak nowa oferta zapytania w CRM. */
  validDays: 14,
  /** Największa konfiguracja produktu (scena, ekran LED) w szkicu — znaki JSON. */
  configuration: 300_000,
} as const;

/** Wybór z pokazu: produkt (domyślny wybór jak w CRM), wariant, pakiet albo produkt z konfiguratora (scena, ekran LED). */
export type ShowcaseOfferKind = 'product' | 'variant' | 'package' | 'configured';
const SHOWCASE_OFFER_KINDS: readonly ShowcaseOfferKind[] = ['product', 'variant', 'package', 'configured'];

export type ShowcaseOfferLine = {
  /** `produkt:rodzaj:opcja` — ta sama pozycja nie dodaje się dwa razy. */
  key: string;
  productId: string;
  kind: ShowcaseOfferKind;
  optionId: string | null;
  /** Nazwa do koszyka (nazwę w ofercie ustala serwer z katalogu). */
  label: string;
  quantity: number;
  days: number;
  /** Pakiet „wycena indywidualna” — cenę uzgadnia sprzedawca. */
  priceOnRequest: boolean;
  agreedPrice: number | null;
  /** Rabat tej pozycji w procentach (0–100) — jak rabat pozycji w kreatorze ofert; rabat całej oferty liczy się po nim. */
  discountPercent: number;
  /** Karta pokazu, z której dodano pozycję. */
  itemId: string | null;
  itemTitle: string;
  /**
   * Konfiguracja produktu z konfiguratora (`configured`; scena, ekran LED) — jak w kreatorze ofert (`op=modular`). Serwer
   * przy wycenie pobiera aktualny sprzęt i stawki z magazynu, więc cena zawsze jest bieżąca.
   */
  modular: Record<string, unknown> | null;
};

export type ShowcaseOfferClient = {
  /** Klient z CRM (organizacja i / albo osoba). */
  organizationId: string | null;
  organizationName: string;
  contactId: string | null;
  contactName: string;
  /** Nowy klient albo nowa osoba kontaktowa w wybranej firmie. */
  company: string;
  nip: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /**
   * Klient roboczy — sama nazwa (np. „Firma z targów”), bez dodawania do bazy klientów. Oferta i zapytanie powstają bez
   * klienta, a klienta przypisuje się później w CRM. Używana tylko bez klienta z CRM i bez nowego klienta.
   */
  placeholder: string;
};

/** `locationId` — miejsce wybrane z bazy lokalizacji (CRM → Lokalizacje); `null` — wpisane ręcznie. */
export type ShowcaseOfferEvent = { name: string; date: string; location: string; locationId: string | null; guestCount: number | null };

/** Podpowiedź miejsca z bazy lokalizacji. `label` — „Nazwa, miasto” (jak w zapytaniach CRM). */
export type ShowcaseOfferLocation = { id: string; name: string; city: string; address: string; label: string };

/**
 * Jak klient widzi rabat w PDF oferty (`offers.discount_display`) — wybór sprzedawcy, zapamiętany w jego ustawieniach
 * (`employees.preferences.offerWizard.discountDisplay`). Rabaty pozycji i rabat całej oferty działają zawsze i razem; zmienia się
 * tylko prezentacja: `lines` — rabat przy pozycjach i w podsumowaniu, `total` — jeden rabat łączny pod tabelą (pozycje w cenach
 * przed rabatem), `none` — tylko ceny po rabacie (bez kwot rabatu).
 */
export type ShowcaseOfferDiscountDisplay = 'lines' | 'total' | 'none';
export const SHOWCASE_OFFER_DISCOUNT_DISPLAYS: ReadonlyArray<{ key: ShowcaseOfferDiscountDisplay; label: string; hint: string }> = [
  { key: 'lines', label: 'Przy pozycjach', hint: 'Klient widzi rabat każdej pozycji i rabat na ofertę.' },
  { key: 'total', label: 'Rabat łączny', hint: 'Pozycje w cenach przed rabatem, pod tabelą jeden rabat łączny.' },
  { key: 'none', label: 'Ceny po rabacie', hint: 'Klient widzi tylko ceny po rabacie — bez kwoty rabatu.' },
];
export const isShowcaseOfferDiscountDisplay = (value: unknown): value is ShowcaseOfferDiscountDisplay =>
  value === 'lines' || value === 'total' || value === 'none';

export type ShowcaseOfferDraft = {
  /** Identyfikator przyszłej oferty — ponowne „Utwórz ofertę” po zerwanym połączeniu nie tworzy drugiej. */
  id: string;
  lines: ShowcaseOfferLine[];
  /** Rabat całej oferty — liczy się od wartości pozycji po ich rabatach. */
  discountPercent: number;
  /** Jak klient widzi rabat w PDF. */
  discountDisplay: ShowcaseOfferDiscountDisplay;
  client: ShowcaseOfferClient;
  /** Otwarte zapytanie klienta (oferta jako kolejny wariant) albo `null` — nowe zapytanie. */
  inquiryId: string | null;
  inquiryTitle: string;
  event: ShowcaseOfferEvent;
  note: string;
  updatedAt: string;
};

export type ShowcaseOfferSetup = {
  canOffer: boolean;
  /** Dlaczego nie można tworzyć ofert z pokazu (gdy `canOffer` = false). */
  reason: string;
  /** Akceptuje rabaty (administrator, finanse) — progi go nie zatrzymują. */
  canApprove: boolean;
  guardrails: { enabled: boolean; maxDiscountPercent: number; minMarginPercent: number };
  validDays: number;
  /** Zapamiętany sposób pokazania rabatu w PDF — dla nowego szkicu (zmiana: `op=offerDiscountDisplay`). */
  discountDisplay: ShowcaseOfferDiscountDisplay;
};

export type ShowcaseOfferClientHit = {
  kind: 'organization' | 'contact';
  id: string;
  name: string;
  detail: string;
  organizationId: string | null;
  organizationName: string;
  email: string;
  phone: string;
};
export type ShowcaseOfferPerson = { id: string; name: string; email: string; phone: string };
export type ShowcaseOfferInquiry = {
  id: string;
  title: string;
  stage: string;
  stageLabel: string;
  /** Termin z zapytania (`YYYY-MM-DD` albo `YYYY-MM-DDTHH:MM`). */
  date: string | null;
  location: string;
  guestCount: number | null;
  updatedAt: string;
};
export type ShowcaseOfferClientContext = { persons: ShowcaseOfferPerson[]; inquiries: ShowcaseOfferInquiry[] };

export type ShowcaseOfferPreviewLine = {
  key: string;
  name: string;
  unit: string;
  quantity: number;
  days: number;
  unitPrice: number;
  /** Wartość netto po rabacie pozycji. */
  subtotal: number;
  /** Wartość netto przed rabatem pozycji i ten rabat (%). */
  listSubtotal: number;
  discountPercent: number;
  /** Ilość z liczby osób albo stołów (bez ręcznej zmiany). */
  quantityFromAudience: boolean;
  error: string | null;
  /** Miniatura zdjęcia produktu z katalogu (podpisany adres na godzinę). */
  thumbnailUrl: string | null;
};
export type ShowcaseOfferPreview = {
  lines: ShowcaseOfferPreviewLine[];
  /** Wartość pozycji netto po ich rabatach (podstawa rabatu całej oferty). */
  listNet: number;
  /** Rabat całej oferty. */
  discountPercent: number;
  discountAmount: number;
  /** Suma rabatów pozycji i rabat łączny (pozycje + cała oferta, wobec wartości przed rabatami) — ten liczy się do progu akceptacji. */
  lineDiscountAmount: number;
  effectiveDiscountPercent: number;
  net: number;
  taxPercent: number;
  tax: number;
  gross: number;
  /** Pierwszy problem, który blokuje utworzenie oferty. */
  problem: string | null;
};

export type ShowcaseOfferApproval = { required: boolean; canSend: boolean; status: string | null; reasons: string[]; canApprove: boolean };

export type ShowcaseOfferResult = {
  offerId: string;
  number: string;
  inquiryId: string;
  inquiryCreated: boolean;
  clientName: string;
  clientEmail: string;
  /** Oferta bez klienta w bazie (klient roboczy) — klienta przypisuje się w CRM. */
  clientPlaceholder: boolean;
  net: number;
  gross: number;
  approval: ShowcaseOfferApproval;
};

export type ShowcaseOfferStatus = { offerId: string; number: string; status: string; pdfReady: boolean; approval: ShowcaseOfferApproval };

export type ShowcaseOfferEmailSetup = {
  number: string;
  accounts: Array<{ id: string; label: string }>;
  to: string;
  recipientName: string;
  subject: string;
  text: string;
  pdfReady: boolean;
};

/** Losowy identyfikator UUID v4 (także bez `crypto.randomUUID`, np. w aplikacji mobilnej). */
export function showcaseOfferDraftId(): string {
  const random = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.();
  if (random && UUID.test(random)) return random.toLowerCase();
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export const showcaseOfferLineKey = (productId: string, kind: ShowcaseOfferKind, optionId: string | null) => `${productId}:${kind}:${optionId || ''}`;

export const emptyShowcaseOfferClient = (): ShowcaseOfferClient => ({
  organizationId: null, organizationName: '', contactId: null, contactName: '', company: '', nip: '', firstName: '', lastName: '', email: '', phone: '',
  placeholder: '',
});

/** Klient roboczy (sama nazwa, bez bazy) — bez klienta z CRM i bez nowego klienta. */
export const isShowcaseOfferPlaceholder = (client: ShowcaseOfferClient) =>
  Boolean(client.placeholder && !client.organizationId && !client.contactId && !client.company && !client.firstName && !client.lastName);

export function emptyShowcaseOfferDraft(discountDisplay: ShowcaseOfferDiscountDisplay = 'lines'): ShowcaseOfferDraft {
  return {
    id: showcaseOfferDraftId(),
    lines: [],
    discountPercent: 0,
    discountDisplay,
    client: emptyShowcaseOfferClient(),
    inquiryId: null,
    inquiryTitle: '',
    event: { name: '', date: '', location: '', locationId: null, guestCount: null },
    note: '',
    updatedAt: '',
  };
}

const wholeIn = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

/** Rabat (cała oferta albo pozycja) w procentach (0–100, dwa miejsca po przecinku). */
export function showcaseOfferDiscount(value: unknown): number {
  const number = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number * 100) / 100)) : 0;
}

/** Uzgodniona cena netto (pakiet „wycena indywidualna”): liczba dodatnia z groszami albo `null`. */
export function showcaseOfferPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'string' ? Number(value.replace(/\s/g, '').replace(',', '.')) : Number(value);
  return Number.isFinite(number) && number > 0 && number <= 99999999 ? Math.round(number * 100) / 100 : null;
}

/** Konfiguracja z konfiguratora (profil, katalog, wybór) w limicie rozmiaru; pełne sprawdzenie robi serwer. */
function showcaseOfferModular(value: unknown): Record<string, unknown> | null {
  const raw = object(value);
  if (typeof raw.profile !== 'string' || !Object.keys(object(raw.catalog)).length || !Object.keys(object(raw.selection)).length) return null;
  try {
    return JSON.stringify(raw).length <= SHOWCASE_OFFER_LIMITS.configuration ? raw : null;
  } catch {
    return null;
  }
}

export function normalizeShowcaseOfferLine(raw: unknown): ShowcaseOfferLine | null {
  const value = object(raw);
  if (!isShowcaseUuid(value.productId)) return null;
  const productId = value.productId.toLowerCase();
  const kind = SHOWCASE_OFFER_KINDS.includes(value.kind as ShowcaseOfferKind) ? (value.kind as ShowcaseOfferKind) : 'product';
  const option = showcaseLine(value.optionId, 80);
  const optionId = kind === 'product' ? null : kind === 'variant' ? (isShowcaseUuid(option) ? option.toLowerCase() : null) : option || null;
  if (kind !== 'product' && !optionId) return null;
  const modular = kind === 'configured' ? showcaseOfferModular(value.modular) : null;
  if (kind === 'configured' && !modular) return null;
  const priceOnRequest = kind === 'package' && value.priceOnRequest === true;
  return {
    key: showcaseOfferLineKey(productId, kind, optionId),
    productId,
    kind,
    optionId,
    label: showcaseLine(value.label, 240) || 'Pozycja',
    quantity: wholeIn(value.quantity, 1, SHOWCASE_OFFER_LIMITS.quantity, 1),
    days: wholeIn(value.days, 1, SHOWCASE_OFFER_LIMITS.days, 1),
    priceOnRequest,
    agreedPrice: priceOnRequest ? showcaseOfferPrice(value.agreedPrice) : null,
    discountPercent: showcaseOfferDiscount(value.discountPercent),
    itemId: isShowcaseUuid(value.itemId) ? value.itemId.toLowerCase() : null,
    itemTitle: showcaseLine(value.itemTitle, SHOWCASE_LIMITS.title),
    modular,
  };
}

const DATE_VALUE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

/** Szkic z urządzenia albo z żądania: tylko poprawne wartości, w limitach (pola formularza bez zmian znaczenia). */
export function normalizeShowcaseOfferDraft(raw: unknown): ShowcaseOfferDraft {
  const value = object(raw);
  const lines: ShowcaseOfferLine[] = [];
  for (const item of list(value.lines)) {
    if (lines.length >= SHOWCASE_OFFER_LIMITS.lines) break;
    const line = normalizeShowcaseOfferLine(item);
    if (line && !lines.some((entry) => entry.key === line.key)) lines.push(line);
  }
  const client = object(value.client);
  const event = object(value.event);
  const organizationId = isShowcaseUuid(client.organizationId) ? client.organizationId.toLowerCase() : null;
  const contactId = isShowcaseUuid(client.contactId) ? client.contactId.toLowerCase() : null;
  const guests = Number(event.guestCount);
  const date = typeof event.date === 'string' ? event.date.trim() : '';
  return {
    id: isShowcaseUuid(value.id) ? value.id.toLowerCase() : showcaseOfferDraftId(),
    lines,
    discountPercent: showcaseOfferDiscount(value.discountPercent),
    discountDisplay: isShowcaseOfferDiscountDisplay(value.discountDisplay) ? value.discountDisplay : 'lines',
    client: {
      organizationId,
      organizationName: showcaseLine(client.organizationName, 200),
      contactId,
      contactName: showcaseLine(client.contactName, 200),
      company: showcaseLine(client.company, 200),
      nip: typeof client.nip === 'string' ? client.nip.replace(/\D/g, '').slice(0, 20) : '',
      firstName: showcaseLine(client.firstName, 120),
      lastName: showcaseLine(client.lastName, 120),
      email: showcaseLine(client.email, 200).toLowerCase(),
      phone: showcaseLine(client.phone, 50),
      placeholder: organizationId || contactId ? '' : showcaseLine(client.placeholder, 200),
    },
    inquiryId: isShowcaseUuid(value.inquiryId) ? value.inquiryId.toLowerCase() : null,
    inquiryTitle: showcaseLine(value.inquiryTitle, 200),
    event: {
      name: showcaseLine(event.name, 160),
      date: DATE_VALUE.test(date) ? date : '',
      location: showcaseLine(event.location, 500),
      locationId: isShowcaseUuid(event.locationId) && showcaseLine(event.location, 500) ? event.locationId.toLowerCase() : null,
      guestCount: Number.isInteger(guests) && guests >= 1 && guests <= 100000 ? guests : null,
    },
    note: showcaseText(value.note, SHOWCASE_OFFER_LIMITS.note),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt.slice(0, 40) : '',
  };
}

/**
 * Pozycja z produktu karty. Bez wskazania wariantu lub pakietu — wybór domyślny jak przy dodawaniu produktu w CRM: pierwszy
 * pakiet, inaczej polecany (pierwszy) wariant, inaczej sam produkt. Produkt wycofany z katalogu nie trafia do oferty z pokazu,
 * produkt z konfiguratorem — tylko przez konfigurator (`showcaseOfferConfiguredLine`).
 */
export function showcaseOfferLineFor(
  product: ShowcaseProductView,
  choice: { kind: ShowcaseOfferKind; optionId?: string | null } | null,
  item: { id: string; title: string } | null,
): ShowcaseOfferLine | null {
  if (product.configurable || !product.isActive) return null;
  let kind: ShowcaseOfferKind = choice?.kind || 'product';
  let optionId = choice?.optionId || null;
  if (kind === 'product') {
    const firstPackage = product.packages[0];
    const variant = product.variants.find((entry) => entry.recommended) || product.variants[0];
    if (firstPackage) { kind = 'package'; optionId = firstPackage.id; } else if (variant) { kind = 'variant'; optionId = variant.id; }
  }
  const variant = kind === 'variant' ? product.variants.find((entry) => entry.id === optionId) : undefined;
  const pack = kind === 'package' ? product.packages.find((entry) => entry.id === optionId) : undefined;
  if ((kind === 'variant' && !variant) || (kind === 'package' && !pack)) return null;
  return normalizeShowcaseOfferLine({
    productId: product.id,
    kind,
    optionId,
    label: variant ? `${product.name} — ${variant.name}` : pack ? `${product.name} — ${pack.name}` : product.name,
    quantity: 1,
    days: 1,
    priceOnRequest: pack?.priceOnRequest === true,
    agreedPrice: null,
    discountPercent: 0,
    itemId: item?.id || null,
    itemTitle: item?.title || '',
  });
}

/**
 * Pozycja z konfiguratora (scena, ekran LED): konfiguracja z serwera (`op=offerConfigure`), nazwa — tytuł konfiguracji
 * („Ekran LED 4 × 2 m”). Każda konfiguracja to osobna pozycja (dwa różne ekrany w jednej ofercie).
 */
export function showcaseOfferConfiguredLine(
  product: { id: string; name: string },
  modular: Record<string, unknown>,
  title: string,
  item: { id: string; title: string } | null,
  optionId: string = showcaseOfferDraftId(),
): ShowcaseOfferLine | null {
  return normalizeShowcaseOfferLine({
    productId: product.id,
    kind: 'configured',
    optionId,
    label: title || product.name,
    quantity: 1,
    days: 1,
    modular,
    itemId: item?.id || null,
    itemTitle: item?.title || '',
  });
}

// Konfigurator w ofercie ze spotkania — widok z serwera (`modularConfigurator.ts`; pokaz bez stawek części i stanu magazynu).

export type ShowcaseConfigOption = { id: string; label: string };
export type ShowcaseConfigGroup = {
  key: string;
  /** `choice` — wybierz jeden wariant, `optional` — dodatek do włączenia, `automatic` — dobrany do wysokości, `required` — zależność. */
  kind: 'automatic' | 'choice' | 'optional' | 'required';
  label: string;
  placeholder: string;
  options: ShowcaseConfigOption[];
  selected: string;
  enabled: boolean;
  children: ShowcaseConfigNode[];
};
export type ShowcaseConfigNode = { id: string; path: string; name: string; detail: string; groups: ShowcaseConfigGroup[] };
export type ShowcaseConfigRoot = {
  id: string;
  title: string;
  optional: boolean;
  optionalLabel: string;
  enabled: boolean;
  quantityEditable: boolean;
  quantity: number | null;
  tree: ShowcaseConfigNode | null;
};
export type ShowcaseConfigNotice = { key: string; group: string; message: string; warning: boolean; recommendation?: { id: string; name: string } };
export type ShowcaseConfigPreset = { width: number; depth: number; label: string };
export type ShowcaseConfigView = {
  /** `warehouse_stage` | `stage` | `led` | `sound` | `microphones`. */
  profile: string;
  heading: string;
  title: string;
  scope: string[];
  error: string | null;
  loadError: string | null;
  /** Składniki zestawu (bez stawek). */
  lines: Array<{ key: string; name: string; quantity: string }>;
  calculatorTotal: number | null;
  totalText: string;
  note: string | null;
  roots: ShowcaseConfigRoot[];
  stage: null | {
    width: number | null; depth: number | null; height: number | null; skirt: string; showSkirt: boolean; presets: ShowcaseConfigPreset[];
    heightOptions: Array<{ height: number; label: string }>; heightMessage: string | null; summary: string;
  };
  led: null | {
    hasSections: boolean; canAdd: boolean;
    sections: Array<{ id: string; name: string; columns: number | null; rows: number | null; summary: string }>;
    totals: string | null; notices: ShowcaseConfigNotice[];
  };
  legacyStage: null | {
    width: number | null; depth: number | null; height: number | null; skirt: string; carpet: boolean; stairs: number | null;
    presets: ShowcaseConfigPreset[]; heights: number[]; heightMissing: boolean; accessories: Array<{ id: string; name: string; quantity: number | null }>;
  };
  components: null | Array<{ id: string; name: string; editable: boolean; quantity: number | null; text: string }>;
  area: number | null;
  areaEditable: boolean;
};
/** Zmiana w konfiguratorze (jak kontrolki w CRM): `size`, `height`, `choice`, `enabled`, `rootEnabled`, `sectionSet`… */
export type ShowcaseConfigEdit = { op: string; [field: string]: unknown };
export type ShowcaseOfferConfiguration = { snapshot: Record<string, unknown>; view: ShowcaseConfigView };

export type ShowcaseOfferAddResult = { draft: ShowcaseOfferDraft; result: 'added' | 'exists' | 'full' };

export function addShowcaseOfferLine(draft: ShowcaseOfferDraft, line: ShowcaseOfferLine, now = new Date().toISOString()): ShowcaseOfferAddResult {
  if (draft.lines.some((entry) => entry.key === line.key)) return { draft, result: 'exists' };
  if (draft.lines.length >= SHOWCASE_OFFER_LIMITS.lines) return { draft, result: 'full' };
  return { draft: { ...draft, lines: [...draft.lines, line], updatedAt: now }, result: 'added' };
}

export const showcaseOfferHasLine = (draft: ShowcaseOfferDraft, key: string) => draft.lines.some((entry) => entry.key === key);

/** Zakres do zapytania: „Fotobudka — Pakiet Premium; Ciężki dym × 2”. */
export function showcaseOfferScope(lines: ShowcaseOfferLine[]): string {
  return lines.map((line) => (line.quantity > 1 ? `${line.label} × ${line.quantity}` : line.label)).join('; ').slice(0, 4000);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isShowcaseOfferEmail = (value: string) => EMAIL.test(value.trim());

/** Sprawdzenie szkicu przed utworzeniem oferty (to samo w CRM, na Macu, w aplikacji i na serwerze). */
export function showcaseOfferProblem(draft: ShowcaseOfferDraft): string | null {
  if (!draft.lines.length) return 'Dodaj do oferty co najmniej jedną pozycję („Do oferty” przy wariancie albo pakiecie).';
  const unpriced = draft.lines.find((line) => line.priceOnRequest && !(line.agreedPrice && line.agreedPrice > 0));
  if (unpriced) return `Wpisz uzgodnioną cenę: ${unpriced.label}.`;
  const client = draft.client;
  if (!client.organizationId && !client.contactId && !client.company && !(client.firstName && client.lastName) && !isShowcaseOfferPlaceholder(client)) {
    return 'Wybierz klienta z CRM, wpisz firmę lub imię i nazwisko klienta albo nazwę roboczą (bez bazy).';
  }
  if (!client.contactId && (client.firstName || client.lastName) && !(client.firstName && client.lastName)) return 'Podaj imię i nazwisko osoby kontaktowej.';
  if (client.email && !isShowcaseOfferEmail(client.email)) return 'Podaj poprawny adres e-mail.';
  if (client.nip && client.nip.length !== 10) return 'NIP ma 10 cyfr.';
  return null;
}

/**
 * Podpowiedź przy rabacie: powyżej progu oferta czeka na akceptację przed wysłaniem (pokazać klientowi można od razu).
 * `discountPercent` — rabat łączny (pozycje i cała oferta; `ShowcaseOfferPreview.effectiveDiscountPercent`).
 */
export function showcaseOfferApprovalHint(setup: ShowcaseOfferSetup | null, discountPercent: number): string {
  if (!setup || setup.canApprove || !setup.guardrails.enabled) return '';
  const limit = setup.guardrails.maxDiscountPercent;
  return discountPercent > limit
    ? `Rabat powyżej ${formatShowcasePercent(limit)} — ofertę utworzysz i pokażesz klientowi od razu, a wyślesz po akceptacji rabatu.`
    : '';
}

/** „10%”, „12,5%”. */
export function formatShowcasePercent(value: number): string {
  return `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0)}%`;
}

/** Kwota w ofercie: „12 300,00 zł”. */
export function formatShowcaseAmount(value: number): string {
  return `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0)} zł`;
}

// Instrukcja „?” — przykładowa karta -------------------------------------------------------------------------------------------
// „Utwórz kartę z przykładu” (CRM, Mac): karta ukryta do czasu uzupełnienia, z treścią pokazującą, jak pisać treściwie —
// krótko, językiem korzyści klienta, z konkretami (wymiary, czasy, warunki). Zdjęcia dodaje sprzedawca z bazy zdjęć.

export type ShowcaseExampleBlock = { kind: ShowcaseBlockKind; style?: string; title?: string; text?: string; rows?: Array<{ title: string; text: string }> };
export type ShowcaseExample = { title: string; tagline: string; lead: string; blocks: ShowcaseExampleBlock[] };

export const SHOWCASE_EXAMPLE: ShowcaseExample = {
  title: 'Ciężki dym — pierwszy taniec w chmurach',
  tagline: 'Gęsta, nisko ścieląca się chmura, która nie unosi się i nie uruchamia czujek',
  lead: 'Para tańczy na chmurze, a goście robią najlepsze zdjęcia wieczoru. Efekt trwa 3–4 minuty, jest bezpieczny i nie zostawia śladów na parkiecie ani sukni.',
  blocks: [
    { kind: 'photos', style: 'large', text: 'Dodaj 2–3 duże zdjęcia z realizacji: para w chmurze, ujęcie z góry, goście z telefonami.' },
    {
      kind: 'points', style: 'benefits', rows: [
        { title: 'Zdjęcia, które goście udostępniają', text: 'Chmura do kolan daje efekt „tańca w niebie” — najczęściej publikowany moment wesela.' },
        { title: 'Bezpieczny dla sali i czujek', text: 'Suchy lód, bez dymu z wytwornicy — nie uruchamia czujek, nie zostawia wilgoci na parkiecie.' },
        { title: 'Gotowe w 15 minut', text: 'Technik przygotowuje urządzenie przed pierwszym tańcem, bez przerywania przyjęcia.' },
      ],
    },
    { kind: 'catalog', style: 'variants', title: 'Warianty' },
    {
      kind: 'points', style: 'steps', rows: [
        { title: 'Ustalamy moment', text: 'Z DJ-em lub zespołem wybieramy utwór i sygnał startu.' },
        { title: 'Przygotowujemy urządzenie', text: '15 minut przed tańcem, przy krawędzi parkietu — gniazdko 230 V w promieniu 10 m.' },
        { title: 'Efekt na sygnał', text: 'Chmura narasta w 30 sekund i utrzymuje się przez cały utwór.' },
      ],
    },
    {
      kind: 'specs', rows: [
        { title: 'Czas efektu', text: '3–4 minuty (jeden utwór)' },
        { title: 'Wysokość chmury', text: 'do 40 cm nad parkietem' },
        { title: 'Zasilanie', text: '230 V, gniazdko w promieniu 10 m' },
        { title: 'Przygotowanie', text: '15 minut przed efektem' },
      ],
    },
    {
      kind: 'faq', rows: [
        { title: 'Czy dym uruchomi czujki?', text: 'Nie — to para z suchego lodu, nie dym z wytwornicy. Dla pewności uzgadniamy to z obiektem.' },
        { title: 'Czy parkiet będzie śliski?', text: 'Nie. Chmura opada i znika po kilku minutach, nie zostawia wilgoci.' },
        { title: 'Czy da się to zrobić na zewnątrz?', text: 'Przy bezwietrznej pogodzie tak — wiatr rozwiewa chmurę, dlatego zalecamy salę lub namiot.' },
      ],
    },
    { kind: 'photos', style: 'grid', text: 'Galeria 6–12 zdjęć z różnych sal — klient zobaczy, jak efekt wygląda w podobnym miejscu.' },
  ],
};

/** Treść karty z przykładu (bloki w kolejności pokazu; bloki zdjęć i katalogu — do uzupełnienia). */
export function showcaseExampleContent(example: ShowcaseExample = SHOWCASE_EXAMPLE): ShowcaseContent {
  return normalizeShowcaseContent({
    lead: example.lead,
    hero: null,
    blocks: example.blocks.map((block) => ({
      ...emptyShowcaseBlock(block.kind, block.style),
      ...(block.title ? { title: block.title } : {}),
      text: block.text || '',
      rows: (block.rows || []).map((row) => ({ id: showcaseId(), title: row.title, text: row.text })),
    })),
  });
}

// Asystent AI treści karty ----------------------------------------------------------------------------------------------------

export const SHOWCASE_AI_FIELDS = ['tagline', 'lead', 'benefits', 'steps', 'specs', 'faq'] as const;
export type ShowcaseAiField = (typeof SHOWCASE_AI_FIELDS)[number];
export const SHOWCASE_AI_LABELS: Record<ShowcaseAiField, string> = {
  tagline: 'Hasło',
  lead: 'Wstęp',
  benefits: 'Korzyści',
  steps: 'Jak przygotowujemy',
  specs: 'Specyfikacja',
  faq: 'Pytania klientów',
};

/** Propozycje asystenta (tylko wybrane pola). */
export type ShowcaseAiSuggestion = {
  tagline?: string;
  lead?: string;
  benefits?: ShowcasePoint[];
  steps?: ShowcasePoint[];
  specs?: ShowcasePoint[];
  faq?: ShowcasePoint[];
  model: string;
};

/**
 * Wstawienie propozycji asystenta do treści karty: hasło i wstęp zastępują obecne, wiersze trafiają do pierwszego bloku
 * danego rodzaju (pusty — wypełniony, z treścią — zastąpiony), brakujący blok powstaje na końcu karty.
 */
export function applyShowcaseAiSuggestion(
  input: { tagline: string; content: ShowcaseContent },
  suggestion: ShowcaseAiSuggestion,
  fields: ShowcaseAiField[],
): { tagline: string; content: ShowcaseContent } {
  let tagline = input.tagline;
  const content: ShowcaseContent = { ...input.content, blocks: [...input.content.blocks] };
  if (fields.includes('tagline') && suggestion.tagline) tagline = showcaseLine(suggestion.tagline, SHOWCASE_LIMITS.tagline);
  if (fields.includes('lead') && suggestion.lead) content.lead = showcaseText(suggestion.lead, SHOWCASE_LIMITS.lead);
  const place = (kind: ShowcaseBlockKind, style: string, rows: ShowcasePoint[] | undefined) => {
    if (!rows?.length) return;
    const clean = rows.map((row) => ({ id: showcaseId(), title: showcaseLine(row.title, SHOWCASE_LIMITS.rowTitle), text: showcaseText(row.text, SHOWCASE_LIMITS.rowText) }))
      .filter((row) => row.title || row.text).slice(0, SHOWCASE_LIMITS.rows);
    if (!clean.length) return;
    const index = content.blocks.findIndex((block) => block.kind === kind && (kind !== 'points' || block.style === style));
    if (index >= 0) content.blocks[index] = { ...content.blocks[index], rows: clean };
    else if (content.blocks.length < SHOWCASE_LIMITS.blocks) content.blocks.push({ ...emptyShowcaseBlock(kind, style), rows: clean });
  };
  if (fields.includes('benefits')) place('points', 'benefits', suggestion.benefits);
  if (fields.includes('steps')) place('points', 'steps', suggestion.steps);
  if (fields.includes('specs')) place('specs', '', suggestion.specs);
  if (fields.includes('faq')) place('faq', '', suggestion.faq);
  return { tagline, content };
}

