import 'server-only';
import type { NativeContext } from './auth';
import { inquiryAccess } from './inquiries';
import { STAGES } from '@/lib/CRM/inquiries/pipeline';

/*
 * „Nowe zapytanie” i „Automatyzacja SLA” dla Maca — jak `NewInquiryModal` (lejek zapytań, kalendarz) i
 * `InquirySlaSettingsModal` na stronie `/crm/inquiries`. Tokenem pracownika: zapis zapytania w `tasks` i ustawień
 * w `inquiry_sla_settings` podlega RLS jak w przeglądarce (ustawienia SLA — `is_inquiry_admin()`).
 * Okno na Macu dodatkowo: osoba kontaktowa razem z organizacją (obecne powiązania `contact_organizations`), opiekun
 * od razu przy zapisie (jak „Przejmij” / przydział w lejku) oraz odbyta rozmowa z terminem kolejnego działania
 * (etap „Kontakt podjęty”, jak „Kontakt wykonany” w lejku).
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InquiryCreateError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new InquiryCreateError(message, status);
}
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Row[] : []);
const uuidOrNull = (value: unknown) => (UUID.test(str(value).trim()) ? str(value).trim() : null);

/** Źródła zapytania wpisywanego ręcznie (`SOURCE_LABELS` w `NewInquiryModal`). */
const SOURCE_LABELS: Record<string, string> = {
  phone: 'Telefon',
  meeting: 'Rozmowa / spotkanie',
  referral: 'Polecenie',
  social_media: 'Social media',
  other: 'Inne źródło',
};

/** Wszystkie wiersze zapytania stronami po 1000 (limit odpowiedzi API). */
async function allRows(build: () => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await build().order('id').range(from, from + 999);
    if (error) break;
    out.push(...rows(data));
    if (!data || data.length < 1000) break;
  }
  return out;
}
/** Listy podpowiedzi formularza: organizacje, osoby kontaktowe (z obecnymi organizacjami) i lokalizacje — całe listy
 * (okno CRM pobiera po 200 rekordów, więc część osób nie była do znalezienia). Lista, której nie udało się pobrać, jest pusta. */
export async function newInquirySetup(ctx: NativeContext) {
  const [orgs, contacts, locations, links] = await Promise.all([
    allRows(() => ctx.supabase.from('organizations').select('id, name, alias, email, phone, city')),
    allRows(() => ctx.supabase.from('contacts').select('id, first_name, last_name, phone, mobile, email, position')),
    allRows(() => ctx.supabase.from('locations').select('id, name, address, city')),
    allRows(() => ctx.supabase.from('contact_organizations').select('contact_id, organization_id, position').eq('is_current', true)),
  ]);
  // Kolejność jak dotąd (organizacje i lokalizacje po nazwie, osoby po nazwisku) — strony są pobierane po identyfikatorze.
  const byText = (pick: (row: Row) => string) => (a: Row, b: Row) => pick(a).localeCompare(pick(b), 'pl');
  orgs.sort(byText((row) => str(row.name)));
  contacts.sort(byText((row) => `${str(row.last_name)} ${str(row.first_name)}`));
  locations.sort(byText((row) => str(row.name)));
  return {
    organizations: orgs.map((org) => ({
      id: str(org.id), name: str(org.name), alias: str(org.alias), email: str(org.email), phone: str(org.phone), city: str(org.city),
    })),
    contacts: contacts.map((contact) => ({
      id: str(contact.id), firstName: str(contact.first_name), lastName: str(contact.last_name),
      phone: str(contact.mobile) || str(contact.phone), email: str(contact.email), position: str(contact.position),
    })),
    locations: locations.map((location) => ({
      id: str(location.id), name: str(location.name), address: str(location.address), city: str(location.city),
    })),
    links: links.filter((link) => link.contact_id && link.organization_id).map((link) => ({
      contactId: str(link.contact_id), organizationId: str(link.organization_id), position: str(link.position),
    })),
  };
}

/**
 * Opiekun od razu przy zapisie: siebie — kto może przejmować zapytania (`canClaim`) albo je przydzielać, inną osobę — kto
 * przydziela (`canAssign`), w zakresie listy „Osoba odpowiedzialna” (wszyscy, zespół albo tylko Ty). Brak — opiekuna ustawia
 * baza: osoba dodająca, jeśli prowadzi zapytania (`src/lib/CRM/inquiries/inquiryCreatorOwner.ts`), inaczej wspólna kolejka.
 */
