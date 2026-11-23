import 'server-only';
import type { NativeContext } from './auth';
import { fail } from './offers';
import { WEDDING_DEPOSIT_DEFAULT, WEDDING_TERMS_DEFAULT } from '@/lib/offer-pdf/shared/weddingPricingDefaults';

/*
 * Oferty na Macu — „Szablony ofert” (`/crm/offers?tab=templates`, `OfferPageTemplatesEditor`), część F1: kategorie szablonów
 * (nazwa, opis, kolor, domyślna, zdjęcie hero, kreator wyglądu: kolory, hero, logo, układ założeń i wyceny, strony „Informacje
 * i warunki” oraz wymagań), przypisania kategorii wydarzeń, szablony stron (5 etapów dokumentu, wariant karty produktu),
 * własne tło PDF i powrót do gotowego układu Mavinci; część F2: pola danych na tle PDF („Rozmieść dane”) i wygląd tabeli wyceny.
 * Kolory z księgi znaku marki wydarzenia (`brand_colors`), wycena weselna (`pricing_style: 'wedding'`: zadatek, warunki)
 * i rozdziały z Prezentacji (`chapter_item_ids` — karty w kolejności; lista kart do wyboru w `showcaseCards`).
 * Te same tabele i ten sam magazyn plików co CRM (RLS tokenem pracownika).
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: unknown, message: string) => {
  const id = String(value || '');
  if (!UUID.test(id)) fail(message);
  return id;
};
const text = (value: unknown) => (value == null ? '' : String(value));
const BUCKET = 'offer-template-pages';
const HEX = /^#[0-9a-f]{6}$/i;

export const TEMPLATE_TYPES = ['cover', 'about', 'product', 'pricing', 'final'] as const;
const VARIANTS = ['default', 'compact', 'visual'];

/** Domyślne sekcje nowego szablonu (jak `sectionTypes` w CRM). */
const SECTION_TYPES: Record<string, string[]> = {
  cover: ['logo', 'title', 'subtitle', 'client_details', 'offer_details', 'background_image'],
  about: ['company_description', 'achievements', 'certifications', 'team', 'gallery'],
  product: ['product_details', 'product_benefits', 'product_image', 'item_summary'],
  pricing: ['summary_table', 'payment_terms', 'validity', 'notes'],
  final: ['technical_requirements', 'seller_details', 'contact_info', 'legal_terms', 'footer'],
};

/** Wygląd kategorii (jak `DEFAULT_CATEGORY_DESIGN` w CRM). */
export const DEFAULT_CATEGORY_DESIGN = {
  primary_color: '#5b001f',
  secondary_color: '#1c1f33',
  accent_color: '#d3bb73',
  surface_color: '#faf7f2',
  hero_opacity: 0.58,
  hero_gradient_enabled: true,
  hero_gradient_end: 0.45,
  hero_height: 395,
  logo_scale: 1,
  assumptions_layout: 'cards',
  visual_image_height: 285,
  pricing_style: 'card',
  info_page_enabled: true,
  info_page_title: 'INFORMACJE I WARUNKI',
  order_process_text: 'Akceptacja zakresu i wyceny\nPotwierdzenie terminu i podpisanie umowy\nUstalenia techniczne z obiektem\nRealizacja wydarzenia',
  requirements_page_enabled: true,
  requirements_page_title: 'WARUNKI TECHNICZNE I ORGANIZACYJNE',
  requirements_page_subtitle: 'Wymagania niezbędne do bezpiecznego i sprawnego przygotowania realizacji.',
  technical_requirements_text: 'Dostęp do sali przed wydarzeniem w czasie uzgodnionym z realizatorem\nStabilne zasilanie 230 V oraz miejsce dla stanowiska technicznego\nDostęp do internetu przewodowego przy realizacjach online\nKontakt do osoby technicznej po stronie obiektu',
  reservation_terms_text: 'Termin rezerwujemy po akceptacji oferty i podpisaniu umowy\nZakres końcowy potwierdzamy po weryfikacji warunków technicznych\nDodatkowe usługi i zmiany wymagają potwierdzenia przed wydarzeniem',
  brand_colors: false,
  deposit_percent: WEDDING_DEPOSIT_DEFAULT,
  wedding_terms_text: WEDDING_TERMS_DEFAULT,
  chapter_item_ids: [] as string[],
};
type Design = typeof DEFAULT_CATEGORY_DESIGN;
/** Najwięcej rozdziałów z Prezentacji w kategorii (jak `CHAPTER_LIMITS.chapters` w PDF). */
const CHAPTER_LIMIT = 12;
const chapterIds = (value: unknown): string[] | null => (Array.isArray(value)
  ? Array.from(new Set(value.map((item) => text(item).toLowerCase()).filter((item) => UUID.test(item)))).slice(0, CHAPTER_LIMIT)
  : null);

