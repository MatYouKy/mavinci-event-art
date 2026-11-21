import 'server-only';
import { createHash } from 'node:crypto';
import type { NativeContext } from '@/lib/native/auth';
import { renderHtmlToImage } from '@/lib/print/pdfRenderer.server';
import {
  brandbookPublicUrl, check, downloadSocialFile, fail, fetchPublicStorageFile, isUuid, pngSize, removeSocialFiles, text,
  uploadSocialFile, type Row,
} from './socialCommon.server';
import {
  buildSocialGraphicHtml, parseHexColor, parseSocialTemplateSettings, socialLayoutGuides, type SocialTemplateSettings,
} from './socialGraphic';
import {
  SOCIAL_FORMATS, SOCIAL_FORMAT_INFO, SOCIAL_GRAPHIC_STYLE_LIST, formatSlug, isSocialGraphicStyle, type SocialCrop, type SocialFormat,
  type SocialGraphicStyle,
} from './socialShared';
import type { SocialLayoutDefinition } from './socialLayout';

/*
 * Szablon grafiki marki (`social_brand_templates`) — wyłącznie odwołania do księgi znaku (logo, fonty, kolory) i liczby
 * układu. Gotowość szablonu, dane do podglądu na żywo w CRM (publiczne adresy plików księgi znaku), skrót danych renderu
 * i render grafiki (Chromium na serwerze → JPEG w `social-media/<marka>/posts/<post>/`), wspólny dla web, Maca i telefonu.
 * Domyślny styl grafik marki (`settings.defaultStyle`) dostają nowe posty; styl i napis nad tytułem są w wariancie posta.
 */

/** Zmiana wyglądu grafik (np. nowy układ HTML) — podnieś, żeby istniejące grafiki uznać za nieaktualne. */
const RENDER_VERSION = 1;

export type BrandColor = { id: string; label: string; hex: string };
export type BrandFont = { id: string; label: string; family: string; url: string | null };
export type BrandLogo = { id: string; label: string; variant: string; url: string };

export type LoadedTemplate = {
  id: string;
  companyId: string;
  name: string;
  isDefault: boolean;
  updatedAt: string;
  settings: SocialTemplateSettings;
  /** Styl nowych postów (ustawienia szablonu) — nie wpływa na grafiki istniejących postów. */
  defaultStyle: SocialGraphicStyle;
  logo: BrandLogo | null;
  titleFont: BrandFont | null;
  captionFont: BrandFont | null;
  overlay: BrandColor | null;
  accent: BrandColor | null;
  textColor: BrandColor | null;
  problems: string[];
};

const TEMPLATE_FIELDS = 'id, company_id, name, is_default, updated_at, settings, logo_id, title_font_id, caption_font_id, overlay_color_id, accent_color_id, text_color_id';

function brandColor(row: Row | undefined): BrandColor | null {
  if (!row) return null;
  const rgb = parseHexColor(row.hex);
  if (!rgb) return null;
  return { id: String(row.id), label: text(row.label), hex: `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}` };
}

