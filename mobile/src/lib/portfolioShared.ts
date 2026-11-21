/*
 * Marketing → „Realizacje” (portfolio strony mavinci.pl) — wspólne dla CRM, serwera Next i aplikacji mobilnej
 * (kopia: mobile/src/lib/portfolioShared.ts, pilnuje scripts/ci/check-shared-copies.mjs). Bez importów.
 * Kopia robocza realizacji (`marketing_portfolio_items.content`) ma ten sam kształt w CRM, na Macu i w telefonie; publikacja
 * przepisuje ją do `portfolio_projects` (strona). Tu: limity, ikony elementów realizacji, adres (slug), normalizacja treści,
 * lista kontrolna SEO i odwzorowanie wiersza strony na treść (porównanie wersji roboczej z opublikowaną).
 */

export type PortfolioPhoto = {
  /** Wersja na komputer (do 2200 px, WebP) — `portfolio_projects.image` / `gallery[].src`. */
  src: string;
  /** Wersja na telefon (800 px). */
  mobile: string;
  /** Miniatura w kreatorze (700 px). */
  thumb: string;
  alt: string;
  width: number | null;
  height: number | null;
};

export type PortfolioFeature = { icon: string; title: string; description: string };

export type PortfolioContent = {
  title: string;
  slug: string;
  category: string;
  client: string;
  location: string;
  /** `YYYY-MM-DD` albo `null`. */
  eventDate: string | null;
  /** Krótki opis — karta realizacji na liście i zapasowy opis w Google. */
  description: string;
  /** Szczegółowy opis realizacji (akapity) — strona realizacji, SEO. */
  detailedDescription: string;
  metaDescription: string;
  keywords: string[];
  tags: string[];
  image: PortfolioPhoto | null;
  gallery: PortfolioPhoto[];
  features: PortfolioFeature[];
  eventCitySlug: string | null;
  referenceCitySlugs: string[];
  /** `null` — automatycznie (tag „konferencje”), `true` / `false` — zawsze / nigdy na stronach konferencji. */
  conferenceReferenceEnabled: boolean | null;
  isFeatured: boolean;
  orderIndex: number;
  videoUrl: string;
};

export type PortfolioStatus = 'draft' | 'published' | 'changed' | 'conflict';

export const PORTFOLIO_STATUS_LABELS: Record<PortfolioStatus, string> = {
  draft: 'Szkic',
  published: 'Na stronie',
  changed: 'Niepublikowane zmiany',
  conflict: 'Zmieniono na stronie',
};

export const PORTFOLIO_LIMITS = {
  title: 120,
  slug: 90,
  category: 60,
  client: 120,
  location: 160,
  description: 600,
  detailedDescription: 8000,
  metaDescription: 320,
  /** Zalecana długość opisu w Google (znaki). */
  metaMin: 120,
  metaMax: 160,
  keywords: 15,
  keyword: 60,
  tags: 12,
  tag: 40,
  gallery: 60,
  alt: 160,
  features: 12,
  featureTitle: 60,
  featureDescription: 160,
  videoUrl: 500,
  /** Zdjęcie wysyłane z dysku, telefonu albo z Materiałów. */
  uploadBytes: 40 * 1024 * 1024,
  /** Zalecana długość szczegółowego opisu (znaki) i liczba zdjęć w galerii. */
  detailedRecommended: 600,
  galleryRecommended: 5,
} as const;