/** Uprawnienia dokładnie jak polityki tabel: kategorie — admin / strona / oferty; szablony — admin / strona; usuwanie — admin. */
function access(ctx: NativeContext) {
  const has = (scope: string) => ctx.employee.permissions.includes(scope);
  return {
    canEditCategories: has('admin') || has('website_edit') || has('offers_manage'),
    canEditTemplates: has('admin') || has('website_edit'),
    canDeleteTemplates: has('admin'),
  };
}

const designOf = (raw: unknown): Design => ({ ...DEFAULT_CATEGORY_DESIGN, ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Row : {}) });

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

/** Wygląd z Maca: znane pola w zakresach suwaków CRM; pozostałe zapisane wcześniej klucze zostają. */
function normalizeDesign(input: unknown, current: unknown) {
  const raw = input && typeof input === 'object' ? input as Row : {};
  const base = designOf(current);
  const color = (key: keyof Design) => (HEX.test(text(raw[key])) ? text(raw[key]).toLowerCase() : base[key]);
  const line = (key: keyof Design, max: number) => (raw[key] == null ? base[key] : text(raw[key]).slice(0, max));
  return {
    ...(current && typeof current === 'object' && !Array.isArray(current) ? current as Row : {}),
    primary_color: color('primary_color'),
    secondary_color: color('secondary_color'),
    accent_color: color('accent_color'),
    surface_color: color('surface_color'),
    hero_opacity: Math.round(clamp(raw.hero_opacity, 0.2, 0.85, base.hero_opacity) * 100) / 100,
    hero_gradient_enabled: raw.hero_gradient_enabled == null ? base.hero_gradient_enabled : raw.hero_gradient_enabled === true,
    hero_gradient_end: Math.round(clamp(raw.hero_gradient_end, 0.2, 0.8, base.hero_gradient_end) * 100) / 100,
    hero_height: Math.round(clamp(raw.hero_height, 320, 470, base.hero_height)),
    logo_scale: Math.round(clamp(raw.logo_scale, 0.7, 1.5, base.logo_scale) * 100) / 100,
    assumptions_layout: ['cards', 'simple'].includes(raw.assumptions_layout) ? raw.assumptions_layout : base.assumptions_layout,
    visual_image_height: Math.round(clamp(raw.visual_image_height, 220, 330, base.visual_image_height)),
    pricing_style: ['card', 'minimal', 'wedding'].includes(raw.pricing_style) ? raw.pricing_style : base.pricing_style,
    info_page_enabled: raw.info_page_enabled == null ? base.info_page_enabled : raw.info_page_enabled === true,
    info_page_title: line('info_page_title', 120),
    order_process_text: line('order_process_text', 4000),
    requirements_page_enabled: raw.requirements_page_enabled == null ? base.requirements_page_enabled : raw.requirements_page_enabled === true,
    requirements_page_title: line('requirements_page_title', 120),
    requirements_page_subtitle: line('requirements_page_subtitle', 500),
    technical_requirements_text: line('technical_requirements_text', 6000),
    reservation_terms_text: line('reservation_terms_text', 4000),
    brand_colors: raw.brand_colors == null ? base.brand_colors === true : raw.brand_colors === true,
    deposit_percent: Math.round(clamp(raw.deposit_percent ?? base.deposit_percent, 0, 100, WEDDING_DEPOSIT_DEFAULT)),
    wedding_terms_text: line('wedding_terms_text', 4000),
    chapter_item_ids: chapterIds(raw.chapter_item_ids) ?? chapterIds(base.chapter_item_ids) ?? [],
  };
}

