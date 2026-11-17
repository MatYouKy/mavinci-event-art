import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NativeContext } from './auth';
import { inquiryAccess } from './inquiries';
import { inquirySourceLabel, inquiryTitleLabel, inquiryTypeLabels, systemLabel } from '@/lib/ui/systemLabels';
import { LOST_REASON_CATEGORIES, STAGES } from '@/lib/CRM/inquiries/pipeline';
import { cleanInquiryMessage } from '@/lib/CRM/inquiries/cleanInquiryMessage';
import { parseInquiryContact } from '@/lib/CRM/inquiries/parseInquiryContact';
import { formatEventAssumptionItems, normalizeEventAssumptionItems } from '@/lib/CRM/Offers/eventAssumptions';

/*
 * Karta zapytania na Macu — odpowiednik strony `/crm/inquiries/[id]` (`InquiryWorkspaceClient`, dane jak
 * `fetchInquiryWorkspaceServer`), tokenem pracownika (RLS). Uprawnienia jak w CRM: `canLead` (opiekun z uprawnieniem,
 * menedżer zespołu, „wszystkie”, administrator) i `canManage` (także członek zespołu zapytania). Czynności tymi samymi
 * zapisami i funkcjami bazy co przeglądarka: nazwa, ustalenia (`save_inquiry_brief`), kontakt podjęty
 * (`mark_inquiry_contacted`), etap z powodem utraty, ponowne negocjacje, notatki (`add_inquiry_note`), przekazanie
 * (`reassign_inquiry`), nowa oferta i kalkulacja, akceptacja i kopia oferty.
 */

type Row = Record<string, any>;
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

export function fail(message: string): never {
  throw new Error(message);
}
const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const one = (value: unknown): Row | null => (Array.isArray(value) ? (value[0] as Row) ?? null : value && typeof value === 'object' ? (value as Row) : null);
const person = (value: unknown) => {
  const row = one(value);
  return row ? `${row.name ?? ''} ${row.surname ?? ''}`.trim() : '';
};
export const inquiryId = (value: unknown) => {
  const id = String(value || '');
  if (!UUID.test(id)) fail('Nieprawidłowe zapytanie.');
  return id;
};

const INQUIRY_FIELDS = `
  id, title, description, due_date, created_at, updated_at,
  inquiry_details, inquiry_stage, inquiry_owner_id, next_action_at, last_contact_at,
  estimated_value, win_probability, lost_reason, lost_reason_category, linked_offer_id, event_id, archived_at,
  accepted_offer_id, accepted_calculation_id, brief_revision, contact_id, organization_id,
  inquiry_owner:employees!tasks_inquiry_owner_id_fkey(id, name, surname, sales_team_id),
  contact:contacts(id, first_name, last_name, full_name, email, phone, mobile),
  organization:organizations(id, name, alias, email, phone)`;

async function loadInquiry(ctx: NativeContext, id: string) {
  const { data, error } = await ctx.supabase.from('tasks').select(INQUIRY_FIELDS).eq('id', id).eq('is_inquiry', true).maybeSingle();
  if (error) throw error;
  if (!data) fail('Nie znaleziono zapytania albo nie masz do niego dostępu.');
  return data as Row;
}

/**
 * Kontekst kalkulacji zapytania jak `calculationContext` w `InquiryWorkspaceClient`: wydarzenie zapytania (gdy powstało),
 * nazwa (tytuł zapytania), termin (`termin` albo termin zadania) i klient (osoba, organizacja albo dane z formularza).
 */
export async function inquiryCalculationContext(ctx: NativeContext, rawId: unknown) {
  const inquiry = await loadInquiry(ctx, inquiryId(rawId));
  const details: Row = inquiry.inquiry_details && typeof inquiry.inquiry_details === 'object' ? inquiry.inquiry_details : {};
  const contact = one(inquiry.contact);
  const organization = one(inquiry.organization);
  const parsed = parseInquiryContact(details.client_text, details.client_email);
  return {
    id: String(inquiry.id),
    eventId: typeof inquiry.event_id === 'string' ? (inquiry.event_id as string) : null,
    name: inquiryTitleLabel(inquiry.title),
    date: text(details.termin) || text(inquiry.due_date) || null,
    client: {
      name: text(contact?.full_name) || text(organization?.alias) || text(organization?.name) || parsed.fullName || inquiryTitleLabel(inquiry.title),
      email: text(contact?.email) || parsed.email || text(organization?.email),
      phone: text(contact?.mobile) || text(contact?.phone) || text(organization?.phone) || text(details.client_phone),
    },
  };
}

