import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { can, type NativeContext } from './auth';
import {
  createDefaultContractDocumentStyles,
  isContractDocumentStylesTemplate,
  resolveContractDocumentStyles,
} from '@/lib/CRM/contracts/contractDocumentStyles';
import { resolveContractOptions } from '@/lib/CRM/contracts/contractConditions';
import { CONTRACT_PLACEHOLDER_GROUPS } from '@/lib/CRM/contracts/contractPlaceholderGroups';
import { CONTRACT_CLAUSE_SLOTS } from '@/lib/CRM/contracts/contractClauseSlots';
import { SYSTEM_FONTS } from '@/lib/CRM/systemFonts';

/*
 * Umowy z klientami na Macu — strony `/crm/contracts` (lista umów) i `/crm/contract-templates` (szablony): te same dane
 * i zasady co w CRM (RLS tokenem pracownika). Umowa wydarzenia otwiera się na Macu w zakładce „Umowa” wydarzenia;
 * tu: lista, podgląd PDF i podsumowanie. Szablony: lista z podsumowaniem treści (format, strony, warunki, opcje, pola,
 * kategorie i umowy, które z nich korzystają) oraz czynności z listy w CRM — nowy, nazwa i opis, aktywny, duplikat, usunięcie.
 */

type Row = Record<string, any>;
export const CONTRACT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fail(message: string): never {
  throw new Error(message);
}

/** Uprawnienia jak `canManageModule('contracts')` / `canCreateInModule('contracts')` w CRM. */
export const contractsAccess = (ctx: NativeContext) => ({
  canView: can(ctx.employee, 'contracts_view') || can(ctx.employee, 'contracts_manage'),
  canManage: can(ctx.employee, 'contracts_manage'),
  canCreate: can(ctx.employee, 'contracts_create') || can(ctx.employee, 'contracts_manage'),
});

const personName = (row: Row | null | undefined) =>
  row ? String(row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' ')).trim() : '';
const one = (value: unknown): Row | null => {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === 'object' ? row as Row : null;
};

/** Podsumowanie treści szablonu bez składania dokumentu (to robi edytor). */
function templateSummary(template: Row) {
  const settings: Row = template.page_settings && typeof template.page_settings === 'object' ? template.page_settings : {};
  const flow = typeof settings.flowContent === 'string'
    ? settings.flowContent
    : Array.isArray(settings.pages) ? settings.pages.join('') : String(template.content_html || '');
  const fields = new Set(Array.from(flow.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g), (match) => match[1]));
  return {
    format: isContractDocumentStylesTemplate(settings) ? 'word' : 'legacy',
    // Zapis z Maca nie dzieli treści na strony (jedna „strona” = cała treść) — wtedy liczbę stron poda dopiero CRM.
    pages: Array.isArray(settings.pages) && !(settings.pages.length === 1 && settings.pages[0] === flow) ? settings.pages.length : 0,
    conditions: (flow.match(/data-contract-if=/g) || []).length,
    options: resolveContractOptions(settings).map((option) => option.label),
    fields: fields.size,
  };
}