/** Logo i krój nagłówków z brandbooka domyślnej firmy (podgląd okładki jak w oknie kategorii CRM). */
async function brandPreview(ctx: NativeContext) {
  const { data: company } = await ctx.supabase.from('my_companies').select('id, logo_url')
    .eq('is_active', true).eq('is_default', true).limit(1).maybeSingle();
  if (!company) return { logoUrl: null, headingFontUrl: null };
  const [{ data: logos }, { data: font }] = await Promise.all([
    ctx.supabase.from('company_brandbook_logos').select('url, is_default, order_index').eq('company_id', (company as Row).id)
      .order('is_default', { ascending: false }).order('order_index'),
    ctx.supabase.from('company_brandbook_fonts').select('file_url, storage_path').eq('company_id', (company as Row).id)
      .eq('role', 'heading').order('order_index').limit(1).maybeSingle(),
  ]);
  const publicUrl = (path: string) => ctx.supabase.storage.from('company-logos').getPublicUrl(path).data.publicUrl;
  const logo = ((logos || []) as Row[]).find((row) => row.is_default)?.url || (logos as Row[] | null)?.[0]?.url || (company as Row).logo_url;
  const fontRow = font as Row | null;
  return {
    logoUrl: logo ? (/^https?:\/\//i.test(logo) ? logo : publicUrl(logo)) : null,
    headingFontUrl: fontRow ? fontRow.file_url || (fontRow.storage_path ? publicUrl(fontRow.storage_path) : null) : null,
  };
}

/**
 * Karty Prezentacji do wyboru jako rozdziały oferty (dział, tytuł, czy włączona) — według kolejności działów i kart.
 * Bez dostępu do Prezentacji albo bez migracji — pusta lista (rozdziały wybrane wcześniej zostają w kategorii).
 */
async function showcaseChapterCards(ctx: NativeContext) {
  const [items, sections] = await Promise.all([
    ctx.supabase.from('sales_showcase_items').select('id, title, section_id, is_active, sort_order').order('sort_order').order('title'),
    ctx.supabase.from('sales_showcase_sections').select('id, title, sort_order').order('sort_order').order('title'),
  ]);
  if (items.error || sections.error) return [];
  const order = new Map(((sections.data || []) as Row[]).map((row, index) => [String(row.id), { index, title: text(row.title) }]));
  return ((items.data || []) as Row[])
    .map((row) => ({
      id: String(row.id),
      title: text(row.title) || 'Karta bez tytułu',
      section: order.get(String(row.section_id))?.title || 'Bez działu',
      active: row.is_active !== false,
      sectionIndex: order.get(String(row.section_id))?.index ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.sectionIndex - b.sectionIndex)
    .map((card) => ({ id: card.id, title: card.title, section: card.section, active: card.active }));
}

/** Lista „Projekt oferty PDF”: kategorie z wyglądem i zdjęciem hero, przypisania kategorii wydarzeń, szablony stron. */
export async function offerTemplatesState(ctx: NativeContext) {
  const [categoriesRes, templatesRes, eventCategoriesRes, brand, showcaseCards] = await Promise.all([
    ctx.supabase.from('offer_template_categories').select('*').order('is_default', { ascending: false }).order('name'),
    ctx.supabase.from('offer_page_templates')
      .select('id, type, name, description, is_default, is_active, pdf_url, pdf_width, pdf_height, template_category_id, variant_key, text_fields_config, table_config, created_at')
      .order('is_default', { ascending: false }).order('name'),
    ctx.supabase.from('event_categories').select('id, name, default_offer_template_category_id').eq('is_active', true).order('name'),
    brandPreview(ctx),
    showcaseChapterCards(ctx),
  ]);
  if (categoriesRes.error) fail('Błąd podczas ładowania kategorii');
  if (templatesRes.error) fail(templatesRes.error.message || 'Błąd pobierania szablonów');
  const categories = (categoriesRes.data || []) as Row[];
  const heroPaths = categories.map((row) => row.hero_image_path).filter(Boolean);
  const heroUrls = new Map<string, string>();
  if (heroPaths.length) {
    const { data } = await ctx.supabase.storage.from(BUCKET).createSignedUrls(heroPaths, 3600);
    (data || []).forEach((item: Row) => { if (item?.path && item?.signedUrl) heroUrls.set(String(item.path), String(item.signedUrl)); });
  }
  const eventCategories = (eventCategoriesRes.data || []) as Row[];
  return {
    ...access(ctx),
    defaults: DEFAULT_CATEGORY_DESIGN,
    brand,
    showcaseCards,
    categories: categories.map((row) => ({
      id: String(row.id),
      name: text(row.name),
      description: text(row.description),
      isDefault: row.is_default === true,
      color: HEX.test(text(row.color)) ? text(row.color) : '#d3bb73',
      heroPath: row.hero_image_path || null,
      heroUrl: row.hero_image_path ? heroUrls.get(String(row.hero_image_path)) || null : null,
      heroAlt: text(row.hero_image_alt),
      // Typy i zakresy jak w zapisie — Mac dekoduje wygląd bez ryzyka błędnych wartości zapisanych wcześniej.
      design: normalizeDesign(row.design_config, {}),
      eventCategories: eventCategories.filter((item) => item.default_offer_template_category_id === row.id).map((item) => text(item.name)),
    })),
    templates: ((templatesRes.data || []) as Row[]).map((row) => ({
      id: String(row.id),
      type: text(row.type),
      name: text(row.name),
      description: text(row.description),
      isDefault: row.is_default === true,
      isActive: row.is_active !== false,
      pdfPath: row.pdf_url || null,
      pdfWidth: Number(row.pdf_width) || 595,
      pdfHeight: Number(row.pdf_height) || 842,
      categoryId: row.template_category_id || null,
      variantKey: VARIANTS.includes(row.variant_key) ? row.variant_key : 'default',
      fieldCount: Array.isArray(row.text_fields_config) ? row.text_fields_config.length : 0,
    })),
  };
}

const IMAGE_TYPES: Array<{ type: string; extension: string; test: (bytes: Buffer) => boolean }> = [
  { type: 'image/png', extension: 'png', test: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/jpeg', extension: 'jpg', test: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { type: 'image/webp', extension: 'webp', test: (bytes) => bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' },
];

/** Kategoria: nowa albo zmiana; zdjęcie hero (Mac zmniejsza do 1800 px) albo jego usunięcie. */
export async function saveOfferTemplateCategory(ctx: NativeContext, body: Row) {
  if (!access(ctx).canEditCategories) fail('Nie masz uprawnień do zmiany kategorii szablonów.');
  const name = text(body.name).trim().slice(0, 120);
  if (!name) fail('Podaj nazwę kategorii');
  const color = HEX.test(text(body.color)) ? text(body.color).toLowerCase() : '#d3bb73';
  const heroAlt = text(body.heroAlt).trim().slice(0, 300);
  let current: Row | null = null;
  if (body.id) {
    const id = uuid(body.id, 'Nie znaleziono kategorii.');
    const { data } = await ctx.supabase.from('offer_template_categories').select('id, design_config, hero_image_path').eq('id', id).maybeSingle();
    if (!data) fail('Nie znaleziono kategorii.');
    current = data as Row;
  }
  const hero = body.hero && typeof body.hero === 'object' ? body.hero as Row : null;
  let bytes: Buffer | null = null;
  let kind: (typeof IMAGE_TYPES)[number] | undefined;
  if (typeof hero?.data === 'string' && hero.data) {
    bytes = Buffer.from(hero.data, 'base64');
    if (!bytes.length || bytes.length > 12 * 1024 * 1024) fail('Zdjęcie może mieć maksymalnie 12 MB');
    kind = IMAGE_TYPES.find((item) => item.test(bytes!));
    if (!kind) fail('Wybierz zdjęcie JPG, PNG lub WEBP');
  }
  const fields = {
    name,
    description: text(body.description).slice(0, 2000),
    color,
    is_default: body.isDefault === true,
    hero_image_alt: heroAlt || null,
    design_config: normalizeDesign(body.design, current?.design_config),
  };
  let id = current ? String(current.id) : '';
  if (current) {
    const { data, error } = await ctx.supabase.from('offer_template_categories').update(fields).eq('id', id).select('id').maybeSingle();
    if (error) fail(error.message || 'Błąd zapisu kategorii');
    if (!data) fail('Nie masz uprawnień do zmiany tej kategorii.');
  } else {
    const { data, error } = await ctx.supabase.from('offer_template_categories').insert(fields).select('id').single();
    if (error || !data) fail(error?.message || 'Błąd zapisu kategorii');
    id = String((data as Row).id);
  }
  if (bytes && kind) {
    const path = `category-heroes/${id}/hero-${Date.now()}.${kind.extension}`;
    const { error: uploadError } = await ctx.supabase.storage.from(BUCKET).upload(path, bytes, { contentType: kind.type, upsert: true });
    if (uploadError) fail(uploadError.message || 'Nie udało się wysłać zdjęcia hero.');
    const { error } = await ctx.supabase.from('offer_template_categories').update({ hero_image_path: path, hero_image_alt: heroAlt || null }).eq('id', id);
    if (error) fail(error.message || 'Nie udało się zapisać zdjęcia hero.');
  } else if (hero?.remove === true) {
    const { error } = await ctx.supabase.from('offer_template_categories').update({ hero_image_path: null, hero_image_alt: null }).eq('id', id);
    if (error) fail(error.message || 'Nie udało się usunąć zdjęcia hero.');
  }
  return { ...(await offerTemplatesState(ctx)), savedId: id, message: current ? 'Kategoria zaktualizowana' : 'Kategoria utworzona' };
}

/** „Nowy szablon” (`CreateTemplateModal`): szablon strony z domyślnymi sekcjami. */
export async function createOfferPageTemplate(ctx: NativeContext, body: Row) {
  if (!access(ctx).canEditTemplates) fail('Nie masz uprawnień do tworzenia szablonów.');
  const categoryId = uuid(body.categoryId, 'Nie wybrano kategorii');
  const type = text(body.type);
  if (!(TEMPLATE_TYPES as readonly string[]).includes(type)) fail('Wybierz etap dokumentu.');
  const name = text(body.name).trim().slice(0, 200);
  if (!name) fail('Podaj nazwę szablonu');
  const { data: template, error } = await ctx.supabase.from('offer_page_templates').insert({
    type,
    name,
    description: text(body.description).slice(0, 2000),
    variant_key: type === 'product' && VARIANTS.includes(body.variantKey) ? body.variantKey : 'default',
    is_default: body.isDefault === true,
    is_active: body.isActive !== false,
    template_category_id: categoryId,
    created_by: ctx.employee.id,
  }).select('id').single();
  if (error || !template) fail(error?.message || 'Błąd tworzenia szablonu');
  const templateId = String((template as Row).id);
  const { error: sectionsError } = await ctx.supabase.from('offer_page_template_content').insert(SECTION_TYPES[type].map((section, index) => ({
    template_id: templateId, section_type: section, content_html: '', content_json: {}, display_order: index, styles: {},
  })));
  if (sectionsError) {
    await ctx.supabase.from('offer_page_templates').delete().eq('id', templateId);
    fail(sectionsError.message || 'Błąd tworzenia szablonu');
  }
  return { ...(await offerTemplatesState(ctx)), message: 'Szablon utworzony' };
}

export async function deleteOfferPageTemplate(ctx: NativeContext, body: Row) {
  if (!access(ctx).canDeleteTemplates) fail('Usuwać szablony może administrator.');
  const id = uuid(body.id, 'Nie znaleziono szablonu.');
  const { data, error } = await ctx.supabase.from('offer_page_templates').delete().eq('id', id).select('id');
  if (error) fail(error.message || 'Błąd usuwania szablonu');
  if (!data?.length) fail('Nie masz uprawnień do usunięcia tego szablonu.');
  return { ...(await offerTemplatesState(ctx)), message: 'Szablon usunięty' };
}

async function pageTemplate(ctx: NativeContext, value: unknown) {
  const id = uuid(value, 'Nie znaleziono szablonu.');
  const { data } = await ctx.supabase.from('offer_page_templates').select('id, type, pdf_url').eq('id', id).maybeSingle();
  if (!data) fail('Nie znaleziono szablonu.');
  return data as Row;
}

/** „Własne tło” / „Zmień tło”: PDF strony (wymiary pierwszej strony liczy Mac) — gotowy układ Mavinci zostaje zastąpiony. */
export async function uploadOfferTemplateBackground(ctx: NativeContext, body: Row) {
  if (!access(ctx).canEditTemplates) fail('Nie masz uprawnień do zmiany szablonów.');
  const template = await pageTemplate(ctx, body.id);
  const bytes = Buffer.from(text(body.data), 'base64');
  if (!bytes.length || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') fail('Wybierz plik PDF');
  if (bytes.length > 12 * 1024 * 1024) fail('Plik PDF może mieć maksymalnie 12 MB');
  const size = (value: unknown) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) && number >= 50 && number <= 5000 ? number : null;
  };
  const width = size(body.width);
  const height = size(body.height);
  const path = `${template.type}_${template.id}_${Date.now()}.pdf`;
  const { error: uploadError } = await ctx.supabase.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: true });
  if (uploadError) fail(uploadError.message || 'Błąd uploadu PDF');
  const patch: Row = { pdf_url: path };
  if (width && height) Object.assign(patch, { pdf_width: width, pdf_height: height });
  const { data, error } = await ctx.supabase.from('offer_page_templates').update(patch).eq('id', template.id).select('id').maybeSingle();
  if (error || !data) {
    await ctx.supabase.storage.from(BUCKET).remove([path]);
    fail(error?.message || 'Nie masz uprawnień do zmiany tego szablonu.');
  }
  return { ...(await offerTemplatesState(ctx)), message: 'Plik PDF zapisany' };
}