async function newInquiryOwner(ctx: NativeContext, raw: unknown): Promise<{ id: string; name: string } | null> {
  const value = str(raw).trim();
  if (!value) return null;
  if (!UUID.test(value)) fail('Nieprawidłowy opiekun zapytania.');
  const access = await inquiryAccess(ctx);
  const self = value === ctx.employee.id;
  if (self ? !(access.canClaim || access.canAssign) : !access.canAssign) {
    fail(self
      ? 'Nie masz uprawnienia do przejmowania zapytań — zapisz zapytanie we wspólnej kolejce.'
      : 'Nie masz uprawnienia do przydzielania zapytań innym osobom.', 403);
  }
  const { data, error } = await ctx.supabase.from('employees').select('id, name, surname, is_active, sales_team_id').eq('id', value).maybeSingle();
  const person = data as Row | null;
  if (error || !person || person.is_active !== true) fail('Wybrany opiekun nie jest aktywnym pracownikiem.');
  const everyone = access.isAdmin || access.manageAll || ctx.employee.permissions.includes('inquiries_view_all');
  if (!self && !everyone && !(access.salesTeamId && person!.sales_team_id === access.salesTeamId)) {
    fail('Możesz przydzielić zapytanie tylko osobie ze swojego zespołu.', 403);
  }
  return { id: value, name: `${str(person!.name)} ${str(person!.surname)}`.trim() };
}

/**
 * „Zapisz zapytanie” (`handleSave`): te same sprawdzenia i komunikaty, ten sam zapis — zadanie-zapytanie na początku
 * listy, pilne, etap „Nowe”, opiekun — osoba dodająca, gdy prowadzi zapytania (baza), inaczej wspólna kolejka, szansa 10%,
 * wartość z budżetu, szczegóły źródła. Identyfikator nadaje okno (jak `crypto.randomUUID()` przy otwarciu), więc ponowne
 * kliknięcie nie tworzy duplikatu. Opcjonalnie (okno na Macu): `ownerId` — opiekun od razu, `contacted` — rozmowa już się
 * odbyła (etap „Kontakt podjęty”, szansa etapu),
 * `nextActionAt` — termin kolejnego działania (bez niego baza ustawia własny, jak dotąd).
 */
