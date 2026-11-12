import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NativeContext } from './auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { registerEventActions, registerEventQueries, registerEventTab } from './eventTabs';
import {
  CONTRACT_CATEGORY_VARIABLE,
  CONTRACT_CLIENT_VARIABLE,
  contractConditionVariableNames,
  contractConditionVariables,
  contractOptionVariable,
  resolveContractOptions,
} from '@/lib/CRM/contracts/contractConditions';
import {
  CONTRACT_CLAUSE_CATEGORY_LABELS,
  CONTRACT_CLAUSE_PRIMARY_CATEGORIES,
  getContractClauseTopicLabel,
} from '@/lib/CRM/contracts/contractClauseContent';
import { CONTRACT_PLACEHOLDER_GROUPS } from '@/lib/CRM/contracts/contractPlaceholderGroups';

/**
 * Zakładka „Umowa” (`EventContractTab`) — obsługa dokumentu niewymagająca silnika składu przeglądarki: status z datami
 * i zasadami jak w CRM, wersja, blokada, podpis firmy, PDF bieżący i archiwalne wersje, podpisane załączniki (jak
 * `/bridge/events/contracts/signed-files`: te same uprawnienia, bucket, ścieżki i walidacja PDF/JPG/PNG do 20 MB).
 * Treść umowy jest składana z szablonu, oferty i klauzul oraz dzielona na strony przez edytor w CRM — edycja danych i treści,
 * klauzule, szablon, depozyt, audyt AI, wystawienie szkicu, generowanie PDF, wysyłka i anulowanie (hasło) zostają w CRM.
 * Podsumowanie zapisanej treści (`summary`) — do podzakładek jak w CRM: klient, kategoria, warunki umowy (rodzaj klienta
 * i opcje szablonu, z wyborem zapisanym w umowie), pola zmienione dla tej umowy, wybrane osoby podpisujące i klauzule
 * produktów według kategorii (z atrybutów, które nadaje im składanie umowy).
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['draft', 'issued', 'sent', 'accepted', 'signed_by_client', 'signed_returned', 'cancelled'];
const SIGNED_BUCKET = 'signed-contracts';
const MAX_SIGNED = 20 * 1024 * 1024;
const CONTRACT_FIELDS = 'id, title, contract_number, template_id, status, accepted_at, issued_at, sent_at, signed_by_client_at, signed_returned_at, '
  + 'cancelled_at, created_by, created_at, generated_pdf_path, generated_pdf_at, modified_after_generation, version_number, locked_at, '
  + 'company_signed_at, company_signed_by';

function fail(message: string): never {
  throw new Error(message);
}

async function contractPermissions(ctx: NativeContext, eventId: string) {
  const [workflow, manage] = await Promise.all([
    ctx.supabase.rpc('can_manage_event_workflows', { p_event_id: eventId }),
    ctx.supabase.rpc('crm_contract_permission', { p_action: 'manage' }),
  ]);
  const canManage = !manage.error && Boolean(manage.data);
  const canChangeTemplate = !workflow.error && Boolean(workflow.data) && canManage;
  return { isAdmin: ctx.employee.isAdmin, canManage, canChangeStatus: ctx.employee.isAdmin || canChangeTemplate };
}

async function latestContract(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.from('contracts').select(CONTRACT_FIELDS).eq('event_id', eventId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data as Row | null;
}

async function contractOfEvent(ctx: NativeContext, eventId: string, contractId: string) {
  if (!UUID.test(contractId)) fail('Nieprawidłowy identyfikator umowy.');
  const { data } = await ctx.supabase.from('contracts').select(CONTRACT_FIELDS).eq('id', contractId).eq('event_id', eventId).maybeSingle();
  if (!data) fail('Nie znaleziono umowy dla tego wydarzenia.');
  return data as Row;
}

/** Podpisane załączniki (`GET signed-files`): lista dla `can_view_event_commercials`, wysyłanie po potwierdzeniu podpisów. */
async function signedFiles(ctx: NativeContext, eventId: string, contract: Row) {
  const view = await ctx.supabase.rpc('can_view_event_commercials', { p_event_id: eventId, p_manage: false });
  if (view.error || !view.data) return { canView: false, canUpload: false, files: [], error: null };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from('contract_signed_files').select('id, original_name, file_size, mime_type, created_at')
    .eq('contract_id', contract.id).order('created_at', { ascending: false });
  if (error) {
    const missing = ['42P01', 'PGRST205'].includes(error.code || '');
    return { canView: true, canUpload: false, files: [], error: missing ? 'Załączanie podpisanej umowy wymaga migracji signed_contract_attachments w bazie danych.' : 'Nie udało się wczytać podpisanych dokumentów.' };
  }
  const manage = await ctx.supabase.rpc('can_view_event_commercials', { p_event_id: eventId, p_manage: true });
  return {
    canView: true,
    canUpload: !manage.error && Boolean(manage.data) && ['signed_by_client', 'signed_returned'].includes(contract.status) && Boolean(contract.company_signed_at),
    files: ((data || []) as Row[]).map((f) => ({ id: f.id, name: f.original_name || 'plik', size: Number(f.file_size || 0), mime: f.mime_type || '', createdAt: f.created_at })),
    error: null,
  };
}