function brandFont(row: Row | undefined): BrandFont | null {
  if (!row) return null;
  return {
    id: String(row.id),
    label: text(row.label),
    family: text(row.family),
    url: brandbookPublicUrl(row.storage_path) || (/^https?:\/\//i.test(text(row.file_url)) ? text(row.file_url) : null),
  };
}

/** Szablony marki z danymi księgi znaku (domyślny pierwszy). */
export async function loadTemplates(ctx: NativeContext, companyId: string, onlyId?: string): Promise<LoadedTemplate[]> {
  let query = ctx.supabase.from('social_brand_templates').select(TEMPLATE_FIELDS).eq('company_id', companyId);
  if (onlyId) query = query.eq('id', onlyId);
  const { data, error } = await query.order('is_default', { ascending: false }).order('name');
  check(error, 'Nie udało się pobrać szablonów grafik.');
  const rows = (data || []) as Row[];
  if (!rows.length) return [];
  const [logos, fonts, colors] = await Promise.all([
    ctx.supabase.from('company_brandbook_logos').select('id, label, url, variant').eq('company_id', companyId),
    ctx.supabase.from('company_brandbook_fonts').select('id, label, family, storage_path, file_url').eq('company_id', companyId),
    ctx.supabase.from('company_brandbook_colors').select('id, label, hex').eq('company_id', companyId),
  ]);
  const byId = (list: Row[] | null) => new Map((list || []).map((row) => [String(row.id), row]));
  const logoRows = byId(logos.data as Row[] | null);
  const fontRows = byId(fonts.data as Row[] | null);
  const colorRows = byId(colors.data as Row[] | null);
  return rows.map((row) => {
    const logoRow = logoRows.get(text(row.logo_id));
    const logoUrl = logoRow ? brandbookPublicUrl(logoRow.url) : null;
    const template: LoadedTemplate = {
      id: String(row.id),
      companyId: String(row.company_id),
      name: text(row.name) || 'Szablon marki',
      isDefault: row.is_default === true,
      updatedAt: text(row.updated_at),
      settings: parseSocialTemplateSettings(row.settings),
      defaultStyle: templateDefaultStyle(row.settings),
      logo: logoRow && logoUrl ? { id: String(logoRow.id), label: text(logoRow.label), variant: text(logoRow.variant), url: logoUrl } : null,
      titleFont: brandFont(fontRows.get(text(row.title_font_id))),
      captionFont: brandFont(fontRows.get(text(row.caption_font_id))),
      overlay: brandColor(colorRows.get(text(row.overlay_color_id))),
      accent: brandColor(colorRows.get(text(row.accent_color_id))),
      textColor: brandColor(colorRows.get(text(row.text_color_id))),
      problems: [],
    };
    template.problems = templateProblems(template);
    return template;
  });
}

/** Domyślny styl grafik z ustawień szablonu (`settings.defaultStyle`). */
export function templateDefaultStyle(settings: unknown): SocialGraphicStyle {
  const value = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Row).defaultStyle : null;
  return isSocialGraphicStyle(value) ? value : 'classic';
}

function templateProblems(template: LoadedTemplate): string[] {
  const problems: string[] = [];
  if (!template.logo) problems.push('Wybierz logo z księgi znaku.');
  if (!template.titleFont?.url) problems.push('Font tytułu musi mieć plik w księdze znaku — wtedy grafika jest identyczna w CRM, na Macu i w telefonie.');
  if (!template.captionFont?.url) problems.push('Font podpisu musi mieć plik w księdze znaku.');
  if (!template.overlay) problems.push('Wybierz kolor przyciemnienia z księgi znaku.');
  if (!template.accent) problems.push('Wybierz kolor akcentu (kreska i podpis) z księgi znaku.');
  if (!template.textColor) problems.push('Wybierz kolor tytułu z księgi znaku.');
  return problems;
}

// Pliki księgi znaku (logo, fonty) w pamięci serwera — 15 min; zmiana pliku w księdze znaku zmienia adres.
const ASSET_TTL_MS = 15 * 60_000;
const brandFiles = new Map<string, { bytes: Buffer; contentType: string; at: number }>();

