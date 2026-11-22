import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NativeContext } from './auth';
import { fail, inquiryId, inquiryRights, requireManage } from './inquiryWorkspace';
import { sendingAccounts } from './offerActions';
import { composeEmailHtml, emailPreviewDocument } from './messages';
import { dispatchCrmEmail } from '@/lib/emailScheduling';
import { inquiryTitleLabel, systemLabel } from '@/lib/ui/systemLabels';
import { cleanInquiryMessage } from '@/lib/CRM/inquiries/cleanInquiryMessage';
import { parseInquiryContact } from '@/lib/CRM/inquiries/parseInquiryContact';
import { normalizeEventAssumptionItems } from '@/lib/CRM/Offers/eventAssumptions';

/*
 * Karta zapytania na Macu, część 2 — pozostałe zakładki i czynności strony `/crm/inquiries/[id]` tymi samymi zapisami
 * i funkcjami co przeglądarka (token pracownika, RLS):
 * - Korespondencja (`InquiryCorrespondencePanel`): `get_inquiry_correspondence`, wyszukiwanie w `inquiry_email_index`,
 *   podgląd wątku (`get_email_conversation_preview`), dołączanie i wykluczanie (`link_inquiry_email`);
 * - E-mail do klienta (`ComposeEmailModal` → `send-email` z powiązaniem z zapytaniem), „Popraw z AI” (`improve_email`);
 * - Analiza i rozmowa z AI (`InquiryAnalysisPanel`, funkcja `assist-inquiry`, `inquiry_analyses`,
 *   `approve_inquiry_summary`), odczyt liczby osób z korespondencji;
 * - Klient i organizacja (`InquiryClientModal`), Zespół (`get_inquiry_team`, `set_inquiry_team_member`),
 *   Zadania zapytania (jak `createTask`), Utworzenie wydarzenia / przygotowanie realizacji (`ConvertInquiryModal`).
 */

type Row = Record<string, any>;
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const one = (value: unknown): Row | null => (Array.isArray(value) ? (value[0] as Row) ?? null : value && typeof value === 'object' ? (value as Row) : null);
const uuidOrNull = (value: unknown, message: string) => {
  const raw = text(value).trim();
  if (!raw) return null;
  if (!UUID.test(raw)) fail(message);
  return raw;
};
const details = (inquiry: Row): Row => (inquiry.inquiry_details && typeof inquiry.inquiry_details === 'object' ? inquiry.inquiry_details : {});
const likePattern = (value: string) => `%${value.trim().replace(/[\\%_]/g, '\\$&')}%`;
const fullName = (row: Row | null) => (row ? `${row.name ?? ''} ${row.surname ?? ''}`.trim() : '');

// MARK: Korespondencja

/** Powiązane wiadomości (od najstarszej), skrócona treść bez stopek i cytatów, wykluczone wiadomości i podpis wersji. */
export async function inquiryCorrespondence(ctx: NativeContext, rawId: unknown) {
  const id = inquiryId(rawId);
  const { rights } = await inquiryRights(ctx, id);
  const { data, error } = await ctx.supabase.rpc('get_inquiry_correspondence', { p_inquiry_id: id });
  if (error) fail('Nie udało się odświeżyć korespondencji. Spróbuj ponownie.');
  const payload = (data || {}) as Row;
  return {
    messages: ((payload.messages || []) as Row[]).map((message) => {
      const clean = cleanInquiryMessage(text(message.body));
      return {
        id: text(message.id),
        type: text(message.type) === 'sent' ? 'sent' : 'received',
        subject: text(message.subject),
        from: text(message.from_address),
        to: text(message.to_address),
        at: message.message_at ?? null,
        body: text(message.body),
        clean: clean.text,
        trimmed: clean.trimmed,
      };
    }),
    excluded: ((payload.links || []) as Row[]).filter((link) => link.excluded === true)
      .map((link) => ({ id: text(link.id), type: text(link.type) === 'sent' ? 'sent' : 'received' })),
    signature: text(payload.signature),
    canManage: rights.canManage,
  };
}

/** „Wyszukaj po temacie maila…” — wiadomości z dostępnych skrzynek (`inquiry_email_index`). */
export async function searchInquiryEmails(ctx: NativeContext, rawId: unknown, query: string) {
  const id = inquiryId(rawId);
  await requireManage(ctx, id);
  if (query.trim().length < 3) fail('Wpisz co najmniej 3 znaki tematu.');
  const { data, error } = await ctx.supabase.from('inquiry_email_index')
    .select('id,type,subject,from_address,to_address,message_at')
    .ilike('subject', likePattern(query)).order('message_at', { ascending: false }).limit(30);
  if (error) fail('Wyszukiwanie korespondencji jest chwilowo niedostępne. Spróbuj ponownie później.');
  return {
    results: ((data || []) as Row[]).map((message) => ({
      id: text(message.id), type: text(message.type) === 'sent' ? 'sent' : 'received', subject: text(message.subject),
      from: text(message.from_address), to: text(message.to_address), at: message.message_at ?? null,
    })),
  };
}