/** `canLead` / `canManage` jak w `InquiryWorkspaceClient`. */
async function permissions(ctx: NativeContext, inquiry: Row, team: Row | null) {
  const has = (scope: string) => ctx.employee.permissions.includes(scope);
  const access = await inquiryAccess(ctx);
  const owner = one(inquiry.inquiry_owner);
  const archived = Boolean(inquiry.archived_at);
  const canLead = !archived && (ctx.employee.isAdmin
    || has('inquiries_manage_all')
    || (inquiry.inquiry_owner_id === ctx.employee.id && (has('inquiries_manage') || has('inquiries_manage_own')))
    || Boolean(access.isTeamManager && access.salesTeamId && owner?.sales_team_id === access.salesTeamId && has('inquiries_manage_team')));
  return { canLead, canManage: !archived && (canLead || Boolean(team?.isMember)), canAssign: access.canAssign };
}

/** Ustalenia zapytania jak `createInquiryBriefDraft` w CRM (tekst do formularza). */
function briefOf(inquiry: Row) {
  const details: Row = inquiry.inquiry_details && typeof inquiry.inquiry_details === 'object' ? inquiry.inquiry_details : {};
  const value = (key: string) => (details[key] === null || details[key] === undefined ? '' : String(details[key]));
  return {
    termin: details.termin !== undefined ? value('termin') : text(inquiry.due_date),
    eventSingleDay: details.event_single_day !== undefined ? details.event_single_day === true : !details.event_end_date && !details.event_end_next_day,
    eventEndDate: value('event_end_date'),
    eventStartTime: value('event_start_time'),
    eventEndTime: value('event_end_time'),
    eventEndNextDay: details.event_end_next_day === true,
    locationText: value('location_text'),
    locationId: value('location_id'),
    guestCount: value('guest_count'),
    guestCountText: value('guest_count_text'),
    scope: value('scope'),
    budgetMin: details.preliminary_budget_min !== null && details.preliminary_budget_min !== undefined
      ? String(details.preliminary_budget_min)
      : details.preliminary_budget_max == null && inquiry.estimated_value != null && Number(inquiry.estimated_value) > 0 ? String(inquiry.estimated_value) : '',
    budgetMax: value('preliminary_budget_max'),
    budgetText: value('preliminary_budget_text'),
    conversationNotes: value('conversation_notes'),
    eventGoal: value('event_goal'),
    questions: (Array.isArray(details.questions) ? details.questions : []).map((question: Row) => ({
      question: text(question?.question), answer: text(question?.answer), status: text(question?.status) || 'open',
    })),
  };
}