/** „Wróć do Mavinci”: usunięcie własnego tła PDF. */
export async function deleteOfferTemplateBackground(ctx: NativeContext, body: Row) {
  if (!access(ctx).canEditTemplates) fail('Nie masz uprawnień do zmiany szablonów.');
  const template = await pageTemplate(ctx, body.id);
  const path = text(template.pdf_url);
  if (!path) return { ...(await offerTemplatesState(ctx)), message: 'Szablon używa gotowego układu Mavinci' };
  const { data, error } = await ctx.supabase.from('offer_page_templates').update({ pdf_url: null }).eq('id', template.id).select('id').maybeSingle();
  if (error || !data) fail(error?.message || 'Nie masz uprawnień do zmiany tego szablonu.');
  await ctx.supabase.storage.from(BUCKET).remove([path]);
  return { ...(await offerTemplatesState(ctx)), message: 'Plik PDF usunięty' };
}

// MARK: Część F2 — „Rozmieść dane” na tle PDF i „Tabela wyceny”

/** Pola danych CRM do rozmieszczenia na tle (jak `AVAILABLE_FIELDS` w CRM). */
export const TEMPLATE_FIELDS: Array<{ value: string; label: string; type: 'text' | 'image' | 'email' | 'phone' }> = [
  { value: 'client_name', label: 'Nazwa klienta', type: 'text' },
  { value: 'organization_name', label: 'Organizacja: nazwa / alias', type: 'text' },
  { value: 'organization_legal_name', label: 'Organizacja: pełna nazwa prawna', type: 'text' },
  { value: 'contact_person_name', label: 'Osoba kontaktowa: imię i nazwisko', type: 'text' },
  { value: 'contact_person_email', label: 'Osoba kontaktowa: e-mail', type: 'email' },
  { value: 'contact_person_phone', label: 'Osoba kontaktowa: telefon', type: 'phone' },
  { value: 'client_address', label: 'Adres klienta', type: 'text' },
  { value: 'client_nip', label: 'NIP klienta', type: 'text' },
  { value: 'client_city', label: 'Miasto klienta', type: 'text' },
  { value: 'client_postal_code', label: 'Kod pocztowy klienta', type: 'text' },
  { value: 'client_street', label: 'Ulica klienta', type: 'text' },
  { value: 'offer_number', label: 'Numer oferty', type: 'text' },
  { value: 'offer_name', label: 'Nazwa oferty', type: 'text' },
  { value: 'offer_date', label: 'Data oferty', type: 'text' },
  { value: 'event_name', label: 'Nazwa eventu', type: 'text' },
  { value: 'event_category_name', label: 'Kategoria eventu', type: 'text' },
  { value: 'event_date', label: 'Data eventu', type: 'text' },
  { value: 'event_location', label: 'Lokalizacja eventu', type: 'text' },
  { value: 'event_assumptions', label: 'Założenia eventu', type: 'text' },
  { value: 'event_goal', label: 'Cel eventu', type: 'text' },
  { value: 'category_hero_image', label: 'Kategoria: zdjęcie hero', type: 'image' },
  { value: 'company_logo', label: 'Firma: logo z my_companies', type: 'image' },
  { value: 'product_name', label: 'Produkt: nazwa', type: 'text' },
  { value: 'product_short_description', label: 'Produkt: krótki opis', type: 'text' },
  { value: 'product_description', label: 'Produkt: opis do oferty', type: 'text' },
  { value: 'product_benefits', label: 'Produkt: lista korzyści', type: 'text' },
  { value: 'product_image', label: 'Produkt: grafika', type: 'image' },
  { value: 'product_quantity', label: 'Pozycja: ilość', type: 'text' },
  { value: 'product_unit', label: 'Pozycja: jednostka', type: 'text' },
  { value: 'product_unit_price', label: 'Pozycja: cena jednostkowa', type: 'text' },
  { value: 'product_total', label: 'Pozycja: wartość', type: 'text' },
  { value: 'product_1_name', label: 'Kompaktowy 1: nazwa', type: 'text' },
  { value: 'product_1_short_description', label: 'Kompaktowy 1: lead', type: 'text' },
  { value: 'product_1_description', label: 'Kompaktowy 1: opis', type: 'text' },
  { value: 'product_1_image', label: 'Kompaktowy 1: zdjęcie', type: 'image' },
  { value: 'product_2_name', label: 'Kompaktowy 2: nazwa', type: 'text' },
  { value: 'product_2_short_description', label: 'Kompaktowy 2: lead', type: 'text' },
  { value: 'product_2_description', label: 'Kompaktowy 2: opis', type: 'text' },
  { value: 'product_2_image', label: 'Kompaktowy 2: zdjęcie', type: 'image' },
  { value: 'product_3_name', label: 'Kompaktowy 3: nazwa', type: 'text' },
  { value: 'product_3_short_description', label: 'Kompaktowy 3: lead', type: 'text' },
  { value: 'product_3_description', label: 'Kompaktowy 3: opis', type: 'text' },
  { value: 'product_3_image', label: 'Kompaktowy 3: zdjęcie', type: 'image' },
  { value: 'total_price', label: 'Całkowita cena', type: 'text' },
  { value: 'employee_first_name', label: 'Imię pracownika', type: 'text' },
  { value: 'employee_last_name', label: 'Nazwisko pracownika', type: 'text' },
  { value: 'employee_full_name', label: 'Imię i nazwisko pracownika', type: 'text' },
  { value: 'employee_email', label: 'Email pracownika', type: 'text' },
  { value: 'employee_phone', label: 'Telefon pracownika', type: 'text' },
  { value: 'employee_avatar_url', label: 'Avatar pracownika', type: 'image' },
  { value: 'seller_name', label: 'Nazwa sprzedawcy', type: 'text' },
  { value: 'seller_address', label: 'Adres sprzedawcy', type: 'text' },
  { value: 'seller_nip', label: 'NIP sprzedawcy', type: 'text' },
];