// MARK: Podsumowanie zapisanej treści umowy

/** Nazwy pól umowy (`{{…}}`) jak w menu „Wstaw pole” edytora szablonu. */
const FIELD_LABELS = new Map<string, string>(CONTRACT_PLACEHOLDER_GROUPS.flatMap((group) =>
  (group.items as Array<{ key: string; label: string }>).map((item): [string, string] => [item.key.replace(/^\{\{|\}\}$/g, ''), item.label])));
const CLAUSE_OPEN = /<div\b[^>]*\bclass="[^"]*\bproduct-contract-clause\b[^"]*"[^>]*>/g;

const one = (value: unknown): Row | null => {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === 'object' ? row as Row : null;
};
const decodeEntities = (value: string) => value
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const plainText = (html: string) => decodeEntities(html
  .replace(/<\/?(?:p|div|li|ol|ul|br|h[1-6]|table|tr|td|th)\b[^>]*>/gi, ' ')
  .replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const attribute = (tag: string, name: string) => decodeEntities(new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] || '').trim();

/** Klauzule produktów w treści umowy (`div.product-contract-clause` ze składania umowy), pogrupowane według kategorii. */
function contractClauses(flow: string) {
  const matches = Array.from(flow.matchAll(CLAUSE_OPEN));
  const groups = new Map<string, { category: string; label: string; items: Array<{ topic: string; product: string; text: string }> }>();
  matches.forEach((match, index) => {
    const tag = match[0];
    const start = (match.index ?? 0) + tag.length;
    let body = flow.slice(start, index + 1 < matches.length ? matches[index + 1].index : undefined);
    const close = /<\/ol>\s*<\/div>/.exec(body);
    body = close ? body.slice(0, close.index) : body.slice(0, 800);
    const text = plainText(body);
    if (!text) return;
    const category = attribute(tag, 'data-clause-category') || 'general';
    const group = groups.get(category)
      ?? { category, label: (CONTRACT_CLAUSE_CATEGORY_LABELS as Record<string, string>)[category] || 'Pozostałe', items: [] };
    const topic = attribute(tag, 'data-clause-topic');
    group.items.push({
      topic: topic === 'event_custom' ? 'Ustalenie dla tego wydarzenia' : topic ? getContractClauseTopicLabel(topic) : '',
      product: attribute(tag, 'data-product-name'),
      text: text.length > 240 ? `${text.slice(0, 239).trimEnd()}…` : text,
    });
    groups.set(category, group);
  });
  const order = CONTRACT_CLAUSE_PRIMARY_CATEGORIES as string[];
  const rank = (category: string) => (order.includes(category) ? order.indexOf(category) : order.length);
  return Array.from(groups.values()).sort((a, b) => rank(a.category) - rank(b.category));
}

/**
 * Podsumowanie zapisanej umowy jak w podzakładkach CRM. Wybór zapisany w umowie (`meta.variableOverrides`,
 * `meta.clientContractSignerIds`) liczy się tylko dla szablonu, z którego powstała treść — jak w `fetchContractData`.
 */
async function contractSummary(ctx: NativeContext, eventId: string, contractId: string, templateId: string | null, template: Row | null) {
  const s = ctx.supabase;
  const [contentRes, eventRes] = await Promise.all([
    s.from('contracts').select('content').eq('id', contractId).maybeSingle(),
    s.from('events').select('organization_id, organizations:organizations!events_organization_id_fkey(name, alias), contacts(first_name, last_name, full_name), event_categories:category_id(name)')
      .eq('id', eventId).maybeSingle(),
  ]);
  const raw = typeof (contentRes.data as Row | null)?.content === 'string' ? String((contentRes.data as Row).content) : '';
  let parsed: Row = {};
  if (raw) {
    try {
      const value = JSON.parse(raw);
      parsed = Array.isArray(value) ? { pages: value } : value && typeof value === 'object' ? value as Row : {};
    } catch {
      parsed = { flowContent: raw, pages: [raw] };
    }
  }
  const pages = Array.isArray(parsed.pages) ? (parsed.pages as unknown[]).filter((page): page is string => typeof page === 'string') : [];
  const flow = typeof parsed.flowContent === 'string' ? parsed.flowContent : pages.join('');
  const meta: Row = parsed.meta && typeof parsed.meta === 'object' ? parsed.meta as Row : {};
  const sameTemplate = Boolean(templateId) && meta.sourceTemplateId === templateId;
  const overrides: Record<string, string> = sameTemplate && meta.variableOverrides && typeof meta.variableOverrides === 'object' && !Array.isArray(meta.variableOverrides)
    ? Object.fromEntries(Object.entries(meta.variableOverrides as Row).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : {};

  // Klient i kategoria — jak `contractConditionVariables` przy składaniu umowy (firma = wydarzenie z organizacją).
  const event = eventRes.data as Row | null;
  const organization = one(event?.organizations);
  const contact = one(event?.contacts);
  const company = Boolean(event?.organization_id);
  const clientName = organization
    ? String(organization.alias || organization.name || '').trim()
    : contact ? String(contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ')).trim() : '';
  const category = String(one(event?.event_categories)?.name || '').trim();

  const settings: Row = template?.page_settings && typeof template.page_settings === 'object' ? template.page_settings as Row : {};
  const templateFlow = typeof settings.flowContent === 'string'
    ? settings.flowContent
    : Array.isArray(settings.pages) ? settings.pages.join('') : String(template?.content_html || '');
  const options = resolveContractOptions(settings);
  const values: Record<string, string | undefined> = { ...contractConditionVariables({ isCompany: company, categoryName: category, options }), ...overrides };
  const conditions = [
    ...(contractConditionVariableNames(templateFlow).has(CONTRACT_CLIENT_VARIABLE)
      ? [{ label: 'Klient', value: values[CONTRACT_CLIENT_VARIABLE] === 'firma' ? 'firma' : 'osoba prywatna' }]
      : []),
    ...options.map((option) => ({ label: option.label, value: values[contractOptionVariable(option.key)] ? 'tak' : 'nie' })),
  ];
  const conditionKeys = new Set([CONTRACT_CLIENT_VARIABLE, CONTRACT_CATEGORY_VARIABLE, ...options.map((option) => contractOptionVariable(option.key))]);
  const changedFields = Array.from(new Set(Object.keys(overrides).filter((key) => !conditionKeys.has(key)).map((key) => FIELD_LABELS.get(key) || key)));

  // Osoby podpisujące po stronie firmy-klienta: zapisany wybór; bez zapisu CRM bierze wszystkie osoby uprawnione.
  let signers: string[] | null = null;
  if (company && sameTemplate && Array.isArray(meta.clientContractSignerIds)) {
    const keys = (meta.clientContractSignerIds as unknown[]).filter((id): id is string => typeof id === 'string' && Boolean(id.trim()));
    const ids = keys.filter((id) => UUID.test(id));
    let rows: Row[] = [];
    if (ids.length) {
      const { data } = await s.from('contacts').select('id, full_name, first_name, last_name').in('id', ids);
      rows = (data || []) as Row[];
    }
    const names = new Map(rows.map((row) => [String(row.id), String(row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' ')).trim()]));
    // Osoba bez kartoteki ma klucz z imienia i nazwiska (małymi literami).
    signers = keys.map((key) => (UUID.test(key) ? names.get(key) || '' : key.replace(/(^|\s)(\p{L})/gu, (_m, space: string, letter: string) => space + letter.toLocaleUpperCase('pl-PL'))))
      .filter(Boolean);
  }

  return {
    individuallyEdited: meta.individuallyEdited === true,
    pages: pages.length || (flow.trim() ? 1 : 0),
    client: clientName ? { name: clientName, company } : null,
    category: category || null,
    conditions,
    changedFields,
    signers,
    clauses: contractClauses(flow),
  };
}

async function contractTab(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const [permissions, contract, eventRes, historyRes] = await Promise.all([
    contractPermissions(ctx, eventId),
    latestContract(ctx, eventId),
    s.from('events').select('selected_contract_template_id, event_categories:category_id(contract_template_id)').eq('id', eventId).maybeSingle(),
    s.from('contracts').select('id, title, contract_number, version_number, status, created_at, generated_pdf_path, generated_pdf_at').eq('event_id', eventId).order('created_at', { ascending: false }),
  ]);
  const event = eventRes.data as Row | null;
  const templateId = contract?.template_id || event?.selected_contract_template_id || event?.event_categories?.contract_template_id || null;
  let templateName: string | null = null;
  let template: Row | null = null;
  if (templateId) {
    const { data } = await s.from('contract_templates').select('name, page_settings, content_html').eq('id', templateId).maybeSingle();
    template = data as Row | null;
    templateName = template?.name ?? null;
  }
  let companySignedBy: string | null = null;
  if (contract?.company_signed_by) {
    const { data } = await s.from('employees').select('name, surname').eq('id', contract.company_signed_by).maybeSingle();
    if (data) companySignedBy = `${(data as Row).name ?? ''} ${(data as Row).surname ?? ''}`.trim() || null;
  }
  return {
    ...permissions,
    templateName,
    contract: contract ? {
      id: contract.id, number: contract.contract_number ?? null, title: contract.title || '', status: STATUSES.includes(contract.status) ? contract.status : 'draft',
      version: Number(contract.version_number || 1), lockedAt: contract.locked_at ?? null, companySignedAt: contract.company_signed_at ?? null, companySignedBy,
      pdf: contract.generated_pdf_path ?? null, pdfAt: contract.generated_pdf_at ?? null, modified: contract.modified_after_generation === true,
      createdAt: contract.created_at ?? null, ownContract: contract.created_by === ctx.employee.id,
      dates: {
        issued: contract.issued_at ?? null, sent: contract.sent_at ?? null, accepted: contract.accepted_at ?? null,
        signedByClient: contract.signed_by_client_at ?? null, signedReturned: contract.signed_returned_at ?? null, cancelled: contract.cancelled_at ?? null,
      },
    } : null,
    history: ((historyRes.data || []) as Row[]).filter((h) => h.id !== contract?.id).map((h) => ({
      id: h.id, title: h.title || '', number: h.contract_number ?? null, version: Number(h.version_number || 1), status: h.status, createdAt: h.created_at,
      pdf: h.generated_pdf_path ?? null, pdfAt: h.generated_pdf_at ?? null,
    })),
    signed: contract ? await signedFiles(ctx, eventId, contract) : { canView: false, canUpload: false, files: [], error: null },
    // Podsumowanie nie blokuje zakładki — bez niego Mac pokazuje status, PDF i dokumenty.
    summary: contract ? await contractSummary(ctx, eventId, contract.id, templateId, template).catch(() => null) : null,
  };
}

registerEventTab('contract', contractTab);

/** PDF umowy (bieżący lub archiwalny) — podpisany adres jak „Pokaż PDF” / „Pobierz PDF”. */
async function pdf(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const contract = await contractOfEvent(ctx, eventId, params.get('contractId') || '');
  if (!contract.generated_pdf_path) fail('Ta umowa nie ma wygenerowanego PDF.');
  const { data, error } = await ctx.supabase.storage.from('event-files').createSignedUrl(contract.generated_pdf_path, 3600);
  if (error || !data?.signedUrl) fail('Błąd podczas otwierania PDF');
  return { url: data.signedUrl, name: String(contract.generated_pdf_path).split('/').pop() || 'umowa.pdf' };
}

/** Podpisany dokument (`GET signed-files?fileId=`): krótki adres z magazynu podpisanych umów. */
async function signedFile(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const contract = await contractOfEvent(ctx, eventId, params.get('contractId') || '');
  const fileId = params.get('fileId') || '';
  if (!UUID.test(fileId)) fail('Nieprawidłowy identyfikator pliku.');
  const view = await ctx.supabase.rpc('can_view_event_commercials', { p_event_id: eventId, p_manage: false });
  if (view.error || !view.data) fail('Nie masz uprawnień do tych dokumentów.');
  const admin = createSupabaseAdminClient();
  const { data: file } = await admin.from('contract_signed_files').select('storage_path, original_name').eq('contract_id', contract.id).eq('id', fileId).maybeSingle();
  if (!file) fail('Nie znaleziono załącznika.');
  const { data: link, error } = await admin.storage.from(SIGNED_BUCKET).createSignedUrl((file as Row).storage_path, 60);
  if (error || !link?.signedUrl) fail('Nie udało się otworzyć pliku.');
  return { url: link.signedUrl, name: (file as Row).original_name || 'umowa' };
}

registerEventQueries('contract', { pdf, signedFile });

/**
 * `handleStatusChange` dla wystawionej umowy. Szkic przechodzi dalej w edytorze CRM (treść składana z bieżących danych
 * i kontrola uwag), anulowanie wymaga hasła administratora w CRM.
 */
async function status(ctx: NativeContext, eventId: string, body: Row) {
  const contract = await contractOfEvent(ctx, eventId, String(body.contractId || ''));
  const next = String(body.status || '');
  const { isAdmin, canChangeStatus } = await contractPermissions(ctx, eventId);
  if (!canChangeStatus) fail('Nie masz uprawnień do zmiany statusu umowy.');
  if (!STATUSES.includes(next) || next === contract.status) fail('Nieprawidłowy status umowy.');
  if (contract.status === 'cancelled') fail('Umowa jest anulowana.');
  if (contract.status === 'draft') fail('Szkic wystawisz w edytorze umowy w CRM — tam umowa jest składana z aktualnych danych.');
  if (next === 'cancelled') fail('Anulowanie umowy wymaga potwierdzenia hasłem administratora w CRM.');
  if (contract.locked_at && ['draft', 'issued', 'sent', 'accepted'].includes(next)) fail('Dokument jest zablokowany po podpisaniu.');
  if (!isAdmin && next === 'draft') fail('Przywrócenie szkicu wymaga uprawnień administratora.');
  if (String(body.expectedStatus || '') !== contract.status) fail('Status umowy zmienił się w międzyczasie. Odśwież widok.');
  const patch: Row = { status: next };
  if (next !== 'draft') patch[`${next}_at`] = new Date().toISOString();
  else patch.modified_after_generation = true;
  const { data, error } = await ctx.supabase.from('contracts').update(patch).eq('id', contract.id).eq('status', contract.status).select('id');
  if (error || !(data || []).length) fail('Błąd podczas aktualizacji statusu');
  return { ok: true };
}

async function companySignature(ctx: NativeContext, eventId: string, body: Row) {
  const contract = await contractOfEvent(ctx, eventId, String(body.contractId || ''));
  if (!ctx.employee.isAdmin) fail('Potwierdzenie podpisu firmy wymaga uprawnień administratora.');
  if (contract.status === 'draft' || contract.status === 'cancelled' || contract.company_signed_at) fail('Tej umowy nie można teraz oznaczyć jako podpisanej przez firmę.');
  const { error } = await ctx.supabase.from('contracts').update({ company_signed_at: new Date().toISOString(), company_signed_by: ctx.employee.id }).eq('id', contract.id);
  if (error) fail(`Nie udało się potwierdzić podpisu firmy: ${error.message}`);
  return { ok: true };
}

/** Kontekst zapisu podpisanych dokumentów (`context(request, true)` z trasy signed-files). */
async function signedUploadContext(ctx: NativeContext, eventId: string, contractId: string) {
  const contract = await contractOfEvent(ctx, eventId, contractId);
  const [manage, scope] = await Promise.all([
    ctx.supabase.rpc('can_view_event_commercials', { p_event_id: eventId, p_manage: true }),
    ctx.supabase.rpc('crm_contract_permission', { p_action: 'manage' }),
  ]);
  if (manage.error || !manage.data) fail('Nie masz uprawnień do tych dokumentów.');
  if (scope.error || !scope.data) fail('Nie masz uprawnień do zmiany tej umowy.');
  if (!['signed_by_client', 'signed_returned'].includes(contract.status) || !contract.company_signed_at) fail('Najpierw potwierdź podpisy obu stron umowy.');
  return contract;
}

/** Krok 1: adres wysyłki do magazynu podpisanych umów (plik trafia od razu z Maca, bez przechodzenia przez serwer). */
async function prepareSigned(ctx: NativeContext, eventId: string, body: Row) {
  const contract = await signedUploadContext(ctx, eventId, String(body.contractId || ''));
  const name = String(body.name || '');
  const size = Number(body.size || 0);
  if (!size || size > MAX_SIGNED) fail('Wybierz niepusty plik PDF, JPG lub PNG o rozmiarze do 20 MB.');
  const match = /\.(pdf|jpe?g|png)$/i.exec(name);
  if (!match) fail('Plik musi być dokumentem PDF lub skanem JPG/PNG.');
  const extension = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const admin = createSupabaseAdminClient();
  const { error: schemaError } = await admin.from('contract_signed_files').select('id').limit(0);
  if (schemaError) fail('Załączanie podpisanej umowy wymaga migracji signed_contract_attachments w bazie danych.');
  const id = randomUUID();
  const path = `${eventId}/${contract.id}/${id}.${extension}`;
  const { data, error } = await admin.storage.from(SIGNED_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) fail('Nie udało się zapisać pliku. Sprawdź, czy zastosowano migrację magazynu podpisanych umów.');
  return { id, path, url: data.signedUrl };
}

/** Krok 2: sprawdzenie treści pliku (PDF/JPG/PNG po sygnaturze, do 20 MB) i wpis w `contract_signed_files`; zły plik jest usuwany. */
async function registerSigned(ctx: NativeContext, eventId: string, body: Row) {
  const contract = await signedUploadContext(ctx, eventId, String(body.contractId || ''));
  const id = String(body.id || '');
  const path = String(body.path || '');
  if (!UUID.test(id) || !new RegExp(`^${eventId}/${contract.id}/${id}\\.(pdf|jpg|png)$`).test(path)) fail('Nieprawidłowy plik.');
  const admin = createSupabaseAdminClient();
  const remove = () => admin.storage.from(SIGNED_BUCKET).remove([path]);
  const { data: blob, error: downloadError } = await admin.storage.from(SIGNED_BUCKET).download(path);
  if (downloadError || !blob) fail('Nie udało się odczytać wysłanego pliku. Spróbuj ponownie.');
  const bytes = Buffer.from(await blob.arrayBuffer());
  let mime = '';
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') mime = 'application/pdf';
  else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mime = 'image/jpeg';
  else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mime = 'image/png';
  const expected = path.endsWith('.pdf') ? 'application/pdf' : path.endsWith('.png') ? 'image/png' : 'image/jpeg';
  if (!bytes.length || bytes.length > MAX_SIGNED || mime !== expected) {
    await remove();
    fail('Plik musi być dokumentem PDF lub skanem JPG/PNG o rozmiarze do 20 MB.');
  }
  const name = String(body.name || 'umowa').replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 200);
  const { error } = await admin.from('contract_signed_files').insert({
    id, contract_id: contract.id, storage_path: path, original_name: name, file_size: bytes.length, mime_type: mime, uploaded_by: ctx.employee.id,
  });
  if (error) {
    await remove();
    if (error.code === '23514') fail('Status umowy zmienił się. Odśwież widok przed załączeniem pliku.');
    fail('Nie udało się zapisać pliku.');
  }
  return { ok: true };
}

registerEventActions('contract', { status, companySignature, prepareSigned, registerSigned });