export async function createInquiry(ctx: NativeContext, body: Row) {
  const id = uuidOrNull(body.id);
  if (!id) fail('Nieprawidłowe zapytanie.');
  const form = body.form && typeof body.form === 'object' ? body.form as Row : {};
  const subject = str(form.subject).trim();
  const source = str(form.source);
  const termin = str(form.termin).trim();
  const scope = str(form.scope);
  const guestCount = str(form.guestCount).trim();
  const budget = str(form.budget);
  const expectations = str(form.expectations);
  const clientText = str(form.clientText);
  // Osoba kontaktowa razem z organizacją (okno na Macu): `clientText` — osoba, `clientCompany` — organizacja.
  const clientCompany = str(form.clientCompany).trim();
  const clientPhone = str(form.clientPhone);
  const clientEmail = str(form.clientEmail);
  const locationText = str(form.locationText);
  const clientOrgId = uuidOrNull(form.clientOrganizationId);
  // Z karty kontaktu okno dostaje osobę i jej jedyną organizację naraz (`initialClient`); wybór z listy ustawia jedno z nich.
  const clientContactId = uuidOrNull(form.clientContactId);
  const locationId = uuidOrNull(form.locationId);

  if (!subject) fail('Podaj temat zapytania.');
  if (!clientText.trim() && !clientPhone.trim() && !clientEmail.trim()) {
    fail('Podaj przynajmniej dane kontaktowe klienta (nazwa, telefon lub e-mail).');
  }
  const guests = guestCount === '' ? null : Number(guestCount);
  if (guests !== null && (!Number.isInteger(guests) || guests < 1 || guests > 100000)) {
    fail('Podaj całkowitą liczbę osób od 1 do 100 000 lub zostaw pole puste.');
  }
  if (!(source in SOURCE_LABELS)) fail('Wybierz źródło zapytania.');
  // Termin jak pole `datetime-local` (czas lokalny) i ten sam moment w UTC (`new Date(termin).toISOString()` w przeglądarce).
  if (termin && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(termin)) fail('Podaj poprawny termin.');
  // Rozmowa z klientem już się odbyła (telefon, spotkanie) — etap „Kontakt podjęty” z datą kontaktu, jak „Kontakt wykonany”.
  const contacted = form.contacted === true;
  const nextRaw = str(form.nextActionAt).trim();
  let nextActionAt: string | null = null;
  if (nextRaw) {
    const parsed = new Date(nextRaw);
    if (Number.isNaN(parsed.getTime())) fail('Podaj poprawny termin kolejnego działania.');
    nextActionAt = parsed.toISOString();
  }
  let dueDate: string | null = null;
  if (termin) {
    const parsed = new Date(str(form.dueDate));
    if (!str(form.dueDate) || Number.isNaN(parsed.getTime())) fail('Podaj poprawny termin.');
    dueDate = parsed.toISOString();
  }

  const owner = await newInquiryOwner(ctx, form.ownerId);
  const stage = contacted ? 'contacted' : 'new';
  const probability = STAGES.find((item) => item.id === stage)?.defaultProbability ?? (contacted ? 20 : 10);
  const contactedAt = contacted ? new Date().toISOString() : null;

  const { data: minRow } = await ctx.supabase.from('tasks').select('order_index')
    .order('order_index', { ascending: true }).limit(1).maybeSingle();
  const newOrderIndex = (Number((minRow as Row | null)?.order_index ?? 0) || 0) - 1;

  const title = `Zapytanie: ${subject}`;
  const descParts: string[] = [];
  if (termin) descParts.push(`Termin: ${termin.replace('T', ' ')}`);
  if (locationText.trim()) descParts.push(`Lokalizacja: ${locationText.trim()}`);
  if (scope.trim()) descParts.push(`Zakres: ${scope.trim()}`);
  if (budget.trim()) descParts.push(`Budżet: ${budget.trim()}`);
  if (expectations.trim()) descParts.push(`Oczekiwania: ${expectations.trim()}`);
  const contactBits = [clientText.trim(), clientCompany, clientPhone.trim(), clientEmail.trim()].filter(Boolean);
  if (contactBits.length) descParts.push(`Kontakt: ${contactBits.join(' | ')}`);

  const normalizedBudget = budget.replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const parsedBudget = Number(normalizedBudget);
  const estimatedValue = normalizedBudget && Number.isFinite(parsedBudget) && parsedBudget >= 0 ? parsedBudget : null;

  const inquiryDetails = {
    source_kind: 'manual',
    source_name: SOURCE_LABELS[source],
    source_channel: source,
    source_message_content: expectations.trim() || scope.trim() || null,
    termin: termin || null,
    location_text: locationText.trim() || null,
    location_id: locationId,
    scope: scope.trim() || null,
    guest_count: guests,
    budget: budget.trim() || null,
    expectations: expectations.trim() || null,
    client_text: clientText.trim() || null,
    ...(clientCompany ? { client_company: clientCompany } : {}),
    client_organization_id: clientOrgId,
    client_contact_id: clientContactId,
    client_phone: clientPhone.trim() || null,
    client_email: clientEmail.trim() || null,
  };

  const { error } = await ctx.supabase.from('tasks').upsert([{
    id,
    title,
    description: descParts.join('\n'),
    priority: 'urgent',
    status: 'todo',
    board_column: 'todo',
    order_index: newOrderIndex,
    due_date: dueDate,
    created_by: ctx.employee.id,
    is_inquiry: true,
    is_private: false,
    // Bez wybranego opiekuna baza ustawia osobę dodającą (gdy prowadzi zapytania), inaczej wspólna kolejka albo przydział
    // rotacyjny; bez terminu kolejnego działania baza ustawia własny.
    inquiry_stage: stage,
    inquiry_owner_id: owner?.id ?? null,
    win_probability: probability,
    last_contact_at: contactedAt,
    first_contact_at: contactedAt,
    next_action_at: nextActionAt,
    estimated_value: estimatedValue,
    contact_id: clientContactId,
    organization_id: clientOrgId,
    inquiry_details: inquiryDetails,
  }], { onConflict: 'id', ignoreDuplicates: true });
  if (error) fail(`Błąd zapisu: ${error.message}`, error.code === '42501' ? 403 : 400);
  // Bez wybranego opiekuna baza ustawia go sama (osoba dodająca albo tryb rotacyjny SLA) — okno pokazuje, kto dostał zapytanie.
  let ownerId = owner?.id ?? null;
  let ownerName = owner?.name ?? null;
  if (!ownerId) {
    const { data: saved } = await ctx.supabase.from('tasks')
      .select('inquiry_owner_id, inquiry_owner:employees!tasks_inquiry_owner_id_fkey(name, surname)').eq('id', id).maybeSingle();
    const row = saved as Row | null;
    const person = Array.isArray(row?.inquiry_owner) ? row?.inquiry_owner[0] : row?.inquiry_owner;
    if (row?.inquiry_owner_id) {
      ownerId = str(row.inquiry_owner_id);
      ownerName = `${str(person?.name)} ${str(person?.surname)}`.trim() || null;
    }
  }
  // `stage` informuje okno, że serwer zapisał opiekuna i kontakt (starszy serwer — okno robi to osobnymi czynnościami).
  // `autoAssigned` — przydział rotacyjny innej osobie (osoba dodająca jako opiekun to nie przydział automatyczny).
  return { id, stage, ownerId, ownerName, autoAssigned: !owner && !!ownerId && ownerId !== ctx.employee.id, nextActionAt };
}