export async function contractsState(ctx: NativeContext) {
  const s = ctx.supabase;
  const access = contractsAccess(ctx);
  const [contractsRes, templatesRes, categoriesRes] = await Promise.all([
    s.from('contracts').select(
      'id, contract_number, title, status, version_number, created_at, updated_at, issued_at, sent_at, accepted_at, signed_by_client_at, '
      + 'signed_returned_at, cancelled_at, generated_pdf_path, generated_pdf_at, modified_after_generation, locked_at, company_signed_at, '
      + 'template_id, event_id, client:contacts!client_id(full_name, first_name, last_name)',
    ).order('created_at', { ascending: false }),
    s.from('contract_templates').select('id, name, description, is_active, created_at, updated_at, page_settings, content_html').order('name'),
    s.from('event_categories').select('name, contract_template_id').not('contract_template_id', 'is', null),
  ]);
  if (contractsRes.error) throw contractsRes.error;
  if (templatesRes.error) throw templatesRes.error;
  const contractRows = (contractsRes.data || []) as Row[];
  const templateRows = (templatesRes.data || []) as Row[];

  const eventIds = Array.from(new Set(contractRows.map((row) => row.event_id).filter((id): id is string => typeof id === 'string')));
  const events = new Map<string, Row>();
  if (eventIds.length) {
    const { data } = await s.from('events')
      .select('id, name, event_date, organizations:organizations!events_organization_id_fkey(name, alias)')
      .in('id', eventIds);
    ((data || []) as Row[]).forEach((row) => events.set(String(row.id), row));
  }
  const templateNames = new Map(templateRows.map((row) => [String(row.id), String(row.name || '')]));
  const categories = new Map<string, string[]>();
  ((categoriesRes.data || []) as Row[]).forEach((row) => {
    const key = String(row.contract_template_id);
    categories.set(key, [...(categories.get(key) || []), String(row.name || '')].filter(Boolean));
  });
  const usage = new Map<string, number>();
  contractRows.forEach((row) => { if (row.template_id) usage.set(row.template_id, (usage.get(row.template_id) || 0) + 1); });

  const contracts = contractRows.map((row) => {
    const event = row.event_id ? events.get(String(row.event_id)) || null : null;
    const organization = one(event?.organizations);
    const statusDate = ({
      issued: row.issued_at, sent: row.sent_at, accepted: row.accepted_at, signed_by_client: row.signed_by_client_at,
      signed_returned: row.signed_returned_at, cancelled: row.cancelled_at,
    } as Row)[row.status] ?? null;
    return {
      id: String(row.id),
      number: row.contract_number ?? null,
      title: String(row.title || ''),
      status: String(row.status || 'draft'),
      statusAt: statusDate,
      version: Number(row.version_number || 1),
      createdAt: row.created_at ?? null,
      client: organization ? String(organization.alias || organization.name || '').trim() || null : personName(one(row.client)) || null,
      event: event ? { id: String(event.id), name: String(event.name || ''), date: event.event_date ?? null } : null,
      eventId: row.event_id ?? null,
      template: row.template_id ? templateNames.get(String(row.template_id)) || null : null,
      pdf: Boolean(row.generated_pdf_path),
      pdfAt: row.generated_pdf_at ?? null,
      modified: row.modified_after_generation === true,
      locked: Boolean(row.locked_at),
      companySigned: Boolean(row.company_signed_at),
    };
  });

  const templates = templateRows.map((row) => ({
    id: String(row.id),
    name: String(row.name || ''),
    description: row.description ?? null,
    active: row.is_active !== false,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    categories: categories.get(String(row.id)) || [],
    contracts: usage.get(String(row.id)) || 0,
    ...templateSummary(row),
  }));

  const payload = { ...access, isAdmin: ctx.employee.isAdmin, contracts, templates };
  return { ...payload, hash: createHash('sha1').update(JSON.stringify(payload)).digest('hex') };
}

/**
 * Treść szablonu dla edytora na Macu: HTML treści (jak w edytorze CRM: `flowContent` albo `content_html`), style
 * dokumentu z uzupełnionymi brakami, opcje umowy oraz nazwy pól (`{{…}}`) i miejsc na klauzule z menu „Wstaw”.
 */
export async function contractTemplateDocument(ctx: NativeContext, id: string) {
  const { data, error } = await ctx.supabase.from('contract_templates')
    .select('id, name, updated_at, page_settings, content_html').eq('id', templateId(id)).maybeSingle();
  if (error || !data) fail('Nie znaleziono szablonu.');
  const template = data as Row;
  const settings: Row = template.page_settings && typeof template.page_settings === 'object' ? template.page_settings : {};
  const html = typeof settings.flowContent === 'string' && settings.flowContent.trim()
    ? settings.flowContent
    : Array.isArray(settings.pages) && settings.pages.length ? settings.pages.join('') : String(template.content_html || '');
  const [assets, footers] = await Promise.all([brandAssets(ctx), footerTemplates(ctx)]);
  const fieldGroups = CONTRACT_PLACEHOLDER_GROUPS.map((group) => ({
    label: group.label,
    items: (group.items as ReadonlyArray<{ key: string; label: string }>).map((item) => ({ key: item.key.replace(/^\{\{|\}\}$/g, ''), label: item.label })),
  }));
  return {
    id: String(template.id),
    name: String(template.name || ''),
    updatedAt: template.updated_at ?? null,
    format: isContractDocumentStylesTemplate(settings) ? 'word' : 'legacy',
    html: normalizeParagraphNumbers(html),
    documentStyles: resolveContractDocumentStyles(settings.documentStyles),
    options: resolveContractOptions(settings),
    fieldGroups,
    slots: CONTRACT_CLAUSE_SLOTS.map((slot) => ({ name: slot.name, label: slot.label })),
    canEdit: contractsAccess(ctx).canManage,
    layout: layoutFrom(settings),
    brandLogos: assets.logos,
    fonts: assets.fonts,
    footerTemplates: footers,
  };
}