/** Wygląd tabeli wyceny (jak `DEFAULT_CONFIG` w `PricingTableConfigEditor`). */
export const DEFAULT_TABLE_CONFIG = {
  start_y: 200, margin_left: 50, margin_right: 50,
  header_color: '#d3bb73', header_text_color: '#ffffff', row_bg_color: '#f2f2f2', row_odd_bg_color: '#ffffff', text_color: '#1c1f33',
  border_color: '#cccccc', border_width: 0.5, show_borders: false, show_horizontal_borders: true, show_vertical_borders: false, show_outer_border: false,
  header_font_size: 11, body_font_size: 10, row_height: 25, header_height: 30, summary_color: '#d3bb73', summary_label_color: '#1c1f33',
  show_unit_price_net: true, show_value_net: true, show_value_gross: true, show_vat_column: false, show_description: false, vat_rate: 23,
  col_lp_width: 30, col_name_width: 0, col_qty_width: 50, col_unit_width: 45, col_unit_price_width: 70, col_vat_width: 45,
  col_value_net_width: 80, col_value_gross_width: 80, summary_separator_thickness: 2, table_width: 0,
};
type TableConfig = typeof DEFAULT_TABLE_CONFIG;
const TABLE_COLORS = ['header_color', 'header_text_color', 'row_bg_color', 'row_odd_bg_color', 'text_color', 'border_color', 'summary_color', 'summary_label_color'] as const;
const TABLE_FLAGS = ['show_borders', 'show_horizontal_borders', 'show_vertical_borders', 'show_outer_border', 'show_unit_price_net', 'show_value_net',
  'show_value_gross', 'show_vat_column', 'show_description'] as const;