/** Ikony elementów realizacji — nazwy ikon lucide (strona rysuje je po nazwie). */
export const PORTFOLIO_ICONS: Array<{ name: string; label: string; category: string }> = [
  { name: 'Users', label: 'Zespół', category: 'Ludzie' },
  { name: 'UserCheck', label: 'Ekspert', category: 'Ludzie' },
  { name: 'UsersRound', label: 'Grupa', category: 'Ludzie' },
  { name: 'Clock', label: 'Terminowość', category: 'Czas' },
  { name: 'Timer', label: 'Szybkość', category: 'Czas' },
  { name: 'Calendar', label: 'Planowanie', category: 'Czas' },
  { name: 'Award', label: 'Jakość', category: 'Jakość' },
  { name: 'Star', label: 'Wyróżnienie', category: 'Jakość' },
  { name: 'BadgeCheck', label: 'Certyfikat', category: 'Jakość' },
  { name: 'Target', label: 'Precyzja', category: 'Jakość' },
  { name: 'Lightbulb', label: 'Innowacyjność', category: 'Technologia' },
  { name: 'Zap', label: 'Energia', category: 'Technologia' },
  { name: 'Radio', label: 'Sprzęt', category: 'Technologia' },
  { name: 'Settings', label: 'Konfiguracja', category: 'Technologia' },
  { name: 'Mic', label: 'Audio', category: 'Technologia' },
  { name: 'CheckCircle2', label: 'Kompleksowość', category: 'Realizacja' },
  { name: 'Package', label: 'Kompletność', category: 'Realizacja' },
  { name: 'Truck', label: 'Logistyka', category: 'Realizacja' },
  { name: 'Wrench', label: 'Serwis', category: 'Realizacja' },
  { name: 'TrendingUp', label: 'Wzrost', category: 'Sukces' },
  { name: 'ThumbsUp', label: 'Zadowolenie', category: 'Sukces' },
  { name: 'Heart', label: 'Pasja', category: 'Sukces' },
  { name: 'Sparkles', label: 'Wyjątkowość', category: 'Sukces' },
];

export const isPortfolioIcon = (value: unknown): value is string =>
  typeof value === 'string' && PORTFOLIO_ICONS.some((icon) => icon.name === value);

const POLISH: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

/** Adres realizacji z tytułu: małe litery bez polskich znaków, słowa rozdzielone „-”. */
export function portfolioSlug(value: string): string {
  return value
    .toLocaleLowerCase('pl-PL')
    .replace(/[ąćęłńóśźż]/g, (char) => POLISH[char] || char)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PORTFOLIO_LIMITS.slug)
    .replace(/-+$/g, '');
}

export const isPortfolioSlug = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= PORTFOLIO_LIMITS.slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

const str = (value: unknown, max: number) => (typeof value === 'string' ? value : value == null ? '' : String(value)).trim().slice(0, max);
const line = (value: unknown, max: number) => str(value, max * 2).replace(/\s+/g, ' ').slice(0, max);
const list = (value: unknown, maxItems: number, maxLength: number) => {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const clean = line(item, maxLength);
    const key = clean.toLocaleLowerCase('pl-PL');
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= maxItems) break;
  }
  return result;
};
const isHttpUrl = (value: string) => /^https:\/\/[^\s"<>]+$/i.test(value);
const dimension = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null);

/** Zdjęcie z dowolnych danych (adresy `https://`); bez wersji na komputer — brak zdjęcia. */
export function normalizePortfolioPhoto(raw: unknown): PortfolioPhoto | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const src = str(item.src, 1000);
  if (!isHttpUrl(src)) return null;
  const mobile = str(item.mobile, 1000);
  const thumb = str(item.thumb, 1000);
  return {
    src,
    mobile: isHttpUrl(mobile) ? mobile : src,
    thumb: isHttpUrl(thumb) ? thumb : isHttpUrl(mobile) ? mobile : src,
    alt: line(item.alt, PORTFOLIO_LIMITS.alt),
    width: dimension(item.width),
    height: dimension(item.height),
  };
}

export function emptyPortfolioContent(): PortfolioContent {
  return {
    title: '', slug: '', category: '', client: '', location: '', eventDate: null, description: '', detailedDescription: '',
    metaDescription: '', keywords: [], tags: [], image: null, gallery: [], features: [], eventCitySlug: null, referenceCitySlugs: [],
    conferenceReferenceEnabled: null, isFeatured: false, orderIndex: 0, videoUrl: '',
  };
}