/** Zapisane szablony stopek (`footer_templates`) — domyślny pierwszy, potem alfabetycznie. */
async function footerTemplates(ctx: NativeContext) {
  const { data } = await ctx.supabase.from('footer_templates').select('*').order('is_default', { ascending: false }).order('name');
  return ((data || []) as Row[]).map((row) => ({
    id: String(row.id),
    name: String(row.name || ''),
    isDefault: row.is_default === true,
    companyName: String(row.company_name || ''),
    tagline: String(row.tagline || ''),
    website: String(row.website || ''),
    email: String(row.email || ''),
    phone: String(row.phone || ''),
    logoUrl: String(row.logo_url || ''),
    logoScale: Number(row.logo_scale) || 80,
  }));
}

/** Edytor stopek na Macu: nowy szablon stopki albo zmiana zapisanego (jak „Zapisz szablon stopki” w CRM). */
export async function saveFooterTemplate(ctx: NativeContext, body: Row) {
  if (!contractsAccess(ctx).canManage) fail('Nie masz uprawnień do zmiany szablonów umów.');
  const name = String(body.name ?? '').trim();
  if (!name) fail('Podaj nazwę szablonu stopki.');
  if (name.length > 120) fail('Nazwa szablonu stopki może mieć najwyżej 120 znaków.');
  const text = (value: unknown) => String(value ?? '').trim().slice(0, 300);
  const row = {
    name,
    company_name: text(body.companyName),
    tagline: text(body.tagline) || null,
    website: text(body.website),
    email: text(body.email),
    phone: text(body.phone),
    logo_url: safeLogo(body.logoUrl) || '',
    logo_scale: clamp(body.logoScale, 20, 150) ?? 80,
    updated_at: new Date().toISOString(),
  };
  let id: string;
  if (body.id) {
    if (typeof body.id !== 'string' || !CONTRACT_UUID.test(body.id)) fail('Nieprawidłowy szablon stopki.');
    const { data, error } = await ctx.supabase.from('footer_templates').update(row).eq('id', body.id).select('id');
    if (error) fail(error.message);
    changed(data, 'Nie znaleziono szablonu stopki.');
    id = body.id;
  } else {
    const { data, error } = await ctx.supabase.from('footer_templates').insert({ ...row, is_default: false }).select('id').single();
    if (error || !data) fail(error?.message || 'Nie udało się zapisać szablonu stopki.');
    id = String((data as Row).id);
  }
  return { ok: true, id, footerTemplates: await footerTemplates(ctx) };
}

export async function deleteFooterTemplate(ctx: NativeContext, body: Row) {
  if (!contractsAccess(ctx).canManage) fail('Nie masz uprawnień do zmiany szablonów umów.');
  if (typeof body.id !== 'string' || !CONTRACT_UUID.test(body.id)) fail('Nieprawidłowy szablon stopki.');
  const { data, error } = await ctx.supabase.from('footer_templates').delete().eq('id', body.id).select('id');
  if (error) fail(error.message);
  changed(data, 'Nie znaleziono szablonu stopki.');
  return { ok: true, footerTemplates: await footerTemplates(ctx) };
}

// MARK: Układ strony (logo w nagłówku, stopka) — jak zakładka „Układ” edytora CRM (`layoutFrom`)

const DEFAULT_LOGO = '/erulers_logo_vect.png';
const DEFAULT_FOOTER = {
  companyName: 'EVENT RULERS',
  tagline: 'Więcej niż Wodzireje!',
  website: 'www.eventrulers.pl',
  email: 'biuro@eventrulers.pl',
  phone: '698-212-279',
  logoUrl: DEFAULT_LOGO,
};
const FOOTER_KEYS = ['companyName', 'tagline', 'website', 'email', 'phone', 'logoUrl'] as const;