/** Wiadomości wątku wybranego maila — zakres „Dołącz całą konwersację”. */
export async function inquiryEmailThread(ctx: NativeContext, rawId: unknown, type: string, messageId: string) {
  const id = inquiryId(rawId);
  await requireManage(ctx, id);
  if (!['received', 'sent'].includes(type) || !UUID.test(messageId)) fail('Nieprawidłowa wiadomość.');
  const { data, error } = await ctx.supabase.rpc('get_email_conversation_preview', { p_type: type, p_id: messageId });
  if (error) fail('Nie udało się pobrać konwersacji. Spróbuj ponownie.');
  return {
    messages: ((data || []) as Row[]).map((message) => ({
      id: text(message.id), type: text(message.type) === 'sent' ? 'sent' : 'received', subject: text(message.subject), at: message.message_at ?? null,
    })),
  };
}

/** Dołączenie wiadomości lub wątku, wykluczenie i przywrócenie (`link_inquiry_email`). */
export async function linkInquiryEmail(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  await requireManage(ctx, id);
  const type = text(body.type);
  const messageId = text(body.messageId);
  if (!['received', 'sent'].includes(type) || !UUID.test(messageId)) fail('Nieprawidłowa wiadomość.');
  const { error } = await ctx.supabase.rpc('link_inquiry_email', {
    p_inquiry_id: id, p_type: type, p_id: messageId, p_thread: body.thread !== false, p_excluded: body.excluded === true,
  });
  if (error) fail(error.message || 'Nie udało się zapisać powiązania. Spróbuj ponownie.');
  return { ok: true };
}

// MARK: E-mail do klienta

function clientOf(inquiry: Row) {
  const info = details(inquiry);
  const contact = one(inquiry.contact);
  const organization = one(inquiry.organization);
  const parsed = parseInquiryContact(info.client_text, info.client_email);
  return {
    email: text(contact?.email) || parsed.email || text(organization?.email),
    name: text(contact?.full_name) || text(organization?.alias) || text(organization?.name) || parsed.fullName || inquiryTitleLabel(inquiry.title),
    parsed,
  };
}

async function senderAccount(ctx: NativeContext, accountId: unknown) {
  const account = (await sendingAccounts(ctx)).find((item) => item.id === text(accountId));
  if (!account) fail('Wybierz konto, z którego chcesz wysłać wiadomość.');
  return account;
}

/** Okno „Napisz e-mail”: skrzynki pracownika, adresat (klient zapytania), temat i początek treści jak w CRM. */
export async function inquiryEmailSetup(ctx: NativeContext, rawId: unknown) {
  const id = inquiryId(rawId);
  const inquiry = await requireManage(ctx, id);
  const accounts = await sendingAccounts(ctx);
  const client = clientOf(inquiry);
  const contactName = text(one(inquiry.contact)?.full_name) || text(one(inquiry.organization)?.alias) || text(one(inquiry.organization)?.name) || client.parsed.fullName;
  return {
    accounts: accounts.map((account) => ({
      id: account.id,
      label: `${account.from_name ? `${account.from_name} — ` : ''}${account.email_address}${account.account_type === 'shared' ? ' (wspólna)' : ''}`,
    })),
    accountId: (accounts.find((account) => account.is_default) || accounts[0])?.id || '',
    to: client.email,
    subject: `Zapytanie: ${inquiryTitleLabel(inquiry.title)}`,
    text: `Dzień dobry${contactName ? ` ${contactName}` : ''},\n\nDziękuję za przesłane zapytanie.\n\n`,
  };
}

/** „Podgląd” z szablonem i stopką wybranej skrzynki (jak `ComposeEmailModal`). */
export async function inquiryEmailPreview(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  await requireManage(ctx, id);
  const account = await senderAccount(ctx, body.accountId);
  const html = await composeEmailHtml(ctx.supabase, { employeeId: ctx.employee.id, accountId: account.id, subject: text(body.subject), text: text(body.text) });
  return { html: emailPreviewDocument(html) };
}

const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