const LAYOUT_KEYS = ['_layout_x', '_layout_y', '_layout_width', '_layout_height'];

const objectOf = (value: unknown): Row => (value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {});
const finite = (value: unknown, fallback: number, min = -10000, max = 10000) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

/** Tabela z bazy uzupełniona domyślnymi wartościami (jak `{ ...DEFAULT_CONFIG, ...initialConfig }`). */
function tableView(raw: unknown): TableConfig & Row {
  const source = { ...DEFAULT_TABLE_CONFIG, ...objectOf(raw) } as Row;
  const result: Row = { ...source };
  for (const key of Object.keys(DEFAULT_TABLE_CONFIG) as Array<keyof TableConfig>) {
    const fallback = DEFAULT_TABLE_CONFIG[key];
    if (typeof fallback === 'number') result[key] = finite(source[key], fallback);
    else if (typeof fallback === 'boolean') result[key] = typeof source[key] === 'boolean' ? source[key] : fallback;
    else result[key] = HEX.test(text(source[key])) ? text(source[key]) : fallback;
  }
  return result as TableConfig & Row;
}

/** Wygląd tabeli z Maca: znane pola (kolory, przełączniki, liczby); układ na tle (`_layout_*`) zostaje z bazy. */
function normalizeTable(input: unknown, current: unknown) {
  const raw = objectOf(input);
  const base = tableView(current);
  const next: Row = { ...base };
  for (const key of TABLE_COLORS) if (raw[key] != null) next[key] = HEX.test(text(raw[key])) ? text(raw[key]).toLowerCase() : base[key];
  for (const key of TABLE_FLAGS) if (raw[key] != null) next[key] = raw[key] === true;
  for (const key of Object.keys(DEFAULT_TABLE_CONFIG) as Array<keyof TableConfig>) {
    if (typeof DEFAULT_TABLE_CONFIG[key] === 'number' && raw[key] != null) next[key] = finite(raw[key], base[key] as number, 0, 5000);
  }
  return next;
}