function layoutFrom(settings: Row) {
  const footer: Row = settings.footerContent && typeof settings.footerContent === 'object' ? settings.footerContent : {};
  return {
    selectedLogo: String(settings.selectedLogo || DEFAULT_LOGO),
    logoScale: Number(settings.logoScale ?? 80),
    logoPositionX: Number(settings.logoPositionX ?? 50),
    logoPositionY: Number(settings.logoPositionY ?? 0),
    selectedFooter: ['default', 'minimal', 'none'].includes(settings.selectedFooter) ? String(settings.selectedFooter) : 'default',
    selectedFooterTemplateId: typeof settings.selectedFooterTemplateId === 'string' ? settings.selectedFooterTemplateId : null,
    footerContent: Object.fromEntries(FOOTER_KEYS.map((key) => [key, String(footer[key] ?? DEFAULT_FOOTER[key] ?? '')])),
    footerLogoScale: Number(settings.footerLogoScale ?? 80),
  };
}

const publicLogoUrl = (value: string) =>
  /^https?:\/\//i.test(value) ? value : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/${value.replace(/^\/+/, '')}`;

/** Logotypy z brandbooków aktywnych firm (jak „Logo w nagłówku” w CRM) i czcionki dokumentu (marka + systemowe). */
async function brandAssets(ctx: NativeContext) {
  const [companiesRes, logosRes, fontsRes] = await Promise.all([
    ctx.supabase.from('my_companies').select('id, name, logo_url').eq('is_active', true).order('is_default', { ascending: false }),
    ctx.supabase.from('company_brandbook_logos').select('*').order('order_index'),
    ctx.supabase.from('company_brandbook_fonts').select('label, family').order('order_index'),
  ]);
  const logos: Array<{ url: string; label: string; companyName: string }> = [];
  ((companiesRes.data || []) as Row[]).forEach((company) => {
    const own = ((logosRes.data || []) as Row[]).filter((logo) => logo.company_id === company.id && logo.url);
    if (own.length) {
      own.forEach((logo) => logos.push({
        url: publicLogoUrl(String(logo.url)),
        label: `${logo.label || logo.variant || 'Logo'}${logo.use_for_print ? ' · do druku' : ''}`,
        companyName: String(company.name || ''),
      }));
    } else if (company.logo_url) {
      logos.push({ url: publicLogoUrl(String(company.logo_url)), label: 'Logo domyślne', companyName: String(company.name || '') });
    }
  });
  const fonts = [
    ...((fontsRes.data || []) as Row[]).filter((font) => font.family).map((font) => ({
      label: `${font.label || font.family} (marka)`, value: `${font.family}, sans-serif`,
    })),
    ...SYSTEM_FONTS.map((font) => ({ label: font.label, value: font.family })),
  ].filter((font, index, list) => list.findIndex((other) => other.value === font.value) === index);
  return { logos, fonts };
}