/** Wysyłka teraz albo zaplanowana — wiadomość zapisuje się w korespondencji i jako kontakt z klientem (`send-email`). */
export async function sendInquiryEmail(ctx: NativeContext, accessToken: string, body: Row) {
  const id = inquiryId(body.id);
  await requireManage(ctx, id);
  const to = text(body.to).trim();
  const subject = text(body.subject).trim();
  const message = text(body.text);
  if (!to || !subject || !message.trim()) fail('Wypełnij wszystkie pola.');
  const account = await senderAccount(ctx, body.accountId);
  let scheduledAt: string | null = null;
  if (body.scheduledAt) {
    const date = new Date(text(body.scheduledAt));
    if (Number.isNaN(date.getTime())) fail('Podaj prawidłową datę i godzinę wysyłki.');
    if (date.getTime() < Date.now() + 30_000) fail('Termin wysyłki musi przypadać w przyszłości.');
    scheduledAt = date.toISOString();
  }
  let total = 0;
  const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
    .filter((file: Row) => file && text(file.filename) && typeof file.content === 'string')
    .slice(0, 20)
    .map((file: Row) => {
      total += Math.floor((file.content.length * 3) / 4);
      return { filename: text(file.filename), content: file.content, contentType: text(file.contentType) || 'application/octet-stream' };
    });
  if (total > MAX_ATTACHMENTS_BYTES) fail('Łączny rozmiar załączników przekracza 25 MB.');
  const html = await composeEmailHtml(ctx.supabase, { employeeId: ctx.employee.id, accountId: account.id, subject, text: message });
  const result = await dispatchCrmEmail({
    accessToken,
    functionName: 'send-email',
    scheduledAt,
    metadata: { entityType: 'inquiry', entityId: id, inquiryId: id, actionUrl: `/crm/inquiries/${id}` },
    payload: {
      inquiryId: id,
      emailAccountId: account.id,
      to,
      cc: text(body.cc).trim(),
      bcc: text(body.bcc).trim(),
      subject,
      body: html,
      attachments,
    },
  });
  return { scheduled: Boolean(result.scheduled), scheduledAt: result.scheduledAt ?? null };
}

// MARK: Asystent AI (`assist-inquiry`)

const ASSISTANT_ERRORS = ['correspondence_too_large', 'correspondence_changed', 'correspondence_unavailable', 'conversation_changed', 'conversation_unavailable', 'analysis_save_failed'];
const assistantError = (status: number) => {
  if (status === 401) return 'Sesja wygasła. Zaloguj się ponownie.';
  if (status === 403 || status === 404) return 'Nie masz dostępu do tego zapytania.';
  if (status === 409) return 'Zapytanie zmieniło się podczas analizy. Odśwież dane i uruchom analizę ponownie.';
  if (status === 429) return 'Limit usługi AI został chwilowo przekroczony. Spróbuj ponownie za moment.';
  if (status === 503) return 'Asystent AI nie jest obecnie skonfigurowany lub dostępny.';
  return 'Nie udało się przeanalizować zapytania. Spróbuj ponownie.';
};