const FIELD_NAMES = new Map(TEMPLATE_FIELDS.map((field) => [field.value, field]));

/**
 * Pole na tle (`TextFieldConfig`). Generator PDF obsługuje też pola i klucze spoza listy edytora (np. `page_number`,
 * `font_role`, `cta_button`, `image_fit`) — zostają bez zmian; poprawiane są tylko liczby, kolor i wyrównanie.
 */
function normalizeField(input: unknown) {
  const raw = objectOf(input);
  const name = text(raw.field_name).trim();
  if (!/^[a-z0-9_]{1,80}$/i.test(name)) return null;
  const field: Row = {
    ...raw,
    field_name: name,
    label: text(raw.label).slice(0, 160) || FIELD_NAMES.get(name)?.label || name,
    x: finite(raw.x, 50),
    y: finite(raw.y, 50),
  };
  for (const key of ['font_size', 'max_width', 'width', 'height', 'border_radius', 'line_height']) {
    if (raw[key] == null || raw[key] === '') { delete field[key]; continue; }
    const number = Number(raw[key]);
    if (Number.isFinite(number) && number > 0) field[key] = number; else delete field[key];
  }
  if (field.font_color != null && !HEX.test(text(field.font_color))) delete field.font_color;
  if (field.align != null && !['left', 'center', 'right'].includes(field.align)) delete field.align;
  if (field.type != null && typeof field.type !== 'string') delete field.type;
  return field;
}

