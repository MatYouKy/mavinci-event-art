import 'server-only';
import { createHash } from 'node:crypto';
import { can, type NativeContext } from './auth';
import { createDefaultContractDocumentStyles, isContractDocumentStylesTemplate } from '@/lib/CRM/contracts/contractDocumentStyles';
import { resolveContractOptions } from '@/lib/CRM/contracts/contractConditions';

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
    pages: Array.isArray(settings.pages) ? settings.pages.length : 0,
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