async function assistInquiry(accessToken: string, inquiry: string, payload: Row): Promise<Row> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base || !accessToken) fail('Sesja wygasła. Zaloguj się ponownie.');
  const response = await fetch(`${base}/functions/v1/assist-inquiry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ inquiryId: inquiry, ...payload }),
  });
  const result = (await response.json().catch(() => ({}))) as Row;
  if (!response.ok) {
    console.error('[native-inquiries] assist-inquiry failed', { status: response.status, code: result.error_code });
    fail(ASSISTANT_ERRORS.includes(text(result.error_code)) && result.error ? text(result.error) : assistantError(response.status));
  }
  return (result.result || {}) as Row;
}

const DEFAULT_ANALYSIS_PROMPT = 'Przeanalizuj zapytanie mailowe i całą dołączoną korespondencję jako jedną sprawę. Przedstaw aktualne założenia wydarzenia, potrzeby klienta, pytania wymagające doprecyzowania, proponowany zakres usług oraz szacunkową kalkulację netto w PLN z podstawą wyceny i brakami wpływającymi na cenę. Oddziel potwierdzone ustalenia od propozycji i założeń roboczych.';
const GUESTS_PROMPT = 'Odczytaj aktualną liczbę uczestników z tego zapytania i powiązanej korespondencji. Zwróć participants z dosłownym cytatem. Powierzchnia sali nie jest liczbą gości. Nie szacuj brakujących danych.';
const SOURCE = /(?:[—–-]\s*)?[([]?\s*(received|sent):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*[)\]]?/gi;
const money = (value: number) => `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 }).format(value)} zł`;

/** Punkt analizy jak `RecommendationText`: bez kluczy źródeł w treści, z etykietą „Wskazane przez klienta / Wniosek AI” i odnośnikami. */
function aiItem(value: unknown) {
  const sources = new Map<string, { type: string; id: string }>();
  const content = text(value).replace(SOURCE, (_match, type: string, id: string) => {
    sources.set(`${type.toLowerCase()}:${id}`, { type: type.toLowerCase(), id });
    return '';
  }).trim();
  const category = /^(expressed|interpretation):\s*/i.exec(content);
  return {
    text: category ? content.slice(category[0].length) : content,
    label: category ? systemLabel(category[1].toLowerCase(), 'inquiryFinding') : '',
    sources: Array.from(sources.values()),
  };
}
const aiList = (values: unknown) => (Array.isArray(values) ? values : []).map(aiItem).filter((item) => item.text);

function analysisView(row: Row) {
  const result: Row = row.result && typeof row.result === 'object' ? row.result : {};
  const assumptions = normalizeEventAssumptionItems(result.event_assumption_items, text(result.event_assumptions));
  const estimate: Row = result.preliminary_estimate && typeof result.preliminary_estimate === 'object' ? result.preliminary_estimate : {};
  const min = Number(estimate.min_net);
  const max = Number(estimate.max_net);
  const hasEstimate = Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max > 0 && max >= min;
  return {
    id: text(row.id),
    at: row.created_at ?? null,
    question: text(result.chat_message) || 'Przeanalizuj zapytanie i korespondencję.',
    reply: text(result.assistant_reply) || text(result.summary),
    summary: text(result.summary),
    eventGoal: text(result.event_goal),
    assumptions: aiList(assumptions.map((item) => `${item.label ? `${item.label}: ` : ''}${item.value}`)),
    clientNeeds: aiList(result.client_needs),
    missing: aiList(result.missing_information),
    estimate: hasEstimate ? `${money(min)} – ${money(max)} netto` : 'Brak podstaw do określenia kwoty',
    estimateSummary: text(estimate.summary),
    estimateBasis: aiList(estimate.basis),
    products: aiList((Array.isArray(result.suggested_products) ? result.suggested_products : []).map((item: Row) => `${text(item?.name)} — ${text(item?.reason)}`)),
    nextActions: aiList(result.next_actions),
    resources: aiList((Array.isArray(result.suggested_resources) ? result.suggested_resources : []).map((item: Row) => `${text(item?.name)} — ${text(item?.reason)}`)),
    risks: aiList(result.risks),
    findings: (Array.isArray(result.correspondence_findings) ? result.correspondence_findings : []).map((item: Row) => ({
      ...aiItem(item?.finding),
      sources: (Array.isArray(item?.source_keys) ? item.source_keys : [])
        .map((key: unknown) => /^(received|sent):([0-9a-f-]{36})$/i.exec(text(key)))
        .filter((match: RegExpExecArray | null): match is RegExpExecArray => Boolean(match))
        .map((match: RegExpExecArray) => ({ type: match[1].toLowerCase(), id: match[2] })),
    })),
    findingsCount: Number(result.correspondence_message_count || 0),
  };
}

/** Zakładka „Analiza i AI”: rozmowa (ostatnie 30 tur), aktualne podsumowanie i zatwierdzone podsumowanie do oferty. */
export async function inquiryAnalysis(ctx: NativeContext, rawId: unknown) {
  const id = inquiryId(rawId);
  const { inquiry, rights } = await inquiryRights(ctx, id);
  const [analyses, correspondence] = await Promise.all([
    ctx.supabase.from('inquiry_analyses').select('id, created_at, brief_revision, result').eq('inquiry_id', id)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(30),
    ctx.supabase.rpc('get_inquiry_correspondence', { p_inquiry_id: id }),
  ]);
  if (analyses.error) fail('Nie udało się pobrać analiz zapytania.');
  const rows = (analyses.data || []) as Row[];
  const approved = one(details(inquiry).approved_summary);
  const signature = correspondence.error ? null : text((correspondence.data as Row | null)?.signature);
  const messages = correspondence.error ? [] : (((correspondence.data as Row | null)?.messages || []) as Row[]);
  return {
    analyses: rows.map(analysisView),
    approved: approved ? { summary: text(approved.summary), at: approved.approved_at ?? null, analysisId: text(approved.analysis_id) } : null,
    approvedCurrent: Boolean(approved && rows[0] && approved.analysis_id === rows[0].id
      && Number(approved.brief_revision) === Number(inquiry.brief_revision) && signature !== null && approved.correspondence_signature === signature),
    briefRevision: Number(inquiry.brief_revision || 1),
    messageCount: messages.length,
    canManage: rights.canManage,
  };
}

/** Pytanie do AI albo odświeżenie analizy (pusta treść = pełna analiza zapytania i korespondencji). */
export async function askInquiryAssistant(ctx: NativeContext, accessToken: string, body: Row) {
  const id = inquiryId(body.id);
  await requireManage(ctx, id);
  const message = text(body.message).trim();
  if (message.length > 4000) fail('Pytanie może mieć maksymalnie 4000 znaków.');
  const requestId = UUID.test(text(body.requestId)) ? text(body.requestId) : randomUUID();
  await assistInquiry(accessToken, id, { action: 'recommend', chatMessage: message || DEFAULT_ANALYSIS_PROMPT, requestId });
  return inquiryAnalysis(ctx, id);
}

/** „Odczytaj z korespondencji” — liczba uczestników z dosłownym cytatem (bez zgadywania). */
export async function readInquiryGuests(ctx: NativeContext, accessToken: string, body: Row) {
  const id = inquiryId(body.id);
  await requireManage(ctx, id);
  const result = await assistInquiry(accessToken, id, { action: 'recommend', requestId: randomUUID(), chatMessage: GUESTS_PROMPT });
  const participants = one(result.participants);
  if (!participants) fail('Obsługa pobierania liczby osób nie jest jeszcze dostępna w uruchomionej wersji AI. Możesz wpisać liczbę ręcznie.');
  const count = Number(participants.count);
  return {
    kind: text(participants.kind),
    text: text(participants.text),
    evidence: text(participants.evidence),
    count: Number.isFinite(count) && count > 0 ? Math.round(count) : null,
  };
}

export async function approveInquirySummary(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  await requireManage(ctx, id);
  const analysis = text(body.analysisId);
  if (!UUID.test(analysis)) fail('Nieprawidłowa analiza.');
  const { error } = await ctx.supabase.rpc('approve_inquiry_summary', { p_inquiry: id, p_analysis: analysis, p_revision: Number(body.revision || 1) });
  if (error) fail(error.message || 'Nie udało się zatwierdzić podsumowania.');
  return { ok: true };
}

/** „Popraw z AI” w oknie wiadomości — temat i treść bez stopki. */
export async function improveInquiryEmail(ctx: NativeContext, accessToken: string, body: Row) {
  const id = inquiryId(body.id);
  await requireManage(ctx, id);
  const result = await assistInquiry(accessToken, id, { action: 'improve_email', subject: text(body.subject), draft: text(body.text) });
  return { subject: text(result.subject), text: text(result.body) };
}

// MARK: Klient i organizacja (`InquiryClientModal`)

const PUBLIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk',
  'live.com', 'live.co.uk', 'msn.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.pl',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'pm.me', 'tuta.com', 'tutanota.com', 'gmx.com', 'gmx.de', 'mail.com',
  'wp.pl', 'o2.pl', 'tlen.pl', 'go2.pl', 'onet.pl', 'op.pl', 'vp.pl',
  'poczta.onet.pl', 'onet.eu', 'interia.pl', 'interia.eu', 'poczta.fm',
  'int.pl', 'gazeta.pl', 'buziaczek.pl', 'spoko.pl', 'amorki.pl',
  'autograf.pl', 'opoczta.pl', 'poczta.pl', 'home.pl', 'neostrada.pl',
]);
const host = (value: string) => {
  try {
    const name = new URL(`https://${value.toLowerCase().replace(/\.$/, '')}`).hostname;
    return name.includes('.') && /^[a-z0-9.-]+$/.test(name) ? name : null;
  } catch { return null; }
};
const emailDomain = (value: unknown) => {
  const raw = text(value).trim();
  const address = raw.match(/<([^<>]+)>$/)?.[1] || raw;
  const match = address.match(/^[^\s@<>;,]+@([^\s@<>;,/:?#]+)$/);
  return match ? host(match[1]) : null;
};
const websiteDomain = (value: unknown) => {
  const raw = text(value).trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/\//, '')}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return host(url.hostname.replace(/^www\./i, ''));
  } catch { return null; }
};

/** Organizacja po domenie adresu klienta (`matchOrganizationByEmail`) — tylko jednoznaczne dopasowanie, bez skrzynek publicznych. */
async function organizationByEmail(ctx: NativeContext, email: string) {
  const domain = emailDomain(email);
  if (!domain || PUBLIC_DOMAINS.has(domain)) return null;
  const matches: Row[] = [];
  for (let offset = 0; offset < 20_000; offset += 500) {
    const { data, error } = await ctx.supabase.from('organizations').select('id,name,alias,email,website').order('id').range(offset, offset + 499);
    if (error) return null;
    for (const organization of (data || []) as Row[]) {
      if (emailDomain(organization.email) === domain || websiteDomain(organization.website) === domain) {
        matches.push(organization);
        if (matches.length > 1) return null;
      }
    }
    if (!data || data.length < 500) break;
  }
  return matches[0] || null;
}

const contactView = (row: Row) => ({
  id: text(row.id),
  name: text(row.full_name) || `${text(row.first_name)} ${text(row.last_name)}`.trim(),
  email: text(row.email),
  type: text(row.contact_type),
});
const organizationView = (row: Row) => ({ id: text(row.id), name: text(row.alias) || text(row.name) });

/** Okno „Klient i organizacja”: obecne powiązanie, dane klienta z zapytania i sugerowana organizacja z domeny adresu. */
export async function inquiryClientSetup(ctx: NativeContext, rawId: unknown) {
  const id = inquiryId(rawId);
  const inquiry = await requireManage(ctx, id);
  const info = details(inquiry);
  const parsed = parseInquiryContact(info.client_text, info.client_email);
  const [contact, organization] = await Promise.all([
    inquiry.contact_id
      ? ctx.supabase.from('contacts').select('id,full_name,first_name,last_name,email,contact_type').eq('id', inquiry.contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
    inquiry.organization_id
      ? ctx.supabase.from('organizations').select('id,name,alias').eq('id', inquiry.organization_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const current = one(inquiry.contact);
  const currentOrganization = one(inquiry.organization);
  const email = clientOf(inquiry).email;
  const suggested = !inquiry.organization_id && email ? await organizationByEmail(ctx, email) : null;
  return {
    contact: contact.data ? contactView(contact.data as Row) : null,
    organization: organization.data ? organizationView(organization.data as Row) : null,
    contactId: inquiry.contact_id ?? null,
    organizationId: inquiry.organization_id ?? null,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    email,
    phone: text(current?.mobile) || text(current?.phone) || text(currentOrganization?.phone) || text(info.client_phone),
    suggestedOrganization: suggested ? organizationView(suggested) : null,
  };
}

/** Wyszukiwanie kontaktów (po imieniu i nazwisku) albo organizacji (po nazwie), najwyżej 15 wyników. */
export async function searchInquiryClients(ctx: NativeContext, rawId: unknown, kind: string, query: string) {
  const id = inquiryId(rawId);
  await requireManage(ctx, id);
  if (query.trim().length < 2) return { results: [] };
  if (kind === 'organization') {
    const { data, error } = await ctx.supabase.from('organizations').select('id,name,alias').ilike('name', likePattern(query)).limit(15);
    if (error) fail('Nie udało się wyszukać organizacji.');
    return { results: ((data || []) as Row[]).map((row) => ({ ...organizationView(row), email: '', type: '' })) };
  }
  const { data, error } = await ctx.supabase.from('contacts').select('id,full_name,first_name,last_name,email,contact_type').ilike('full_name', likePattern(query)).limit(15);
  if (error) fail('Nie udało się wyszukać kontaktów.');
  return { results: ((data || []) as Row[]).map(contactView) };
}

/**
 * „Zapisz i powiąż” jak w CRM: bez cichego dublowania (adres e-mail kontaktu, NIP lub nazwa organizacji — wtedy zwracamy
 * istniejące rekordy do wyboru), zmiana typu kontaktu, powiązanie kontaktu z organizacją i zapytania z klientem
 * (tylko gdy powiązanie nie zmieniło się w międzyczasie).
 */
export async function linkInquiryClient(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  const inquiry = await requireManage(ctx, id);
  const type = text(body.type);
  if (!['individual', 'contact'].includes(type)) fail('Wybierz typ klienta.');
  const existingContact = uuidOrNull(body.contactId, 'Nieprawidłowy kontakt.');
  const mode = existingContact ? 'existing' : 'new';
  const first = text(body.firstName).trim();
  const last = text(body.lastName).trim();
  const mail = text(body.email).trim().toLowerCase();
  const phone = text(body.phone).trim();
  if (mode === 'new' && !first) fail('Podaj imię klienta.');
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) fail('Podaj poprawny adres e-mail.');
  const orgMode = type === 'contact' ? text(body.organizationMode) || 'none' : 'none';
  const existingOrganization = orgMode === 'existing' ? uuidOrNull(body.organizationId, 'Nieprawidłowa organizacja.') : null;
  if (orgMode === 'existing' && !existingOrganization) fail('Wybierz organizację.');
  const orgName = text(body.organizationName).trim();
  const nip = text(body.nip).replace(/[\s-]/g, '');
  if (orgMode === 'new' && !orgName) fail('Podaj nazwę organizacji.');
  const expectedContact = body.expectedContactId ? text(body.expectedContactId) : null;
  const expectedOrganization = body.expectedOrganizationId ? text(body.expectedOrganizationId) : null;
  if ((inquiry.contact_id ?? null) !== expectedContact || (inquiry.organization_id ?? null) !== expectedOrganization) {
    fail('Klient zapytania został w międzyczasie zmieniony. Odśwież zapytanie.');
  }

  let contact: Row | null = null;
  if (existingContact) {
    const { data, error } = await ctx.supabase.from('contacts').select('id,full_name,first_name,last_name,email,contact_type').eq('id', existingContact).maybeSingle();
    if (error || !data) fail('Nie znaleziono wybranego kontaktu.');
    contact = data as Row;
  } else if (mail) {
    const { data, error } = await ctx.supabase.from('contacts').select('id,full_name,first_name,last_name,email,contact_type').eq('email', mail).limit(2);
    if (error) fail(error.message);
    if (data?.length) return { duplicate: 'contact', message: 'Ten adres jest już w bazie. Wybierz istniejący kontakt.', results: (data as Row[]).map(contactView) };
  }
  let organization: Row | null = null;
  if (orgMode === 'existing') {
    const { data, error } = await ctx.supabase.from('organizations').select('id,name,alias').eq('id', existingOrganization!).maybeSingle();
    if (error || !data) fail('Nie znaleziono wybranej organizacji.');
    organization = data as Row;
  } else if (orgMode === 'new') {
    let duplicates = ctx.supabase.from('organizations').select('id,name,alias');
    duplicates = nip ? duplicates.eq('nip', nip) : duplicates.eq('name', orgName);
    const existing = await duplicates.limit(5);
    if (existing.error) fail(existing.error.message);
    if (existing.data?.length) {
      return { duplicate: 'organization', message: 'Taka organizacja jest już w bazie. Wybierz ją z listy.', results: (existing.data as Row[]).map((row) => ({ ...organizationView(row), email: '', type: '' })) };
    }
    const created = await ctx.supabase.from('organizations').insert({ name: orgName, nip: nip || null, organization_type: 'client', business_type: 'company' }).select('id,name,alias').single();
    if (created.error) fail(created.error.message);
    organization = created.data as Row;
  }
  if (!contact) {
    const created = await ctx.supabase.from('contacts').insert({
      first_name: first, last_name: last, email: mail || null, phone: phone || null, contact_type: type, status: 'active', lifecycle_status: 'prospect',
    }).select('id,full_name,first_name,last_name,email,contact_type').single();
    if (created.error) fail(created.error.message);
    contact = created.data as Row;
  } else if (contact.contact_type !== type) {
    const updated = await ctx.supabase.from('contacts').update({ contact_type: type }).eq('id', contact.id).select('id').single();
    if (updated.error) fail(updated.error.message);
  }
  if (organization) {
    const linked = await ctx.supabase.from('contact_organizations')
      .upsert({ contact_id: contact.id, organization_id: organization.id, is_current: true }, { onConflict: 'contact_id,organization_id' });
    if (linked.error) fail(linked.error.message);
  }
  let update = ctx.supabase.from('tasks').update({ contact_id: contact.id, organization_id: organization?.id || null }).eq('id', id);
  update = expectedContact ? update.eq('contact_id', expectedContact) : update.is('contact_id', null);
  update = expectedOrganization ? update.eq('organization_id', expectedOrganization) : update.is('organization_id', null);
  const saved = await update.select('id').maybeSingle();
  if (saved.error || !saved.data) fail('Nie udało się powiązać klienta. Odśwież zapytanie; utworzone rekordy pozostają w bazie.');
  return { ok: true, contactId: text(contact.id), organizationId: organization ? text(organization.id) : null };
}

// MARK: Zespół zapytania

const teamPerson = (row: Row) => ({ id: text(row.id), name: fullName(row), active: row.active !== false });

function teamView(data: Row | null, owner: Row | null) {
  return {
    owner: owner ? { id: text(owner.id), name: fullName(owner) } : null,
    members: ((data?.members || []) as Row[]).map(teamPerson),
    candidates: ((data?.candidates || []) as Row[]).map(teamPerson),
    canManageTeam: data?.canManageTeam === true,
    isMember: data?.isMember === true,
  };
}

export async function inquiryTeam(ctx: NativeContext, rawId: unknown) {
  const id = inquiryId(rawId);
  const { inquiry } = await inquiryRights(ctx, id);
  const { data, error } = await ctx.supabase.rpc('get_inquiry_team', { p_inquiry_id: id });
  if (error) fail(error.code === 'PGRST202' ? 'Zakładka Zespół wymaga aktualizacji bazy danych.' : 'Nie udało się pobrać zespołu zapytania.');
  return teamView(data as Row, one(inquiry.inquiry_owner));
}

export async function setInquiryTeamMember(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  const employee = text(body.employeeId);
  if (!UUID.test(employee)) fail('Nieprawidłowy pracownik.');
  const { data, error } = await ctx.supabase.rpc('set_inquiry_team_member', { p_inquiry_id: id, p_employee_id: employee, p_active: body.active === true });
  if (error) fail(error.code === 'PGRST202' ? 'Zarządzanie zespołem wymaga aktualizacji bazy danych.' : error.message || 'Nie udało się zapisać zespołu.');
  const { inquiry } = await inquiryRights(ctx, id).catch(() => ({ inquiry: {} as Row }));
  return teamView(data as Row, one(inquiry.inquiry_owner));
}

// MARK: Zadania zapytania

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const COLUMNS = ['todo', 'in_progress', 'review', 'completed'];

export async function inquiryTasks(ctx: NativeContext, rawId: unknown) {
  const id = inquiryId(rawId);
  const { rights } = await inquiryRights(ctx, id);
  const [tasks, employees] = await Promise.all([
    ctx.supabase.from('tasks')
      .select('id, title, description, priority, status, board_column, due_date, created_at, task_assignees(employee_id, employees:employees!task_assignees_employee_id_fkey(id, name, surname))')
      .eq('inquiry_id', id).eq('is_inquiry', false).eq('is_private', false).order('created_at', { ascending: false }),
    rights.canManage
      ? ctx.supabase.from('employees').select('id, name, surname').eq('is_active', true).order('surname').order('name')
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (tasks.error) fail('Nie udało się pobrać zadań zapytania.');
  return {
    tasks: ((tasks.data || []) as Row[]).map((task) => ({
      id: text(task.id),
      title: text(task.title),
      description: text(task.description),
      priority: text(task.priority) || 'medium',
      column: text(task.board_column) || text(task.status) || 'todo',
      dueDate: task.due_date ?? null,
      createdAt: task.created_at ?? null,
      assignees: ((task.task_assignees || []) as Row[]).map((row) => fullName(one(row.employees))).filter(Boolean),
    })),
    employees: ((employees.data || []) as Row[]).map((row) => ({ id: text(row.id), name: fullName(row) })),
    canManage: rights.canManage,
  };
}

/** „Nowe zadanie” w zapytaniu jak `createTask` (autor i właściciel — pracownik, przypisania z powiadomieniem push). */
export async function createInquiryTask(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  await requireManage(ctx, id);
  const title = text(body.title).trim();
  if (!title) fail('Tytuł zadania jest wymagany.');
  const priority = PRIORITIES.includes(text(body.priority)) ? text(body.priority) : 'medium';
  const column = COLUMNS.includes(text(body.column)) ? text(body.column) : 'todo';
  let due: string | null = null;
  if (body.dueDate) {
    const date = new Date(text(body.dueDate));
    if (Number.isNaN(date.getTime())) fail('Nieprawidłowy termin zadania.');
    due = date.toISOString();
  }
  const { data: task, error } = await ctx.supabase.from('tasks').insert({
    title,
    description: text(body.description).trim() || null,
    priority,
    board_column: column,
    due_date: due,
    status: column === 'review' ? 'in_progress' : column,
    is_private: false,
    event_id: null,
    inquiry_id: id,
    is_inquiry: false,
    owner_id: ctx.employee.id,
    created_by: ctx.employee.id,
  }).select('id').single();
  if (error) fail(error.message || 'Błąd podczas zapisywania zadania.');
  const assignees = [...new Set((Array.isArray(body.assignees) ? body.assignees : []).map(text).filter((value: string) => UUID.test(value)))];
  if (assignees.length) {
    const { data: inserted, error: assignError } = await ctx.supabase.from('task_assignees')
      .upsert(assignees.map((employee) => ({ task_id: task.id, employee_id: employee, assigned_by: ctx.employee.id })), { onConflict: 'task_id,employee_id', ignoreDuplicates: true })
      .select('id');
    if (assignError) fail(`Zadanie utworzone, ale nie udało się przypisać osób: ${assignError.message}`);
    for (const assignment of (inserted || []) as Row[]) {
      const push = await ctx.supabase.functions.invoke('send-task-assignment-push', { body: { assignment_id: assignment.id } });
      if (push.error) console.warn('[native-inquiries] task assignment push failed', push.error);
    }
  }
  return { ok: true, taskId: text(task.id) };
}

// MARK: Wydarzenie z zapytania (`ConvertInquiryModal`)

/** Okno „Utwórz wydarzenie” / „Przygotuj realizację”: nazwa, termin z zapytania (dzień i godzina rozpoczęcia), kategorie, działalności. */
export async function inquiryConvertSetup(ctx: NativeContext, rawId: unknown) {
  const id = inquiryId(rawId);
  const inquiry = await requireManage(ctx, id, true);
  const info = details(inquiry);
  const [categories, companies] = await Promise.all([
    ctx.supabase.from('event_categories').select('id, name').eq('is_active', true).order('order_index'),
    ctx.supabase.from('my_companies').select('id, name, legal_name, is_default').eq('is_active', true).order('is_default', { ascending: false }),
  ]);
  if (categories.error || companies.error) fail('Nie udało się pobrać kategorii i działalności.');
  const start = text(info.event_start_time).slice(0, 5);
  const termin = text(info.termin !== undefined ? info.termin : inquiry.due_date);
  let dateLocal = '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(termin)) dateLocal = `${termin}T${/^\d{2}:\d{2}$/.test(start) ? start : '00:00'}`;
  else if (termin && !Number.isNaN(new Date(termin).getTime())) {
    const date = new Date(termin);
    const day = date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
    const time = date.toLocaleTimeString('sv-SE', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });
    dateLocal = `${day}T${/^\d{2}:\d{2}$/.test(start) ? start : time}`;
  }
  const companyRows = (companies.data || []) as Row[];
  const endDate = text(info.event_end_date);
  return {
    name: inquiryTitleLabel(inquiry.title),
    dateLocal,
    endNote: endDate && info.event_single_day !== true
      ? `Zakończenie z zapytania: ${new Date(`${endDate}T12:00:00`).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' })}${info.event_end_time ? `, ${text(info.event_end_time)}` : ''}`
      : '',
    location: text(info.location_text),
    categories: ((categories.data || []) as Row[]).map((row) => ({ id: text(row.id), name: text(row.name) })),
    companies: companyRows.map((row) => ({ id: text(row.id), name: text(row.legal_name) || text(row.name) })),
    companyId: text((companyRows.find((row) => row.is_default) || companyRows[0])?.id),
    realization: Boolean(inquiry.accepted_offer_id),
    needsClient: !inquiry.contact_id && !inquiry.organization_id,
  };
}

export async function convertInquiry(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  const inquiry = await requireManage(ctx, id, true);
  if (!inquiry.contact_id && !inquiry.organization_id) fail('Najpierw powiąż klienta z zapytaniem.');
  const name = text(body.name).trim();
  if (!name) fail('Podaj nazwę eventu.');
  const date = new Date(text(body.date));
  if (!text(body.date) || Number.isNaN(date.getTime())) fail('Uzupełnij poprawny termin eventu.');
  const category = uuidOrNull(body.categoryId, 'Nieprawidłowa kategoria.');
  const company = uuidOrNull(body.companyId, 'Nieprawidłowa działalność.');
  const { data, error } = await ctx.supabase.rpc(inquiry.accepted_offer_id ? 'prepare_inquiry_realization' : 'convert_inquiry_to_event', {
    p_inquiry_id: id, p_event_name: name, p_event_date: date.toISOString(), p_category_id: category, p_my_company_id: company,
  });
  if (error) fail(error.message || 'Nie udało się utworzyć eventu.');
  return { ok: true, eventId: text(data) };
}