async function editableTemplate(ctx: NativeContext, value: unknown) {
  if (!access(ctx).canEditTemplates) fail('Nie masz uprawnień do zmiany szablonów.');
  const id = uuid(value, 'Nie znaleziono szablonu.');
  const { data } = await ctx.supabase.from('offer_page_templates')
    .select('id, name, type, pdf_url, pdf_width, pdf_height, text_fields_config, table_config').eq('id', id).maybeSingle();
  if (!data) fail('Nie znaleziono szablonu.');
  return data as Row;
}

/** „Rozmieść dane” / „Tabela wyceny”: tło PDF (podpisany adres), pola, układ i wygląd tabeli, lista pól danych CRM. */
export async function offerTemplateEditor(ctx: NativeContext, id: string) {
  const template = await editableTemplate(ctx, id);
  let pdfUrl: string | null = null;
  if (template.pdf_url) {
    const { data } = await ctx.supabase.storage.from(BUCKET).createSignedUrl(String(template.pdf_url), 3600);
    pdfUrl = data?.signedUrl || null;
  }
  const table = tableView(template.table_config);
  const raw = objectOf(template.table_config);
  return {
    id: String(template.id),
    name: text(template.name),
    type: text(template.type),
    pdfUrl,
    pdfWidth: Number(template.pdf_width) || 595,
    pdfHeight: Number(template.pdf_height) || 842,
    fields: (Array.isArray(template.text_fields_config) ? template.text_fields_config : []).map(normalizeField).filter(Boolean),
    table,
    tableLayout: raw._layout_x != null
      ? { x: finite(raw._layout_x, 50), y: finite(raw._layout_y, 200), width: finite(raw._layout_width, 495) || 495, height: finite(raw._layout_height, 200) || 200 }
      : null,
    available: TEMPLATE_FIELDS,
    defaults: DEFAULT_TABLE_CONFIG,
  };
}

/** „Zapisz konfigurację” (`handleSaveAll`): pola na tle; przy wycenie — położenie tabeli (wygląd tabeli z bazy zostaje). */
export async function saveOfferTemplateFields(ctx: NativeContext, body: Row) {
  const template = await editableTemplate(ctx, body.id);
  const fields = (Array.isArray(body.fields) ? body.fields : []).slice(0, 200).map(normalizeField).filter(Boolean);
  const patch: Row = { text_fields_config: fields };
  const width = Math.round(Number(body.pdfWidth));
  const height = Math.round(Number(body.pdfHeight));
  const pageWidth = width >= 50 && width <= 5000 ? width : Number(template.pdf_width) || 595;
  if (width >= 50 && width <= 5000 && height >= 50 && height <= 5000) Object.assign(patch, { pdf_width: width, pdf_height: height });
  if (template.type === 'pricing') {
    const table: Row = { ...objectOf(template.table_config) };
    const layout = body.table && typeof body.table === 'object' ? body.table as Row : null;
    if (layout) {
      const x = Math.round(finite(layout.x, 50, 0, 5000));
      const y = Math.round(finite(layout.y, 200, 0, 5000));
      const w = Math.round(finite(layout.width, 495, 200, 5000));
      const h = Math.round(finite(layout.height, 200, 80, 5000));
      Object.assign(table, { _layout_x: x, _layout_y: y, _layout_width: w, _layout_height: h, start_y: y, margin_left: x, margin_right: pageWidth - x - w });
    } else {
      LAYOUT_KEYS.forEach((key) => delete table[key]);
    }
    patch.table_config = table;
  }
  const { data, error } = await ctx.supabase.from('offer_page_templates').update(patch).eq('id', template.id).select('id').maybeSingle();
  if (error || !data) fail(error?.message || 'Nie masz uprawnień do zmiany tego szablonu.');
  return { ...(await offerTemplatesState(ctx)), message: 'Konfiguracja zapisana' };
}

/** „Zapisz tabelę” (`PricingTableConfigEditor`): wygląd tabeli wyceny; położenie na tle zostaje. */
export async function saveOfferTemplateTable(ctx: NativeContext, body: Row) {
  const template = await editableTemplate(ctx, body.id);
  const table = { ...objectOf(template.table_config), ...normalizeTable(body.config, template.table_config) };
  const { data, error } = await ctx.supabase.from('offer_page_templates').update({ table_config: table }).eq('id', template.id).select('id').maybeSingle();
  if (error || !data) fail(error?.message || 'Nie masz uprawnień do zmiany tego szablonu.');
  return { ...(await offerTemplatesState(ctx)), message: 'Konfiguracja tabeli zapisana', table: tableView(table) };
}