const money = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 }).format(number)} zł` : '';
};

/** Termin i godziny jak `formatInquirySchedule` w CRM. */
function scheduleText(details: Row, fallback: unknown) {
  const raw = details.termin !== undefined ? details.termin : fallback;
  const date = raw ? new Date(String(raw)) : null;
  const dateLabel = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' }) : text(raw);
  if (details.event_end_date && details.event_single_day !== true) {
    const end = new Date(`${details.event_end_date}T12:00:00`);
    const endLabel = Number.isNaN(end.getTime()) ? text(details.event_end_date) : end.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' });
    return `${dateLabel} ${text(details.event_start_time)} – ${endLabel} ${text(details.event_end_time)}`.replace(/\s+/g, ' ').trim();
  }
  const hours = details.event_start_time || details.event_end_time
    ? `${details.event_start_time || '?'} – ${details.event_end_time || '?'}${details.event_end_next_day ? ' (następnego dnia)' : ''}`
    : '';
  return [dateLabel, hours].filter(Boolean).join(', ');
}

const ACTIVITY_LABELS: Record<string, string> = {
  note: 'Notatka', call_note: 'Rozmowa telefoniczna', contact: 'Kontakt z klientem', email: 'E-mail', handoff: 'Przekazanie do realizacji',
  stage: 'Zmiana etapu', offer: 'Oferta', calculation: 'Kalkulacja', analysis: 'Analiza AI',
};

export async function inquiryWorkspace(ctx: NativeContext, rawId: unknown) {
  const id = inquiryId(rawId);
  const inquiry = await loadInquiry(ctx, id);
  const [offersRes, calculationsRes, historyRes, activityRes, teamRes] = await Promise.all([
    ctx.supabase.from('offers')
      .select('id, title, event_id, guest_count, offer_number, status, total_amount, package_mode, accepted_package_id, pricing_source, offer_packages!offer_packages_offer_id_fkey(id,name,price_net), valid_until, created_at')
      .eq('inquiry_id', id).order('created_at', { ascending: false }),
    ctx.supabase.from('event_calculations')
      .select('id, name, created_at, is_accepted, generated_pdf_path, event_calculation_items(quantity, unit_price, days)')
      .eq('inquiry_id', id).order('created_at', { ascending: false }),
    ctx.supabase.from('inquiry_stage_history')
      .select('id, from_stage, to_stage, reason, created_at, changed_by_employee:employees!changed_by(id, name, surname)')
      .eq('inquiry_id', id).order('created_at', { ascending: false }).limit(100),
    ctx.supabase.from('inquiry_activity').select('id, kind, body, created_at, metadata')
      .eq('inquiry_id', id).order('created_at', { ascending: false }).limit(200),
    ctx.supabase.rpc('get_inquiry_team', { p_inquiry_id: id }),
  ]);
  for (const result of [offersRes, calculationsRes, historyRes, activityRes]) if (result.error) throw result.error;
  const team = teamRes.error ? null : (teamRes.data as Row | null);
  const rights = await permissions(ctx, inquiry, team);

  const details: Row = inquiry.inquiry_details && typeof inquiry.inquiry_details === 'object' ? inquiry.inquiry_details : {};
  const contact = one(inquiry.contact);
  const organization = one(inquiry.organization);
  const parsed = parseInquiryContact(details.client_text, details.client_email);
  const clientEmail = text(contact?.email) || parsed.email || text(organization?.email);
  const clientPhone = text(contact?.mobile) || text(contact?.phone) || text(organization?.phone) || text(details.client_phone);
  const clientName = text(contact?.full_name) || text(organization?.alias) || text(organization?.name) || parsed.fullName || inquiryTitleLabel(inquiry.title);
  const message = text(details.source_message_content) || text(inquiry.description);
  const clean = cleanInquiryMessage(message);
  const budgetMin = details.preliminary_budget_min;
  const budgetMax = details.preliminary_budget_max;
  const budget = budgetMin != null && budgetMax != null && Number(budgetMin) !== Number(budgetMax)
    ? `${money(budgetMin)} – ${money(budgetMax)}`
    : budgetMin != null || budgetMax != null ? money(budgetMin ?? budgetMax)
    : inquiry.estimated_value ? money(inquiry.estimated_value) : text(details.budget);
  const owner = one(inquiry.inquiry_owner);
  const sourceHref = details.received_email_id ? `/crm/messages/${details.received_email_id}?type=received`
    : details.source_message_id ? `/crm/messages/${details.source_message_id}?type=contact` : null;

  return {
    inquiry: {
      id,
      title: text(inquiry.title),
      titleLabel: inquiryTitleLabel(inquiry.title),
      sourceLabel: inquirySourceLabel(details),
      typeLabels: inquiryTypeLabels(text(inquiry.title), details),
      stage: text(inquiry.inquiry_stage) || 'new',
      ownerId: inquiry.inquiry_owner_id ?? null,
      ownerName: owner ? `${owner.name ?? ''} ${owner.surname ?? ''}`.trim() : '',
      createdAt: inquiry.created_at,
      nextActionAt: inquiry.next_action_at ?? null,
      lastContactAt: inquiry.last_contact_at ?? null,
      estimatedValue: inquiry.estimated_value == null ? null : Number(inquiry.estimated_value),
      probability: Number(inquiry.win_probability ?? 0),
      lostReason: text(inquiry.lost_reason),
      lostReasonCategory: text(inquiry.lost_reason_category),
      linkedOfferId: inquiry.linked_offer_id ?? null,
      acceptedOfferId: inquiry.accepted_offer_id ?? null,
      eventId: inquiry.event_id ?? null,
      contactId: inquiry.contact_id ?? null,
      organizationId: inquiry.organization_id ?? null,
      archived: Boolean(inquiry.archived_at),
      briefRevision: Number(inquiry.brief_revision || 1),
    },
    message: { full: message, clean: clean.text, trimmed: clean.trimmed, sourceHref },
    client: {
      name: clientName, email: clientEmail, phone: clientPhone,
      contactName: text(contact?.full_name),
      organizationName: text(organization?.alias) || text(organization?.name),
    },
    summary: {
      schedule: scheduleText(details, inquiry.due_date),
      location: text(details.location_text),
      guests: details.guest_count == null ? '' : `${details.guest_count} osób`,
      guestsHint: details.guest_count == null && details.guest_count_text ? `Z wiadomości: ${details.guest_count_text} — wymaga ustalenia liczby do wyceny.` : '',
      scope: text(details.scope) || (details.event_type ? systemLabel(details.event_type, 'eventType') : ''),
      budget,
    },
    brief: briefOf(inquiry),
    offers: ((offersRes.data || []) as Row[]).map((offer) => ({
      id: String(offer.id),
      number: text(offer.offer_number),
      title: text(offer.title) || 'Oferta',
      status: text(offer.status),
      statusLabel: systemLabel(offer.status),
      total: offer.total_amount == null ? null : Number(offer.total_amount),
      guestCount: offer.guest_count == null ? null : Number(offer.guest_count),
      eventId: offer.event_id ?? null,
      packageMode: Boolean(offer.package_mode) && offer.pricing_source !== 'calculation',
      packages: ((offer.offer_packages || []) as Row[]).map((pkg) => ({ id: String(pkg.id), name: text(pkg.name), priceNet: Number(pkg.price_net || 0) })),
      acceptedPackageId: offer.accepted_package_id ?? null,
      createdAt: offer.created_at,
      validUntil: offer.valid_until ?? null,
    })),
    calculations: ((calculationsRes.data || []) as Row[]).map((calculation) => ({
      id: String(calculation.id),
      name: text(calculation.name) || 'Kalkulacja',
      createdAt: calculation.created_at,
      accepted: Boolean(calculation.is_accepted) || calculation.id === inquiry.accepted_calculation_id,
      total: ((calculation.event_calculation_items || []) as Row[])
        .reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0) * Number(item.days || 1), 0),
      // Lista jak `InquiryCalculationsPanel`: liczba pozycji, „PDF gotowy” / „Robocza”, „Wybrana kalkulacja”.
      itemsCount: ((calculation.event_calculation_items || []) as Row[]).length,
      pdf: Boolean(calculation.generated_pdf_path),
      selected: calculation.id === inquiry.accepted_calculation_id,
    })),
    activity: ((activityRes.data || []) as Row[]).map((entry) => ({
      id: String(entry.id), kind: text(entry.kind), kindLabel: ACTIVITY_LABELS[text(entry.kind)] || 'Wpis', body: text(entry.body), at: entry.created_at,
    })),
    stageHistory: ((historyRes.data || []) as Row[]).map((entry) => ({
      id: String(entry.id),
      from: STAGES.find((stage) => stage.id === entry.from_stage)?.label || text(entry.from_stage),
      to: STAGES.find((stage) => stage.id === entry.to_stage)?.label || text(entry.to_stage),
      reason: text(entry.reason), at: entry.created_at, by: person(entry.changed_by_employee),
    })),
    teamCount: team && Array.isArray(team.members) ? team.members.length : 0,
    permissions: rights,
    stages: STAGES.map((stage) => ({ id: stage.id, label: stage.label, probability: stage.defaultProbability })),
    lostCategories: LOST_REASON_CATEGORIES.map(([value, label]) => ({ value, label })),
  };
}

// MARK: Czynności

/** Zapytanie z uprawnieniami pracownika — także dla zakładek ładowanych osobno (`inquiryWorkspaceTools.ts`). */
export async function inquiryRights(ctx: NativeContext, id: string) {
  const inquiry = await loadInquiry(ctx, id);
  const teamRes = await ctx.supabase.rpc('get_inquiry_team', { p_inquiry_id: id });
  const rights = await permissions(ctx, inquiry, teamRes.error ? null : (teamRes.data as Row | null));
  return { inquiry, rights };
}

export async function requireManage(ctx: NativeContext, id: string, lead = false) {
  const { inquiry, rights } = await inquiryRights(ctx, id);
  if (lead ? !rights.canLead : !rights.canManage) fail('Nie masz uprawnień do tej czynności w zapytaniu.');
  return inquiry;
}

const rpcError = (error: { message?: string } | null, fallback: string) => { if (error) fail(error.message || fallback); };

export async function saveInquiryTitle(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  await requireManage(ctx, id);
  const title = text(body.title).trim();
  if (!title) fail('Wpisz nazwę zapytania.');
  if (title.length > 300) fail('Nazwa zapytania jest za długa.');
  let query = ctx.supabase.from('tasks').update({ title }).eq('id', id).is('archived_at', null);
  query = body.expected == null ? query.is('title', null) : query.eq('title', text(body.expected));
  const { data, error } = await query.select('id').maybeSingle();
  if (error) fail(error.message);
  if (!data) fail('Nie zapisano nazwy. Zapytanie mogło zostać zmienione lub nie masz już uprawnień. Odśwież dane.');
  return { ok: true };
}

/** Ustalenia (`save_inquiry_brief`) — pola formularza na Macu, reszta szczegółów bez zmian. */
export async function saveInquiryBrief(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  const inquiry = await requireManage(ctx, id);
  const brief: Row = body.brief && typeof body.brief === 'object' ? body.brief : {};
  const details: Row = inquiry.inquiry_details && typeof inquiry.inquiry_details === 'object' ? inquiry.inquiry_details : {};
  const date = (value: unknown) => {
    const raw = text(value).trim();
    if (!raw) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) fail('Nieprawidłowa data.');
    return raw;
  };
  const time = (value: unknown) => {
    const raw = text(value).trim();
    if (!raw) return null;
    if (!/^\d{2}:\d{2}$/.test(raw)) fail('Nieprawidłowa godzina.');
    return raw;
  };
  const amount = (value: unknown) => {
    const raw = text(value).replace(/\s/g, '').replace(',', '.');
    if (!raw) return null;
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) fail('Nieprawidłowa kwota budżetu.');
    return raw;
  };
  const guests = text(brief.guestCount).trim();
  if (guests && (!/^\d{1,6}$/.test(guests) || Number(guests) < 1)) fail('Liczba osób musi być liczbą całkowitą.');
  const singleDay = brief.eventSingleDay !== false;
  const start = time(brief.eventStartTime);
  const end = time(brief.eventEndTime);
  const notes = text(brief.conversationNotes);
  const nextDetails = {
    ...details,
    location_text: text(brief.locationText).trim(),
    // Lokalizacja z bazy zostaje, dopóki nie zmienił się jej opis.
    location_id: text(brief.locationText).trim() === text(details.location_text).trim() ? details.location_id || null : null,
    event_start_time: start,
    event_end_time: end,
    event_end_next_day: Boolean(end && brief.eventEndNextDay === true && singleDay),
    event_single_day: singleDay,
    event_end_date: singleDay ? null : date(brief.eventEndDate),
    termin: date(brief.termin),
    scope: text(brief.scope).trim(),
    guest_count: guests ? Number(guests) : null,
    preliminary_budget_min: amount(brief.budgetMin),
    preliminary_budget_max: amount(brief.budgetMax),
    conversation_notes: notes,
  };
  const { data, error } = await ctx.supabase.rpc('save_inquiry_brief', {
    p_inquiry: id,
    p_expected_revision: Number(body.revision || inquiry.brief_revision || 1),
    p_details: nextDetails,
    p_contact_note: notes !== text(details.conversation_notes) ? notes : null,
  });
  rpcError(error, 'Nie udało się zapisać ustaleń zapytania.');
  return { ok: true, revision: Number((data as Row | null)?.brief_revision || 0) };
}

export async function markInquiryContacted(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  await requireManage(ctx, id);
  const { error } = await ctx.supabase.rpc('mark_inquiry_contacted', { p_inquiry: id });
  rpcError(error, 'Nie udało się oznaczyć kontaktu.');
  return { ok: true };
}

/** Zmiana etapu jak `InquiryStageModal`: prawdopodobieństwo etapu, powód utraty, kontrola etapu wyjściowego. */
export async function changeInquiryStage(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  const inquiry = await requireManage(ctx, id, true);
  const stage = STAGES.find((item) => item.id === text(body.stage));
  if (!stage) fail('Nieprawidłowy etap.');
  const expected = text(body.expected) || text(inquiry.inquiry_stage);
  const category = text(body.category);
  const reason = text(body.reason).trim();
  if (stage.id === 'lost' && (!LOST_REASON_CATEGORIES.some(([value]) => value === category) || !reason)) {
    fail('Wybierz kategorię i opisz powód przegrania zapytania.');
  }
  const { data, error } = await ctx.supabase.from('tasks').update({
    inquiry_stage: stage.id,
    win_probability: stage.defaultProbability,
    lost_reason: stage.id === 'lost' ? reason : null,
    lost_reason_category: stage.id === 'lost' ? category : null,
  }).eq('id', id).eq('is_inquiry', true).eq('inquiry_stage', expected).is('archived_at', null).select('id').maybeSingle();
  if (error) fail(error.message);
  if (!data) fail('Zapytanie zostało zmienione lub nie masz uprawnień do zapisu. Odśwież szczegóły i spróbuj ponownie.');
  return { ok: true };
}

export async function reopenInquiryNegotiation(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  await requireManage(ctx, id, true);
  const reason = text(body.reason).trim();
  if (!reason) fail('Podaj powód ponownego otwarcia negocjacji.');
  const { error } = await ctx.supabase.rpc('reopen_inquiry_negotiation', { p_inquiry: id, p_reason: reason });
  rpcError(error, 'Nie udało się otworzyć negocjacji ponownie.');
  return { ok: true };
}

export async function addInquiryNote(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  await requireManage(ctx, id, true);
  const note = text(body.body).trim();
  if (!note) fail('Wpisz treść notatki.');
  if (note.length > 10000) fail('Notatka jest za długa.');
  const kind = ['note', 'call_note', 'contact'].includes(text(body.kind)) ? text(body.kind) : 'note';
  const requestId = UUID.test(text(body.requestId)) ? text(body.requestId) : randomUUID();
  const { error } = await ctx.supabase.rpc('add_inquiry_note', { p_inquiry: id, p_body: note, p_kind: kind, p_request_id: requestId });
  rpcError(error, 'Nie udało się zapisać notatki.');
  return { ok: true };
}

export async function inquiryHandoffCandidates(ctx: NativeContext, rawId: unknown) {
  const id = inquiryId(rawId);
  const { data, error } = await ctx.supabase.rpc('get_inquiry_handoff_candidates', { p_inquiry_id: id });
  if (error) fail(error.code === 'PGRST202' ? 'Obsługa przekazywania zapytań wymaga aktualizacji bazy danych.' : error.message || 'Nie udało się pobrać listy opiekunów.');
  return { candidates: ((data || []) as Row[]).map((row) => ({ id: String(row.id), name: `${row.name ?? ''} ${row.surname ?? ''}`.trim() })) };
}

export async function handOffInquiry(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  const inquiry = await requireManage(ctx, id, true);
  const target = body.ownerId ? text(body.ownerId) : null;
  if (target && !UUID.test(target)) fail('Nieprawidłowy opiekun.');
  const { error } = await ctx.supabase.rpc('reassign_inquiry', {
    p_inquiry_id: id, p_expected_owner_id: inquiry.inquiry_owner_id, p_new_owner_id: target,
  });
  rpcError(error, 'Nie udało się zmienić opiekuna.');
  return { ok: true };
}

/** Nowa oferta jak `createOffer` w CRM: szkic z ustaleń zapytania, klient zapytania, powiązanie z zapytaniem. */
export async function createInquiryOffer(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  const inquiry = await requireManage(ctx, id);
  if (!inquiry.organization_id && !inquiry.contact_id) fail('Najpierw powiąż klienta z zapytaniem — oferta potrzebuje klienta.');
  const details: Row = inquiry.inquiry_details && typeof inquiry.inquiry_details === 'object' ? inquiry.inquiry_details : {};
  let approved: string | null = null;
  if (details.approved_summary) {
    const { data, error } = await ctx.supabase.rpc('get_inquiry_approved_summary', { p_inquiry: id });
    if (error) fail(error.message);
    approved = (data as string | null) || null;
  }
  const items = normalizeEventAssumptionItems(details.event_assumption_items, text(details.event_assumptions));
  const offerId = UUID.test(text(body.offerId)) ? text(body.offerId) : randomUUID();
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 14);
  const { error } = await ctx.supabase.from('offers').upsert({
    id: offerId,
    inquiry_id: id,
    source_brief_revision: Number(inquiry.brief_revision || 1),
    notes: approved ? `Zatwierdzone podsumowanie zapytania:\n${approved}` : null,
    event_id: inquiry.event_id || null,
    client_type: inquiry.organization_id ? 'business' : 'individual',
    organization_id: inquiry.organization_id || null,
    contact_id: inquiry.contact_id || null,
    valid_until: validUntil.toISOString(),
    status: 'draft',
    total_amount: 0,
    created_by: ctx.employee.id,
    event_location: text(details.location_text) || null,
    guest_count: details.guest_count == null ? null : Number(details.guest_count),
    event_assumptions: formatEventAssumptionItems(items) || text(details.scope) || null,
    event_assumption_items: items,
    event_goal: text(details.event_goal) || null,
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) fail(error.message);
  const { error: linkError } = await ctx.supabase.from('tasks').update({ linked_offer_id: offerId }).eq('id', id);
  if (linkError) fail(linkError.message);
  return { ok: true, offerId };
}

export async function createInquiryCalculation(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  const inquiry = await requireManage(ctx, id);
  const details: Row = inquiry.inquiry_details && typeof inquiry.inquiry_details === 'object' ? inquiry.inquiry_details : {};
  let approved: string | null = null;
  if (details.approved_summary) {
    const { data } = await ctx.supabase.rpc('get_inquiry_approved_summary', { p_inquiry: id });
    approved = (data as string | null) || null;
  }
  const { data, error } = await ctx.supabase.from('event_calculations').insert({
    event_id: inquiry.event_id || null,
    inquiry_id: id,
    name: `Kalkulacja — ${inquiryTitleLabel(inquiry.title)}`,
    notes: approved ? `Zatwierdzone podsumowanie zapytania:\n${approved}` : null,
    created_by: ctx.employee.id,
  }).select('id').single();
  if (error) fail(error.message);
  return { ok: true, calculationId: String((data as Row).id) };
}

export async function acceptInquiryOffer(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  const inquiry = await requireManage(ctx, id);
  const offer = text(body.offerId);
  if (!UUID.test(offer)) fail('Nieprawidłowa oferta.');
  const note = text(body.note).trim();
  if (!note) fail('Opisz, kto i jak potwierdził zakres.');
  const pkg = body.packageId ? text(body.packageId) : null;
  if (pkg && !UUID.test(pkg)) fail('Nieprawidłowy pakiet.');
  const { error } = await ctx.supabase.rpc('accept_inquiry_offer', {
    p_offer: offer, p_note: note, p_expected_selected: inquiry.accepted_offer_id ?? null, p_package: pkg,
  });
  rpcError(error, 'Nie udało się zapisać akceptacji oferty.');
  return { ok: true };
}

export async function duplicateInquiryOffer(ctx: NativeContext, body: Row) {
  const id = inquiryId(body.id);
  await requireManage(ctx, id);
  const offer = text(body.offerId);
  if (!UUID.test(offer)) fail('Nieprawidłowa oferta.');
  const { error } = await ctx.supabase.rpc('duplicate_sales_offer', { p_offer: offer, p_request_id: randomUUID() });
  rpcError(error, 'Nie udało się skopiować oferty.');
  return { ok: true };
}