const LOGO_PATH = /^\/(?!\/)[\w\-./]{1,300}$/;
const safeLogo = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length <= 1000 && (/^https:\/\/[^\s"'<>]+$/i.test(text) || LOGO_PATH.test(text)) ? text : null;
};
const clamp = (value: unknown, min: number, max: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : undefined;
};

/** Ustawienia układu z edytora na Macu — tylko znane pola, liczby w zakresach z CRM, adresy logo https albo ścieżka. */
function cleanLayout(input: unknown) {
  if (!input || typeof input !== 'object') return {};
  const value = input as Row;
  const result: Row = {};
  const logo = safeLogo(value.selectedLogo);
  if (logo) result.selectedLogo = logo;
  const numbers: Array<[string, number, number]> = [['logoScale', 20, 150], ['logoPositionX', 0, 100], ['logoPositionY', 0, 50], ['footerLogoScale', 20, 150]];
  numbers.forEach(([key, min, max]) => {
    const number = clamp(value[key], min, max);
    if (number !== undefined) result[key] = number;
  });
  if (['default', 'minimal', 'none'].includes(value.selectedFooter)) result.selectedFooter = value.selectedFooter;
  if (value.selectedFooterTemplateId === null || (typeof value.selectedFooterTemplateId === 'string' && CONTRACT_UUID.test(value.selectedFooterTemplateId))) {
    result.selectedFooterTemplateId = value.selectedFooterTemplateId;
  }
  if (value.footerContent && typeof value.footerContent === 'object') {
    const footer = value.footerContent as Row;
    result.footerContent = Object.fromEntries(FOOTER_KEYS.map((key) => [
      key,
      key === 'logoUrl' ? safeLogo(footer.logoUrl) || '' : String(footer[key] ?? '').slice(0, 300),
    ]));
  }
  return result;
}

/** Style dokumentu (czcionka dokumentu z „Układu”) — normalizacja jak w CRM, czcionka bez znaków CSS. */
function cleanDocumentStyles(input: unknown, current: unknown) {
  if (!input || typeof input !== 'object') return resolveContractDocumentStyles(current as any);
  const styles = resolveContractDocumentStyles(input as any);
  const fallback = resolveContractDocumentStyles(current as any);
  Object.keys(styles.styles).forEach((key) => {
    const id = key as keyof typeof styles.styles;
    if (!/^[\w\s,'"\-.]{1,200}$/u.test(styles.styles[id].fontFamily)) styles.styles[id].fontFamily = fallback.styles[id].fontFamily;
  });
  return styles;
}

// MARK: Zapis treści szablonu z edytora na Macu

/*
 * Treść przychodzi z edytora na Macu w formie, którą zapisuje edytor CRM (`finalizeContractEditorHtml`): akapity
 * ze stylem dokumentu, punkty z `data-style` i numerami 1. / 1.1, miejsca na klauzule, sekcje warunkowe. Serwer
 * przepuszcza tylko znaczniki i atrybuty treści umowy (bez skryptów, zdarzeń `on…` i adresów `javascript:`), zamienia
 * „§n” na kolejne numery paragrafów jak `renderContractDocument` i zapisuje jak przycisk „Zapisz” w CRM — z kontrolą
 * wersji (`updated_at`), żeby nie nadpisać zmian z innej karty.
 */

const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'a', 'span', 'font',
  'br', 'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'div', 'hr', 'img', 'sub', 'sup',
  'blockquote', 'pre', 'colgroup', 'col',
]);
const VOID_TAGS = new Set(['br', 'hr', 'img', 'col']);
const DROPPED_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math', 'textarea', 'select', 'title', 'head',
]);
const SAFE_CSS = new Set([
  'text-align', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration',
  'text-decoration-line', 'line-height', 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding',
  'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'text-indent', 'width', 'min-width', 'max-width', 'height',
  'border', 'border-collapse', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-color', 'border-width',
  'border-style', 'vertical-align', 'white-space', 'page-break-before', 'page-break-after', 'page-break-inside',
  'break-before', 'break-after', 'break-inside', 'list-style-type', 'letter-spacing', 'display',
]);
const NUMERIC_ATTRIBUTES = new Set(['start', 'value', 'colspan', 'rowspan', 'width', 'height', 'span']);
const TAG_TOKEN = /<!--[\s\S]*?(?:-->|$)|<![^>]*>?|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|<|[^<]+/g;
const ATTRIBUTE_TOKEN = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const decodeEntities = (value: string) => value
  .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)))
  .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Math.min(Number(dec), 0x10ffff)))
  .replace(/&(colon|tab|newline|quot|apos|lt|gt|amp|nbsp);/gi, (_, name: string) => ({
    colon: ':', tab: '\t', newline: '\n', quot: '"', apos: "'", lt: '<', gt: '>', amp: '&', nbsp: '\u00a0',
  } as Record<string, string>)[name.toLowerCase()]);