/** Treść realizacji w bezpiecznej postaci (limity, puste listy, poprawne daty i adresy). */
export function normalizePortfolioContent(raw: unknown): PortfolioContent {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const date = str(source.eventDate, 10);
  const slug = str(source.slug, PORTFOLIO_LIMITS.slug).toLowerCase();
  const order = Number(source.orderIndex);
  const video = str(source.videoUrl, PORTFOLIO_LIMITS.videoUrl);
  const city = str(source.eventCitySlug, 120);
  return {
    title: line(source.title, PORTFOLIO_LIMITS.title),
    slug: isPortfolioSlug(slug) ? slug : portfolioSlug(slug),
    category: line(source.category, PORTFOLIO_LIMITS.category),
    client: line(source.client, PORTFOLIO_LIMITS.client),
    location: line(source.location, PORTFOLIO_LIMITS.location),
    eventDate: /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T12:00:00Z`).getTime()) ? date : null,
    description: str(source.description, PORTFOLIO_LIMITS.description),
    detailedDescription: str(source.detailedDescription, PORTFOLIO_LIMITS.detailedDescription),
    metaDescription: line(source.metaDescription, PORTFOLIO_LIMITS.metaDescription),
    keywords: list(source.keywords, PORTFOLIO_LIMITS.keywords, PORTFOLIO_LIMITS.keyword),
    tags: list(source.tags, PORTFOLIO_LIMITS.tags, PORTFOLIO_LIMITS.tag),
    image: normalizePortfolioPhoto(source.image),
    gallery: (Array.isArray(source.gallery) ? source.gallery : []).map(normalizePortfolioPhoto)
      .filter((photo): photo is PortfolioPhoto => photo !== null).slice(0, PORTFOLIO_LIMITS.gallery),
    features: (Array.isArray(source.features) ? source.features : []).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const feature = item as Record<string, unknown>;
      const title = line(feature.title, PORTFOLIO_LIMITS.featureTitle);
      if (!title) return [];
      return [{ icon: isPortfolioIcon(feature.icon) ? feature.icon : 'Star', title, description: line(feature.description, PORTFOLIO_LIMITS.featureDescription) }];
    }).slice(0, PORTFOLIO_LIMITS.features),
    eventCitySlug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city) ? city : null,
    referenceCitySlugs: list(source.referenceCitySlugs, 60, 120).filter((item) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item)),
    conferenceReferenceEnabled: typeof source.conferenceReferenceEnabled === 'boolean' ? source.conferenceReferenceEnabled : null,
    isFeatured: source.isFeatured === true,
    orderIndex: Number.isFinite(order) ? Math.max(-9999, Math.min(9999, Math.round(order))) : 0,
    videoUrl: isHttpUrl(video) ? video : '',
  };
}

export type PortfolioCheck = { key: string; label: string; ok: boolean; hint: string; required: boolean };

/** Lista kontrolna przed publikacją: pola wymagane i zalecenia SEO (te same w CRM, na Macu i w telefonie). */
export function portfolioChecklist(content: PortfolioContent): PortfolioCheck[] {
  const photos = [...(content.image ? [content.image] : []), ...content.gallery];
  const withoutAlt = photos.filter((photo) => !photo.alt).length;
  const meta = content.metaDescription.length;
  return [
    { key: 'title', label: 'Tytuł', ok: content.title.length >= 3, hint: 'Nazwa realizacji widoczna na stronie i w Google.', required: true },
    { key: 'slug', label: 'Adres strony', ok: isPortfolioSlug(content.slug), hint: 'Np. jubileusz-30-lat-tymbark — małe litery i myślniki.', required: true },
    { key: 'image', label: 'Zdjęcie główne', ok: Boolean(content.image), hint: 'Zdjęcie na górze strony i w udostępnieniach.', required: true },
    { key: 'description', label: 'Krótki opis', ok: content.description.length >= 40, hint: 'Co, dla kogo, gdzie — 1–2 zdania na kartę realizacji.', required: true },
    {
      key: 'meta', label: 'Opis w Google', ok: meta >= PORTFOLIO_LIMITS.metaMin && meta <= PORTFOLIO_LIMITS.metaMax,
      hint: `${PORTFOLIO_LIMITS.metaMin}–${PORTFOLIO_LIMITS.metaMax} znaków (teraz ${meta}).`, required: false,
    },
    {
      key: 'detailed', label: 'Szczegółowy opis', ok: content.detailedDescription.length >= PORTFOLIO_LIMITS.detailedRecommended,
      hint: `Najlepiej od ${PORTFOLIO_LIMITS.detailedRecommended} znaków: zakres usług, technika, przebieg (teraz ${content.detailedDescription.length}).`, required: false,
    },
    {
      key: 'gallery', label: 'Galeria', ok: content.gallery.length >= PORTFOLIO_LIMITS.galleryRecommended,
      hint: `Co najmniej ${PORTFOLIO_LIMITS.galleryRecommended} zdjęć (teraz ${content.gallery.length}).`, required: false,
    },
    { key: 'alt', label: 'Opisy zdjęć (alt)', ok: photos.length > 0 && withoutAlt === 0, hint: withoutAlt ? `${withoutAlt} zdjęć bez opisu.` : 'Opis każdego zdjęcia pomaga w Google Grafika.', required: false },
    { key: 'keywords', label: 'Słowa kluczowe', ok: content.keywords.length >= 3, hint: 'Np. „gala firmowa Olsztyn”, „scena z ekranem LED” — 3–10 fraz.', required: false },
    { key: 'city', label: 'Miasto realizacji', ok: Boolean(content.eventCitySlug), hint: 'Realizacja pojawi się na stronach usług w tym mieście.', required: false },
    { key: 'features', label: 'Elementy realizacji', ok: content.features.length >= 3, hint: 'Np. scena, oświetlenie, prowadzący — 3–6 elementów.', required: false },
  ];
}

/** Braki blokujące publikację (pola wymagane). */
export const portfolioPublishProblems = (content: PortfolioContent) =>
  portfolioChecklist(content).filter((check) => check.required && !check.ok).map((check) => `${check.label}: ${check.hint}`);

type SiteRow = Record<string, unknown>;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Treść realizacji z wiersza strony (`portfolio_projects`) — kopia robocza istniejącej realizacji. */
export function portfolioContentFromSite(row: SiteRow): PortfolioContent {
  const meta = object(row.image_metadata);
  const heroSrc = str(object(meta.desktop).src, 1000) || str(row.image, 1000) || str(row.image_url, 1000);
  const gallery = Array.isArray(row.gallery) && row.gallery.length
    ? row.gallery.map((item) => {
      const photo = object(item);
      const photoMeta = object(photo.image_metadata);
      const src = str(photo.src, 1000) || str(object(photoMeta.desktop).src, 1000);
      return { src, mobile: str(object(photoMeta.mobile).src, 1000), alt: photo.alt };
    })
    : (Array.isArray(row.gallery_images) ? row.gallery_images : []).map((src) => ({ src: str(src, 1000), mobile: '', alt: '' }));
  const features = (Array.isArray(row.features) ? row.features : [])
    .map((item, index) => ({ feature: object(item), index }))
    .map((entry) => ({ ...entry, order: Number.isFinite(Number(entry.feature.order_index ?? NaN)) ? Number(entry.feature.order_index) : entry.index }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ feature }) => ({ icon: feature.icon_name, title: feature.title, description: feature.description }));
  return normalizePortfolioContent({
    title: row.title,
    slug: row.slug,
    category: row.category,
    client: row.client,
    location: row.location,
    eventDate: str(row.event_date, 10) || str(row.date, 10),
    description: row.description,
    detailedDescription: row.detailed_description,
    metaDescription: row.meta_description,
    keywords: row.keywords,
    tags: row.tags,
    image: heroSrc ? { src: heroSrc, mobile: str(object(meta.mobile).src, 1000), alt: row.alt } : null,
    gallery,
    features,
    eventCitySlug: row.event_city_slug,
    referenceCitySlugs: row.reference_city_slugs,
    conferenceReferenceEnabled: row.conference_reference_enabled,
    isFeatured: row.is_featured,
    orderIndex: row.order_index,
    videoUrl: row.video_url,
  });
}

/**
 * Pola treści widoczne na stronie w stałej kolejności (bez miniatur i wymiarów) — porównanie wersji roboczej
 * z opublikowaną (skrót liczy serwer).
 */
export function portfolioSiteSnapshot(content: PortfolioContent): string {
  const photo = (item: PortfolioPhoto | null) => (item ? [item.src, item.mobile, item.alt] : null);
  return JSON.stringify([
    content.title, content.slug, content.category, content.client, content.location, content.eventDate, content.description,
    content.detailedDescription, content.metaDescription, content.keywords, content.tags, photo(content.image),
    content.gallery.map(photo), content.features.map((feature) => [feature.icon, feature.title, feature.description]),
    content.eventCitySlug, [...content.referenceCitySlugs].sort(), content.conferenceReferenceEnabled, content.isFeatured,
    content.orderIndex, content.videoUrl,
  ]);
}

/**
 * Kolumny strony z kopii roboczej — położenie kadru zdjęć ustawione w trybie edycji strony zostaje. Wartości odczytane
 * ze strony z powrotem (`portfolioContentFromSite`) dają tę samą treść co kopia robocza.
 */
export function portfolioSiteFields(content: PortfolioContent, site: Record<string, unknown> | null) {
  const positions = new Map<string, unknown>();
  const remember = (meta: unknown, src: string) => {
    const entries = object(meta);
    for (const key of ['desktop', 'mobile']) {
      const position = object(entries[key]).position;
      if (position && typeof position === 'object' && !Array.isArray(position)) positions.set(`${key}|${src}`, position);
    }
  };
  if (site) {
    const heroMeta = object(site.image_metadata);
    remember(heroMeta, str(object(heroMeta.desktop).src, 1000) || str(site.image, 1000));
    for (const item of Array.isArray(site.gallery) ? site.gallery : []) remember(object(item).image_metadata, str(object(item).src, 1000));
  }
  const position = (key: 'desktop' | 'mobile', src: string) => positions.get(`${key}|${src}`) || { posX: 0, posY: 0, scale: 1 };
  const metadata = (photo: PortfolioPhoto) => ({
    desktop: { src: photo.src, position: position('desktop', photo.src) },
    mobile: { src: photo.mobile, position: position('mobile', photo.src) },
  });
  return {
    title: content.title,
    slug: content.slug,
    category: content.category || null,
    client: content.client || null,
    location: content.location || null,
    event_date: content.eventDate || '',
    description: content.description,
    detailed_description: content.detailedDescription,
    meta_description: content.metaDescription || null,
    keywords: content.keywords,
    tags: content.tags,
    image: content.image?.src || null,
    alt: content.image ? content.image.alt : null,
    image_metadata: content.image ? metadata(content.image) : null,
    gallery: content.gallery.map((photo) => ({ src: photo.src, alt: photo.alt, image_metadata: metadata(photo) })),
    features: content.features.map((feature, index) => ({ icon_name: feature.icon, title: feature.title, description: feature.description, order_index: index })),
    event_city_slug: content.eventCitySlug,
    reference_city_slugs: content.referenceCitySlugs,
    conference_reference_enabled: content.conferenceReferenceEnabled,
    is_featured: content.isFeatured,
    order_index: content.orderIndex,
    video_url: content.videoUrl,
  };
}

/** Zdjęcia kopii roboczej uzupełnione o miniatury i wymiary z poprzedniej treści (wersja ze strony ich nie ma). */
export function portfolioKeepPhotoDetails(next: PortfolioContent, previous: PortfolioContent): PortfolioContent {
  const known = new Map<string, PortfolioPhoto>();
  for (const photo of [...(previous.image ? [previous.image] : []), ...previous.gallery]) known.set(photo.src, photo);
  const merge = (photo: PortfolioPhoto): PortfolioPhoto => {
    const old = known.get(photo.src);
    return old ? { ...photo, thumb: old.thumb, width: old.width, height: old.height } : photo;
  };
  return { ...next, image: next.image ? merge(next.image) : null, gallery: next.gallery.map(merge) };
}

/** Podgląd wyniku w Google: tytuł strony realizacji i opis (jak w metadanych strony). */
export function portfolioSearchPreview(content: PortfolioContent) {
  return {
    title: `${content.title || 'Realizacja'} | Portfolio MAVINCI`,
    url: `mavinci.pl › portfolio › ${content.slug || 'adres-realizacji'}`,
    description: content.metaDescription || content.description,
  };
}