const SLA_COLUMNS = 'id, is_enabled, unassigned_minutes, first_contact_minutes, repeat_minutes, escalation_minutes, max_owner_reminders, '
  + 'offer_followup_days, assignment_mode, require_next_action_after_contact, default_next_action_hours, auto_promote_customer_lifecycle';

function slaOut(row: Row) {
  return {
    isEnabled: row.is_enabled === true,
    unassignedMinutes: Number(row.unassigned_minutes),
    firstContactMinutes: Number(row.first_contact_minutes),
    repeatMinutes: Number(row.repeat_minutes),
    escalationMinutes: Number(row.escalation_minutes),
    maxOwnerReminders: Number(row.max_owner_reminders),
    offerFollowupDays: (Array.isArray(row.offer_followup_days) ? row.offer_followup_days : []).map(Number).filter(Number.isFinite),
    assignmentMode: str(row.assignment_mode) || 'current',
    requireNextActionAfterContact: row.require_next_action_after_contact === true,
    defaultNextActionHours: Number(row.default_next_action_hours),
    autoPromoteCustomerLifecycle: row.auto_promote_customer_lifecycle === true,
  };
}

/** „Automatyzacja SLA” — tylko administrator (przycisk „SLA” w CRM). */
export async function inquirySlaSettings(ctx: NativeContext) {
  if (!ctx.employee.isAdmin) fail('Ustawienia SLA może zmieniać tylko administrator.', 403);
  const { data, error } = await ctx.supabase.from('inquiry_sla_settings').select(SLA_COLUMNS).eq('id', 1).single();
  if (error || !data) fail('Nie udało się pobrać ustawień SLA');
  return { settings: slaOut(data as Row) };
}

/** „Zapisz” w „Automatyzacji SLA” — te same pola co okno CRM; zakresy pilnuje baza (komunikat bazy jak w CRM). */
export async function saveInquirySlaSettings(ctx: NativeContext, body: Row) {
  if (!ctx.employee.isAdmin) fail('Ustawienia SLA może zmieniać tylko administrator.', 403);
  const input = body.settings && typeof body.settings === 'object' ? body.settings as Row : {};
  // `updateNumber`: co najmniej 1, wartość nieliczbowa — 1.
  const atLeastOne = (value: unknown) => Math.max(1, Number(value) || 1);
  const assignmentMode = str(input.assignmentMode);
  if (assignmentMode !== 'current' && assignmentMode !== 'round_robin') fail('Wybierz sposób przydzielania nowych zapytań.');
  const offerFollowupDays = (Array.isArray(input.offerFollowupDays) ? input.offerFollowupDays : [])
    .map(Number).filter((value: number) => Number.isInteger(value) && value > 0);
  const { data, error } = await ctx.supabase.from('inquiry_sla_settings').update({
    is_enabled: input.isEnabled === true,
    unassigned_minutes: atLeastOne(input.unassignedMinutes),
    first_contact_minutes: atLeastOne(input.firstContactMinutes),
    repeat_minutes: atLeastOne(input.repeatMinutes),
    escalation_minutes: atLeastOne(input.escalationMinutes),
    max_owner_reminders: atLeastOne(input.maxOwnerReminders),
    offer_followup_days: offerFollowupDays,
    assignment_mode: assignmentMode,
    require_next_action_after_contact: input.requireNextActionAfterContact === true,
    default_next_action_hours: atLeastOne(input.defaultNextActionHours),
    auto_promote_customer_lifecycle: input.autoPromoteCustomerLifecycle === true,
    updated_at: new Date().toISOString(),
  }).eq('id', 1).select('id');
  if (error) fail(error.message || 'Nie udało się zapisać ustawień SLA', error.code === '42501' ? 403 : 400);
  if (!rows(data).length) fail('Nie masz uprawnień do zmiany ustawień SLA.', 403);
  return { ok: true, message: 'Ustawienia SLA zostały zapisane' };
}