const escapeAttribute = (value: string) => value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Adres odnośnika lub obrazu: tylko http(s), poczta, telefon, kotwica (obraz: https, ścieżka w serwisie, data:image). */
const safeUrl = (raw: string, image: boolean) => {
  const value = decodeEntities(raw).replace(/[\u0000-\u0020\u007f-\u009f]/g, '').toLowerCase();
  if (image) return /^https:\/\//.test(value) || /^\/(?!\/)/.test(value) || /^data:image\/(png|jpe?g|gif|webp);base64,/.test(value);
  return /^(https?:|mailto:|tel:|#)/.test(value);
};

const sanitizeStyle = (raw: string) => decodeEntities(raw)
  .split(';')
  .map((part) => {
    const colon = part.indexOf(':');
    if (colon < 0) return '';
    const property = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (!SAFE_CSS.has(property) || !value || value.length > 200) return '';
    if (/url\s*\(|expression|javascript:|vbscript:|@import|behavior|[<>\\{}]/i.test(value)) return '';
    return `${property}: ${value}`;
  })
  .filter(Boolean)
  .join('; ');

function sanitizeAttributes(tag: string, source: string) {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const match of source.matchAll(ATTRIBUTE_TOKEN)) {
    const name = match[1].toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    const raw = match[2] ?? match[3] ?? match[4] ?? '';
    let value: string | null = null;
    if (name.startsWith('on')) continue;
    if (/^data-[a-z0-9_.:-]+$/.test(name)) value = raw;
    else if (name === 'class' || name === 'title' || name === 'alt') value = raw;
    else if (name === 'style') value = sanitizeStyle(raw) || null;
    else if (name === 'href' && tag === 'a') value = safeUrl(raw, false) ? raw : null;
    else if (name === 'src' && tag === 'img') value = safeUrl(raw, true) ? raw : null;
    else if (NUMERIC_ATTRIBUTES.has(name)) value = /^\d{1,5}%?$/.test(raw.trim()) ? raw.trim() : null;
    else if (name === 'type' && tag === 'ol') value = /^[1aAiI]$/.test(raw.trim()) ? raw.trim() : null;
    else if (name === 'align') value = /^(left|right|center|justify)$/i.test(raw.trim()) ? raw.trim().toLowerCase() : null;
    if (value === null || value.length > 4000) continue;
    output.push(` ${name}="${escapeAttribute(value)}"`);
  }
  return output.join('');
}

/** Tylko znaczniki i atrybuty treści umowy; skrypty, style, ramki i komentarze są usuwane razem z treścią. */
export function sanitizeContractHtml(html: string) {
  let output = '';
  const lower = html.toLowerCase();
  TAG_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_TOKEN.exec(html))) {
    const token = match[0];
    if (token === '<') { output += '&lt;'; continue; }
    if (!token.startsWith('<')) { output += token; continue; }
    if (!match[1]) continue; // komentarz, <!DOCTYPE>, CDATA
    const tag = match[1].toLowerCase();
    const closing = token.startsWith('</');
    if (DROPPED_WITH_CONTENT.has(tag)) {
      if (closing) continue;
      const end = lower.indexOf(`</${tag}`, TAG_TOKEN.lastIndex);
      if (end < 0) break;
      const close = html.indexOf('>', end);
      TAG_TOKEN.lastIndex = close < 0 ? html.length : close + 1;
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (closing) { if (!VOID_TAGS.has(tag)) output += `</${tag}>`; continue; }
    output += `<${tag}${sanitizeAttributes(tag, match[2] || '')}>`;
  }
  return output;
}