async function brandFile(url: string, maxBytes: number) {
  const cached = brandFiles.get(url);
  if (cached && Date.now() - cached.at < ASSET_TTL_MS) return cached;
  try {
    const file = await fetchPublicStorageFile(url, maxBytes);
    const entry = { ...file, at: Date.now() };
    brandFiles.set(url, entry);
    if (brandFiles.size > 40) brandFiles.delete(brandFiles.keys().next().value as string);
    return entry;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

const fontMime = (url: string) => {
  const ext = (/\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url)?.[1] || '').toLowerCase();
  return ext === 'otf' ? 'font/otf' : ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : 'font/ttf';
};

/** Proporcje logo (szerokość / wysokość) — nakładka edytora kadru. */
async function logoAspect(template: LoadedTemplate): Promise<number | null> {
  if (!template.logo) return null;
  try {
    const size = pngSize((await brandFile(template.logo.url, 8_000_000)).bytes);
    return size ? size.width / size.height : null;
  } catch {
    return null;
  }
}

export type SocialTemplateDTO = {
  id: string;
  name: string;
  isDefault: boolean;
  ready: boolean;
  problems: string[];
  logoId: string | null;
  titleFontId: string | null;
  captionFontId: string | null;
  overlayColorId: string | null;
  accentColorId: string | null;
  textColorId: string | null;
  colors: { overlay: string | null; accent: string | null; text: string | null };
  logoUrl: string | null;
  titleFontLabel: string;
  captionFontLabel: string;
  defaultStyle: SocialGraphicStyle;
  updatedAt: string;
};

export function templateDTO(template: LoadedTemplate): SocialTemplateDTO {
  return {
    id: template.id,
    name: template.name,
    isDefault: template.isDefault,
    ready: template.problems.length === 0,
    problems: template.problems,
    logoId: template.logo?.id || null,
    titleFontId: template.titleFont?.id || null,
    captionFontId: template.captionFont?.id || null,
    overlayColorId: template.overlay?.id || null,
    accentColorId: template.accent?.id || null,
    textColorId: template.textColor?.id || null,
    colors: { overlay: template.overlay?.hex || null, accent: template.accent?.hex || null, text: template.textColor?.hex || null },
    logoUrl: template.logo?.url || null,
    titleFontLabel: template.titleFont ? template.titleFont.label || template.titleFont.family : '',
    captionFontLabel: template.captionFont ? template.captionFont.label || template.captionFont.family : '',
    defaultStyle: template.defaultStyle,
    updatedAt: template.updatedAt,
  };
}

/** Dane do podglądu na żywo (CRM — ramka z tym samym HTML) i nakładki edytora kadru (Mac, CRM). */
export type SocialGraphicSpec = {
  templateId: string;
  ready: boolean;
  logo: { src: string; aspect: number | null } | null;
  titleFont: { family: string; src: string | null };
  captionFont: { family: string; src: string | null };
  colors: { overlay: string; accent: string; text: string };
  settings: SocialTemplateSettings;
  /** Strefy stylu „Klasyczny” (starsze wersje aplikacji). */
  guides: Record<SocialFormat, ReturnType<typeof socialLayoutGuides>>;
  /** Strefy każdego stylu grafiki — nakładka edytora kadru (Mac, CRM). */
  styleGuides: Record<SocialGraphicStyle, Record<SocialFormat, ReturnType<typeof socialLayoutGuides>>>;
  defaultStyle: SocialGraphicStyle;
};

export async function graphicSpec(template: LoadedTemplate): Promise<SocialGraphicSpec> {
  const aspect = await logoAspect(template);
  return {
    templateId: template.id,
    ready: template.problems.length === 0,
    logo: template.logo ? { src: template.logo.url, aspect } : null,
    titleFont: { family: template.titleFont?.family || '', src: template.titleFont?.url || null },
    captionFont: { family: template.captionFont?.family || '', src: template.captionFont?.url || null },
    colors: {
      overlay: template.overlay?.hex || '',
      accent: template.accent?.hex || '',
      text: template.textColor?.hex || '',
    },
    settings: template.settings,
    guides: Object.fromEntries(SOCIAL_FORMATS.map((format) => [format, socialLayoutGuides(template.settings, format, aspect)])) as SocialGraphicSpec['guides'],
    styleGuides: Object.fromEntries(SOCIAL_GRAPHIC_STYLE_LIST.map((style) => [style, Object.fromEntries(SOCIAL_FORMATS.map((format) => [
      format, socialLayoutGuides(template.settings, format, aspect, style),
    ]))])) as SocialGraphicSpec['styleGuides'],
    defaultStyle: template.defaultStyle,
  };
}

export type RenderSource = {
  format: SocialFormat;
  workPath: string;
  crop: SocialCrop;
  headline: string;
  subline: string;
  style: SocialGraphicStyle;
  kicker: string;
  /** Układ jako dane (zamiast stylu) i zdjęcia kolażu: indeks = numer miejsca 1–3 (miejsce 0 — `workPath`). */
  layout?: SocialLayoutDefinition | null;
  slots?: Array<{ workPath: string; crop: SocialCrop } | null>;
};

const roundCrop = (crop: SocialCrop) => [crop.x, crop.y, crop.w, crop.h].map((value) => Math.round(value * 10000) / 10000);

/**
 * Skrót danych renderu: zmiana szablonu, księgi znaku, zdjęcia, kadru, tekstów albo stylu → grafika nieaktualna.
 * Styl „Klasyczny” bez napisu nad tytułem daje ten sam skrót co przed wprowadzeniem stylów (istniejące grafiki aktualne).
 */
export function renderHash(template: LoadedTemplate, source: RenderSource): string {
  const payload = JSON.stringify({
    v: RENDER_VERSION,
    template: template.id,
    settings: template.settings,
    logo: template.logo?.url || null,
    titleFont: template.titleFont?.url || null,
    captionFont: template.captionFont?.url || null,
    colors: [template.overlay?.hex, template.accent?.hex, template.textColor?.hex],
    format: source.format,
    photo: source.workPath,
    crop: roundCrop(source.crop),
    headline: source.headline.trim(),
    subline: source.subline.trim(),
    ...(source.style !== 'classic' ? { style: source.style } : {}),
    ...(source.kicker.trim() ? { kicker: source.kicker.trim() } : {}),
    // Układ jako dane: definicja i zdjęcia kolażu (bez układu — skrót jak dotąd).
    ...(source.layout ? {
      layout: source.layout,
      slots: (source.slots || []).map((slot) => (slot ? [slot.workPath, roundCrop(slot.crop)] : null)),
    } : {}),
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

/** Logo i fonty szablonu jako `data:` (render bez sieci) — wspólne dla grafiki i warstwy podglądu na żywo. */
async function brandAssets(template: LoadedTemplate) {
  if (template.problems.length) fail(`Szablon „${template.name}” nie jest gotowy: ${template.problems.join(' ')}`, 422);
  const [logo, titleFont, captionFont] = await Promise.all([
    brandFile(template.logo!.url, 8_000_000),
    brandFile(template.titleFont!.url!, 6_000_000),
    brandFile(template.captionFont!.url!, 6_000_000),
  ]);
  const logoType = pngSize(logo.bytes) ? 'image/png' : logo.contentType.startsWith('image/') ? logo.contentType : 'image/png';
  return {
    logo: { src: `data:${logoType};base64,${logo.bytes.toString('base64')}` },
    titleFont: { family: template.titleFont!.family, src: `data:${fontMime(template.titleFont!.url!)};base64,${titleFont.bytes.toString('base64')}` },
    captionFont: { family: template.captionFont!.family, src: `data:${fontMime(template.captionFont!.url!)};base64,${captionFont.bytes.toString('base64')}` },
    colors: { overlay: template.overlay!.hex, accent: template.accent!.hex, text: template.textColor!.hex },
    settings: template.settings,
  };
}

/** Grafika w formacie (JPEG) — HTML z danymi osadzonymi jako `data:` (render bez sieci). */
export async function renderGraphic(ctx: NativeContext, template: LoadedTemplate, source: RenderSource): Promise<Buffer> {
  const slotSources = source.layout ? source.slots || [] : [];
  const [brand, photo, ...slotPhotos] = await Promise.all([
    brandAssets(template),
    downloadSocialFile(ctx.supabase, source.workPath),
    ...slotSources.map((slot) => (slot ? downloadSocialFile(ctx.supabase, slot.workPath) : Promise.resolve(null))),
  ]);
  const html = buildSocialGraphicHtml({
    format: source.format,
    photo: { src: `data:image/jpeg;base64,${photo.toString('base64')}`, crop: source.crop },
    ...brand,
    headline: source.headline,
    subline: source.subline,
    style: source.style,
    kicker: source.kicker,
    layout: source.layout || null,
    photos: slotSources.map((slot, index) => {
      const bytes = slotPhotos[index];
      return slot && bytes ? { src: `data:image/jpeg;base64,${bytes.toString('base64')}`, crop: slot.crop } : null;
    }),
  });
  const { width, height } = SOCIAL_FORMAT_INFO[source.format];
  try {
    return await renderHtmlToImage(html, { width, height, type: 'jpeg', quality: 92 });
  } catch (error) {
    console.error('[social-render]', error);
    fail('Nie udało się wygenerować grafiki. Spróbuj ponownie za chwilę.', 502);
  }
}

/**
 * Warstwa grafiki bez zdjęcia (przyciemnienia, ramy, passe-partout, kinowe pasy, logo i teksty) — PNG z przezroczystym tłem w wymiarach
 * formatu. Podgląd kadru na żywo na Macu: zdjęcie w bieżącym kadrze + ta warstwa (ten sam HTML i Chromium co render),
 * więc podgląd wygląda jak grafika po zapisie. Zmiana kadru nie wymaga nowej warstwy — tylko zmiana tekstów, szablonu
 * albo formatu. Ostatnie warstwy są w pamięci serwera (10 min).
 */
const overlayCache = new Map<string, { bytes: Buffer; at: number }>();
const OVERLAY_TTL_MS = 10 * 60_000;

export async function renderOverlay(
  template: LoadedTemplate,
  input: { format: SocialFormat; headline: string; subline: string; style: SocialGraphicStyle; kicker: string; layout?: SocialLayoutDefinition | null },
): Promise<Buffer> {
  const key = JSON.stringify([RENDER_VERSION, template.id, template.updatedAt, template.settings, template.logo?.url, template.titleFont?.url,
    template.captionFont?.url, template.overlay?.hex, template.accent?.hex, template.textColor?.hex, input.format, input.headline, input.subline,
    input.style, input.kicker, input.layout || null]);
  const cached = overlayCache.get(key);
  if (cached && Date.now() - cached.at < OVERLAY_TTL_MS) return cached.bytes;
  const brand = await brandAssets(template);
  const html = buildSocialGraphicHtml({
    format: input.format,
    photo: null,
    ...brand,
    headline: input.headline,
    subline: input.subline,
    style: input.style,
    kicker: input.kicker,
    layout: input.layout || null,
    transparent: true,
  });
  const { width, height } = SOCIAL_FORMAT_INFO[input.format];
  let bytes: Buffer;
  try {
    bytes = await renderHtmlToImage(html, { width, height, type: 'png', transparent: true });
  } catch (error) {
    console.error('[social-overlay]', error);
    fail('Nie udało się przygotować podglądu grafiki. Spróbuj ponownie za chwilę.', 502);
  }
  overlayCache.set(key, { bytes, at: Date.now() });
  if (overlayCache.size > 60) overlayCache.delete(overlayCache.keys().next().value as string);
  return bytes;
}

/**
 * Render grafiki wariantu posta i zapis: `<marka>/posts/<post>/<format>-<skrót>.jpg`, wpis w `social_post_variants`
 * (ścieżka, skrót, czas), usunięcie poprzedniego pliku. Grafika aktualna (ten sam skrót) — bez renderu.
 */
export async function renderVariant(
  ctx: NativeContext,
  post: { id: string; companyId: string },
  template: LoadedTemplate,
  variant: { id: string; renderedPath: string | null; renderHash: string | null },
  source: RenderSource,
  /** Zdjęcie karuzeli: wiersz `social_post_slides` i plik `slide-<n>-<format>-<skrót>.jpg` (okładka — warianty). */
  slide?: { position: number },
): Promise<{ path: string; hash: string; rendered: boolean }> {
  const hash = renderHash(template, source);
  if (variant.renderHash === hash && variant.renderedPath) return { path: variant.renderedPath, hash, rendered: false };
  const bytes = await renderGraphic(ctx, template, source);
  const prefix = slide ? `slide-${slide.position}-` : '';
  const path = `${post.companyId}/posts/${post.id}/${prefix}${formatSlug(source.format)}-${hash.slice(0, 16)}.jpg`;
  await uploadSocialFile(ctx.supabase, path, bytes, 'image/jpeg');
  const { error } = await ctx.supabase.from(slide ? 'social_post_slides' : 'social_post_variants')
    .update({ rendered_path: path, render_hash: hash, rendered_at: new Date().toISOString() })
    .eq('id', variant.id);
  check(error, 'Nie udało się zapisać grafiki posta.');
  if (variant.renderedPath && variant.renderedPath !== path) await removeSocialFiles(ctx.supabase, [variant.renderedPath]);
  return { path, hash, rendered: true };
}

/** Szablon posta: wybrany (jeśli istnieje w marce) albo domyślny marki. */
export function pickTemplate(templates: LoadedTemplate[], templateId: unknown): LoadedTemplate | null {
  if (isUuid(templateId)) {
    const chosen = templates.find((template) => template.id === String(templateId).toLowerCase());
    if (chosen) return chosen;
  }
  return templates.find((template) => template.isDefault) || templates[0] || null;
}
