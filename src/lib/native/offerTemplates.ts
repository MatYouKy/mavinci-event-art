import 'server-only';
import type { NativeContext } from './auth';
import { fail } from './offers';

/*
 * Oferty na Macu — „Szablony ofert” (`/crm/offers?tab=templates`, `OfferPageTemplatesEditor`), część F1: kategorie szablonów
 * (nazwa, opis, kolor, domyślna, zdjęcie hero, kreator wyglądu: kolory, hero, logo, układ założeń i wyceny, strony „Informacje
 * i warunki” oraz wymagań), przypisania kategorii wydarzeń, szablony stron (5 etapów dokumentu, wariant karty produktu),
 * własne tło PDF i powrót do gotowego układu Mavinci. Te same tabele i ten sam magazyn plików co CRM (RLS tokenem pracownika).
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
};
type Design = typeof DEFAULT_CATEGORY_DESIGN;

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
    pricing_style: ['card', 'minimal'].includes(raw.pricing_style) ? raw.pricing_style : base.pricing_style,
    info_page_enabled: raw.info_page_enabled == null ? base.info_page_enabled : raw.info_page_enabled === true,
    info_page_title: line('info_page_title', 120),
    order_process_text: line('order_process_text', 4000),
    requirements_page_enabled: raw.requirements_page_enabled == null ? base.requirements_page_enabled : raw.requirements_page_enabled === true,
    requirements_page_title: line('requirements_page_title', 120),
    requirements_page_subtitle: line('requirements_page_subtitle', 500),
    technical_requirements_text: line('technical_requirements_text', 6000),
    reservation_terms_text: line('reservation_terms_text', 4000),
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

/** Lista „Projekt oferty PDF”: kategorie z wyglądem i zdjęciem hero, przypisania kategorii wydarzeń, szablony stron. */
export async function offerTemplatesState(ctx: NativeContext) {
  const [categoriesRes, templatesRes, eventCategoriesRes, brand] = await Promise.all([
    ctx.supabase.from('offer_template_categories').select('*').order('is_default', { ascending: false }).order('name'),
    ctx.supabase.from('offer_page_templates')
      .select('id, type, name, description, is_default, is_active, pdf_url, pdf_width, pdf_height, template_category_id, variant_key, text_fields_config, table_config, created_at')
      .order('is_default', { ascending: false }).order('name'),
    ctx.supabase.from('event_categories').select('id, name, default_offer_template_category_id').eq('is_active', true).order('name'),
    brandPreview(ctx),
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