const PARAGRAPH_START = /(<(?:p|div|h[1-4]|pre)\b(?:"[^"]*"|'[^']*'|[^'">])*>(?:\s|&nbsp;|&#160;|<(?:strong|b|em|i|u|s|span|font)\b(?:"[^"]*"|'[^']*'|[^'">])*>)*)§\s*\d+/giu;

/** Ręcznie wpisane „§ 12” na początku akapitu → „§n” (jak `normalizeContractParagraphPlaceholders`). */
export const normalizeParagraphNumbers = (html: string) => html.replace(PARAGRAPH_START, '$1§n');

/** „§n” → „§ 1”, „§ 2”… w kolejności treści (jak `resolveContractParagraphPlaceholders`), tylko w tekście. */
export const resolveParagraphNumbers = (html: string) => {
  let paragraph = 0;
  return html.replace(/(<[^>]*>)|([^<]+)/g, (_, tag: string | undefined, text: string | undefined) =>
    tag ?? (text || '').replace(/§\s*n\b/giu, () => `§ ${(paragraph += 1)}`));
};

const CONTENT_CONFLICT = 'Szablon został zmieniony w innej karcie albo na innym urządzeniu. Wczytaj go ponownie i nanieś swoje poprawki jeszcze raz.';

/** Zapis treści jak „Zapisz” w edytorze CRM: treść (`content_html`, `flowContent`), tekst do wyszukiwania i wersja. */
export async function saveTemplateContent(ctx: NativeContext, body: Row) {
  if (!contractsAccess(ctx).canManage) fail('Nie masz uprawnień do zmiany szablonów umów.');
  const id = templateId(body.id);
  const expected = typeof body.updatedAt === 'string' ? body.updatedAt : '';
  if (!expected) fail('Odśwież szablon przed zapisaniem zmian.');
  const source = typeof body.html === 'string' ? body.html : '';
  if (source.length > 2_000_000) fail('Treść szablonu jest za długa.');
  const { data: current, error: readError } = await ctx.supabase.from('contract_templates')
    .select('id, updated_at, page_settings').eq('id', id).maybeSingle();
  if (readError || !current) fail('Nie znaleziono szablonu.');
  const row = current as Row;
  const settings: Row = row.page_settings && typeof row.page_settings === 'object' ? row.page_settings : {};
  if (!isContractDocumentStylesTemplate(settings)) fail('Ten szablon jest w starszym formacie — przekształć go w edytorze CRM.');
  if (row.updated_at !== expected) fail(CONTENT_CONFLICT);

  const html = resolveParagraphNumbers(normalizeParagraphNumbers(sanitizeContractHtml(source)));
  const plainText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!plainText) fail('Treść szablonu nie może być pusta.');
  const styles = cleanDocumentStyles(body.documentStyles, settings.documentStyles);
  const updatedAt = new Date().toISOString();
  const pageSettings = {
    ...settings,
    ...cleanLayout(body.layout),
    documentStyles: body.documentStyles ? styles : settings.documentStyles,
    selectedFont: styles.styles.body.fontFamily,
    lineHeight: styles.styles.body.lineHeight,
    flowContent: html,
    // Podział na strony liczy przeglądarka (CRM, generator PDF); tu cała treść jako jedna strona — podgląd i PDF
    // składają strony od nowa z `flowContent`.
    pages: [html],
    paginationMode: 'automatic',
    marginTop: 50,
    marginBottom: 50,
    marginLeft: 50,
    marginRight: 50,
    pageSize: 'A4',
  };
  const { data, error } = await ctx.supabase.from('contract_templates')
    .update({ content: plainText, content_html: html, page_settings: pageSettings, updated_at: updatedAt })
    .eq('id', id).eq('updated_at', expected).select('id, updated_at').maybeSingle();
  if (error) fail(error.message);
  if (!data) fail(CONTENT_CONFLICT);
  return { ok: true, updatedAt: (data as Row).updated_at || updatedAt };
}

const IMAGE_TYPES: Array<{ type: string; extension: string; test: (bytes: Buffer) => boolean }> = [
  { type: 'image/png', extension: 'png', test: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/jpeg', extension: 'jpg', test: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { type: 'image/gif', extension: 'gif', test: (bytes) => bytes.subarray(0, 3).toString('ascii') === 'GIF' },
  { type: 'image/webp', extension: 'webp', test: (bytes) => bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' },
];

/** Obraz do treści szablonu (logo, grafika) z Maca — do publicznego magazynu logotypów (`company-logos/contract-images`). */
export async function uploadTemplateImage(ctx: NativeContext, body: Row) {
  if (!contractsAccess(ctx).canManage) fail('Nie masz uprawnień do zmiany szablonów umów.');
  const bytes = Buffer.from(typeof body.data === 'string' ? body.data : '', 'base64');
  if (!bytes.length) fail('Nie wybrano obrazu.');
  if (bytes.length > 2_100_000) fail('Obraz może mieć najwyżej 2 MB.');
  const kind = IMAGE_TYPES.find((item) => item.test(bytes));
  if (!kind) fail('Obsługiwane formaty obrazów: PNG, JPG, GIF, WebP.');
  const path = `contract-images/${randomUUID()}.${kind.extension}`;
  const { error } = await ctx.supabase.storage.from('company-logos').upload(path, bytes, { contentType: kind.type, upsert: false });
  if (error) fail(error.message || 'Nie udało się wysłać obrazu.');
  return { ok: true, url: publicLogoUrl(path) };
}

/** PDF umowy (bieżący) — podpisany adres jak „Pokaż PDF” w CRM. */
export async function contractPdf(ctx: NativeContext, id: string) {
  if (!CONTRACT_UUID.test(id)) fail('Nieprawidłowa umowa.');
  const { data: contract } = await ctx.supabase.from('contracts').select('generated_pdf_path').eq('id', id).maybeSingle();
  const path = (contract as Row | null)?.generated_pdf_path;
  if (!path) fail('Ta umowa nie ma wygenerowanego PDF.');
  const { data, error } = await ctx.supabase.storage.from('event-files').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) fail('Błąd podczas otwierania PDF');
  return { url: data.signedUrl, name: String(path).split('/').pop() || 'umowa.pdf' };
}

const cleanName = (value: unknown) => {
  const name = String(value ?? '').trim();
  if (!name) fail('Nazwa szablonu jest wymagana.');
  if (name.length > 200) fail('Nazwa szablonu może mieć najwyżej 200 znaków.');
  return name;
};
const cleanDescription = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (text.length > 2000) fail('Opis może mieć najwyżej 2000 znaków.');
  return text || null;
};
const templateId = (value: unknown) => {
  const id = String(value || '');
  if (!CONTRACT_UUID.test(id)) fail('Nieprawidłowy szablon.');
  return id;
};
const changed = (data: unknown[] | null, message: string) => { if (!data?.length) fail(message); };

/** Nowy szablon — od razu w formacie stylów dokumentu (edytor jak Word), jak „Nowy szablon” w CRM. */
export async function createTemplate(ctx: NativeContext, body: Row) {
  if (!contractsAccess(ctx).canCreate) fail('Nie masz uprawnień do tworzenia szablonów umów.');
  const { data, error } = await ctx.supabase.from('contract_templates').insert({
    name: cleanName(body.name),
    description: cleanDescription(body.description),
    content: '',
    content_html: '<h1 data-style="title">UMOWA</h1><p data-style="body"><br></p>',
    page_settings: { documentStyles: createDefaultContractDocumentStyles() },
    is_active: true,
  }).select('id').single();
  if (error || !data) fail(error?.message || 'Nie udało się utworzyć szablonu.');
  return { ok: true, id: (data as Row).id };
}

export async function saveTemplate(ctx: NativeContext, body: Row) {
  if (!contractsAccess(ctx).canManage) fail('Nie masz uprawnień do zmiany szablonów umów.');
  const { data, error } = await ctx.supabase.from('contract_templates')
    .update({ name: cleanName(body.name), description: cleanDescription(body.description), updated_at: new Date().toISOString() })
    .eq('id', templateId(body.id)).select('id');
  if (error) fail(error.message);
  changed(data, 'Nie znaleziono szablonu.');
  return { ok: true };
}

export async function setTemplateActive(ctx: NativeContext, body: Row) {
  if (!contractsAccess(ctx).canManage) fail('Nie masz uprawnień do zmiany szablonów umów.');
  const { data, error } = await ctx.supabase.from('contract_templates')
    .update({ is_active: body.active === true }).eq('id', templateId(body.id)).select('id');
  if (error) fail(error.message);
  changed(data, 'Nie znaleziono szablonu.');
  return { ok: true };
}

/** Kopia jak „Duplikuj” w CRM: ta sama treść i ustawienia, nieaktywna, z dopiskiem „(kopia)”. */
export async function duplicateTemplate(ctx: NativeContext, body: Row) {
  if (!contractsAccess(ctx).canCreate) fail('Nie masz uprawnień do tworzenia szablonów umów.');
  const { data: source, error: readError } = await ctx.supabase.from('contract_templates')
    .select('name, description, content, content_html, page_settings').eq('id', templateId(body.id)).maybeSingle();
  if (readError || !source) fail('Nie znaleziono szablonu.');
  const template = source as Row;
  const { data, error } = await ctx.supabase.from('contract_templates').insert({
    name: `${template.name} (kopia)`.slice(0, 200),
    description: template.description,
    content: template.content,
    content_html: template.content_html,
    page_settings: template.page_settings,
    is_active: false,
  }).select('id').single();
  if (error || !data) fail(error?.message || 'Nie udało się utworzyć kopii szablonu.');
  return { ok: true, id: (data as Row).id };
}

export async function deleteTemplate(ctx: NativeContext, body: Row) {
  if (!contractsAccess(ctx).canManage) fail('Nie masz uprawnień do usuwania szablonów umów.');
  const { data, error } = await ctx.supabase.from('contract_templates').delete().eq('id', templateId(body.id)).select('id');
  if (error) {
    if (error.code === '23503') fail('Szablon jest używany przez umowy lub kategorie wydarzeń. Wyłącz go („Nieaktywny”) zamiast usuwać.');
    fail(error.message);
  }
  changed(data, 'Nie znaleziono szablonu albo nie masz uprawnień do jego usunięcia.');
  return { ok: true };
}
