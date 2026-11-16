import 'server-only';
import type { NativeContext } from './auth';
import { eventsAccess } from './events';
import { eventLocations } from './eventCard';
import { registerEventActions, registerEventQueries } from './eventTabs';
import { fetchEventByIdWith } from '@/lib/CRM/events/eventsIdData.server';
import { eventMoney } from '@/lib/CRM/events/eventFinancials';
import { eventContactSchema, eventSaveError, eventWizardSchema, getValidationErrors } from '@/lib/CRM/events/eventWizardValidation';
import { fetchPublicHolidays, indexHolidays, specialDaysInRange } from '@/lib/CRM/calendar/publicHolidays';

/*
 * Nowe wydarzenie i edycja danych wydarzenia dla Maca — jak kreator „Nowy event” (`EventWizard`, krok „Szczegóły”:
 * walidacja `eventWizardSchema`, zapis wydarzenia, autor jako koordynator w zespole, nowa osoba kontaktowa) i okno
 * „Edytuj event” (`EditEventModalNew`: nazwa, kategoria, firma realizująca, termin, lokalizacja z salami, budżet z obszarem
 * „kwoty”, status). Listy jak w CRM: organizacje, kontakty z bieżącymi organizacjami, kategorie, działalności dostępne
 * pracownikowi (`get_my_accessible_companies`), lokalizacje i sale obiektu, nietypowe dni (`SpecialDayNotice`).
 * Tokenem pracownika — RLS jak w przeglądarce.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statusy jak `eventStatusLabels` (kolejność listy w kreatorze). */
export const EVENT_STATUSES = ['inquiry', 'offer_to_send', 'offer_sent', 'offer_accepted', 'in_preparation', 'ready_for_live', 'in_progress',
  'completed', 'cancelled', 'invoiced', 'settled'];
/** Statusy w „Edytuj event” — etapy magazynu tylko jako bieżąca wartość. */
const EDIT_STATUSES = ['inquiry', 'offer_to_send', 'offer_sent', 'offer_accepted', 'in_progress', 'completed', 'cancelled', 'invoiced'];

/** Błąd formularza z komunikatami pól (Mac pokazuje je przy polach) i szczegółami dla administratora. */
export class EventFormError extends Error {
  constructor(message: string, readonly fieldErrors: Record<string, string> = {}, readonly details = '') {
    super(message);
  }
}

function fail(message: string, fieldErrors?: Record<string, string>): never {
  throw new EventFormError(message, fieldErrors);
}

const text = (value: unknown, max = 300) => String(value ?? '').trim().slice(0, max);

/** Data z Maca (ISO) → chwila UTC i lokalny zapis jak `datetime-local` w Polsce (walidacja kreatora CRM). */
function eventInstant(value: unknown): { iso: string; local: string } | null | 'invalid' {
  const raw = text(value, 64);
  if (!raw) return null;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return 'invalid';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return { iso: date.toISOString(), local: `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}` };
}

const ids = (value: unknown) => (Array.isArray(value) ? value.map((id) => text(id, 64)).filter(Boolean) : []);

/** Działalności dostępne pracownikowi jak `CompanySelector` (bez danych finansowych), domyślna pierwsza. */
async function accessibleCompanies(ctx: NativeContext) {
  let rows: Row[] = [];
  const accessible = await ctx.supabase.rpc('get_my_accessible_companies');
  if (!accessible.error) {
    rows = (accessible.data || []) as Row[];
  } else {
    const fallback = await ctx.supabase.from('my_companies').select('id, name, nip, is_default, is_active')
      .eq('is_active', true).order('is_default', { ascending: false }).order('name');
    if (fallback.error) throw fallback.error;
    rows = (fallback.data || []) as Row[];
  }
  return rows.filter((row) => row.is_active !== false).map((row) => ({
    id: String(row.id), name: String(row.name || ''), nip: row.nip ? String(row.nip) : null, isDefault: row.is_default === true,
  }));
}

async function categories(ctx: NativeContext) {
  const { data } = await ctx.supabase.from('event_categories').select('id, name').order('name');
  return ((data || []) as Row[]).map((row) => ({ id: String(row.id), name: String(row.name || '') }));
}

/** Kreator „Nowy event”: organizacje, kontakty z bieżącymi organizacjami, kategorie, działalności i lokalizacje. */
export async function eventCreateSetup(ctx: NativeContext) {
  const s = ctx.supabase;
  const [organizations, contacts, categoryList, companies, locations] = await Promise.all([
    s.from('organizations').select('id, name, alias').order('name'),
    s.from('contacts').select('id, full_name, contact_type, contact_organizations(organization_id, is_primary, is_current)').order('full_name'),
    categories(ctx),
    accessibleCompanies(ctx),
    eventLocations(ctx),
  ]);
  if (contacts.error) fail('Nie udało się wczytać kontaktów i ich organizacji. Otwórz kreator ponownie.');
  return {
    canCreate: eventsAccess(ctx).canCreate,
    organizations: ((organizations.data || []) as Row[]).map((row) => ({ id: String(row.id), name: String(row.name || ''), alias: row.alias ?? null })),
    contacts: ((contacts.data || []) as Row[]).map((row) => ({
      id: String(row.id),
      name: String(row.full_name || ''),
      type: String(row.contact_type || ''),
      // Kontakt może jednocześnie reprezentować kilka organizacji (tylko bieżące powiązania).
      organizationIds: Array.from(new Set(((row.contact_organizations || []) as Row[])
        .filter((relation) => relation.is_current === true).map((relation) => String(relation.organization_id)))),
    })),
    categories: categoryList,
    companies,
    locations,
  };
}

/** Sale obiektu (`EventRoomSelector`). */
export async function locationRooms(ctx: NativeContext, locationId: string) {
  if (!UUID.test(locationId)) fail('Nieprawidłowa lokalizacja.');
  const { data, error } = await ctx.supabase.from('locations').select('rooms').eq('id', locationId).single();
  if (error) return { error: true, rooms: [] };
  const rooms = Array.isArray((data as Row | null)?.rooms) ? ((data as Row).rooms as Row[]) : [];
  return {
    error: false,
    rooms: rooms.map((room) => ({ id: String(room.id), name: String(room.name ?? ''), notes: room.notes ? String(room.notes) : null })),
  };
}

/** `SpecialDayNotice`: dni ustawowo wolne, niedziele, długie weekendy, „mostki” i Sylwester w zakresie dat. */
export async function specialDays(ctx: NativeContext, from: string, to: string) {
  const start = /^\d{4}-\d{2}-\d{2}/.test(from) ? from.slice(0, 10) : '';
  if (!start) return { days: [], more: 0 };
  const end = /^\d{4}-\d{2}-\d{2}/.test(to) ? to.slice(0, 10) : start;
  const years = [Number(start.slice(0, 4)), Number(end.slice(0, 4))];
  const holidays = await fetchPublicHolidays(ctx.supabase as any, `${Math.min(...years) - 1}-01-01`, `${Math.max(...years) + 1}-12-31`)
    .catch(() => []);
  const days = specialDaysInRange(start, end, indexHolidays(holidays));
  return {
    days: days.slice(0, 3).map((day) => ({ date: day.date, tone: day.tone, message: day.message })),
    more: Math.max(0, days.length - 3),
  };
}

/** „Dodaj osobę kontaktową” w kreatorze (`handleCreateContact`): kontakt, a przy kliencie biznesowym powiązanie z organizacją. */
export async function createEventContact(ctx: NativeContext, body: Row) {
  const values = { first_name: text(body.first_name, 100), last_name: text(body.last_name, 100), email: text(body.email, 200), phone: text(body.phone, 50) };
  const errors = getValidationErrors(eventContactSchema, values);
  if (Object.keys(errors).length) fail(Object.values(errors)[0], errors);
  const validated = eventContactSchema.validateSync(values);
  const business = body.clientType !== 'individual';
  const organizationId = text(body.organization_id, 64);
  const { data, error } = await ctx.supabase.from('contacts').insert([{
    first_name: validated.first_name,
    last_name: validated.last_name,
    email: validated.email || null,
    phone: validated.phone || null,
    contact_type: business ? 'contact' : 'individual',
  }]).select('id, full_name').single();
  if (error || !data) fail('Nie udało się zapisać osoby kontaktowej. Dane pozostają w formularzu.');
  if (business && UUID.test(organizationId)) {
    const { error: orgError } = await ctx.supabase.from('contact_organizations').insert([{
      contact_id: (data as Row).id, organization_id: organizationId, is_current: true, is_primary: true,
    }]);
    if (orgError) fail('Nie udało się zapisać osoby kontaktowej. Dane pozostają w formularzu.');
  }
  return {
    ok: true,
    contact: {
      id: String((data as Row).id),
      name: String((data as Row).full_name || `${validated.first_name} ${validated.last_name}`),
      type: business ? 'contact' : 'individual',
      organizationIds: business && UUID.test(organizationId) ? [organizationId] : [],
    },
  };
}

/** Wartości formularza do walidacji `eventWizardSchema` (daty jak `datetime-local` w Polsce). */
function wizardValues(body: Row) {
  const start = eventInstant(body.event_date);
  const end = eventInstant(body.event_end_date);
  const budget = text(body.budget, 40);
  return {
    start, end,
    values: {
      name: text(body.name, 500),
      clientType: body.clientType === 'individual' ? 'individual' : body.clientType === 'business' ? 'business' : '',
      my_company_id: text(body.my_company_id, 64),
      organization_id: text(body.organization_id, 64),
      contact_person_id: text(body.contact_person_id, 64),
      category_id: text(body.category_id, 64),
      event_date: start === 'invalid' ? 'invalid' : start?.local ?? '',
      event_end_date: end === 'invalid' ? 'invalid' : end?.local ?? '',
      location: text(body.location, 500),
      location_id: text(body.location_id, 64),
      location_room_ids: ids(body.location_room_ids),
      stage_room_id: text(body.stage_room_id, 64) || null,
      budget,
      status: text(body.status, 40),
    },
  };
}

/**
 * „Utwórz event” (`createEvent`): zapis wydarzenia i autor jako koordynator z pełnymi uprawnieniami w zespole. Po powrocie
 * do kroku „Szczegóły” — „Zapisz zmiany” (`updateEvent`, z `id` utworzonego wydarzenia). Błędy pól jak w kreatorze; błąd
 * zapisu — komunikat `eventSaveError` ze szczegółami dla administratora.
 */
export async function createEvent(ctx: NativeContext, body: Row) {
  if (!eventsAccess(ctx).canCreate) fail('Nie masz uprawnień do tworzenia wydarzeń.');
  const { values } = wizardValues(body);
  const context = { statuses: EVENT_STATUSES, pendingContact: false };
  const errors = getValidationErrors(eventWizardSchema, values, context);
  if (Object.keys(errors).length) fail('Popraw zaznaczone pola przed zapisem wydarzenia.', errors);
  const validated = eventWizardSchema.validateSync(values, { context });
  const start = eventInstant(body.event_date) as { iso: string };
  const end = eventInstant(body.event_end_date) as { iso: string } | null;
  const payload = {
    name: validated.name,
    organization_id: validated.organization_id || null,
    contact_person_id: validated.contact_person_id || null,
    category_id: validated.category_id || null,
    event_date: start.iso,
    event_end_date: end ? end.iso : null,
    location: validated.location,
    budget: validated.budget ?? null,
    description: text(body.description, 20000) || null,
    status: validated.status,
    created_by: ctx.employee.id,
    participants: [],
    location_id: validated.location_id || null,
    location_room_ids: validated.location_room_ids || [],
    stage_room_id: validated.stage_room_id || null,
    my_company_id: validated.my_company_id || null,
  };
  const existingId = text(body.id, 64);
  if (existingId) {
    if (!UUID.test(existingId)) fail('Nieprawidłowe wydarzenie.');
    const { created_by: _createdBy, ...changes } = payload;
    const { data: updated, error: updateError } = await ctx.supabase.from('events').update(changes).eq('id', existingId).select('id');
    if (updateError || !updated?.length) {
      const saveError = eventSaveError(updateError || { code: '42501', message: 'Brak dostępu do wydarzenia' });
      throw new EventFormError(saveError.message, {}, saveError.details);
    }
    return { ok: true, id: existingId, notice: null };
  }
  const { data, error } = await ctx.supabase.from('events').insert(payload).select('id').single();
  if (error || !data) {
    const saveError = eventSaveError(error);
    throw new EventFormError(saveError.message, {}, saveError.details);
  }
  const eventId = String((data as Row).id);
  const now = new Date().toISOString();
  const { error: assignmentError } = await ctx.supabase.from('employee_assignments').upsert([{
    event_id: eventId,
    employee_id: ctx.employee.id,
    role: 'Koordynator',
    status: 'accepted',
    responded_at: now,
    can_edit_event: true,
    can_edit_agenda: true,
    can_edit_tasks: true,
    can_edit_files: true,
    can_edit_equipment: true,
    can_invite_members: true,
    can_view_budget: true,
    granted_by: ctx.employee.authUserId,
    permissions_updated_at: now,
  }], { onConflict: 'event_id,employee_id' });
  return {
    ok: true,
    id: eventId,
    notice: assignmentError ? 'Event utworzony, ale nie udało się automatycznie dodać Cię do zespołu wydarzenia' : null,
  };
}

/**
 * Po utworzeniu oferty w kreatorze (`loadEquipmentFromOffer`): budżet wydarzenia z kwoty najnowszej oferty. Sprzęt z oferty
 * dodaje baza (`sync_offer_equipment_to_event`).
 */
export async function budgetFromOffer(ctx: NativeContext, eventId: string) {
  if (!UUID.test(eventId)) fail('Nieprawidłowe wydarzenie.');
  const { data: offer } = await ctx.supabase.from('offers').select('id, total_amount').eq('event_id', eventId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const total = Number((offer as Row | null)?.total_amount);
  if (!offer || !Number.isFinite(total) || total <= 0) return { ok: true, updated: false };
  const { error } = await ctx.supabase.from('events').update({ budget: total }).eq('id', eventId);
  return { ok: true, updated: !error };
}

// MARK: „Edytuj event” (`EditEventModalNew`)

async function editableEvent(ctx: NativeContext, eventId: string) {
  const event = await fetchEventByIdWith(ctx.supabase, eventId, ctx.employee.authUserId);
  if (!event) fail('Nie znaleziono wydarzenia albo nie masz do niego dostępu.');
  const source = event as Row;
  const pc = (source.permissionContext || {}) as Row;
  const canManage = pc.canManageEvent ?? (pc.isAdmin === true || pc.isCreator === true || ctx.employee.isAdmin || ctx.employee.permissions.includes('events_manage'));
  if (!canManage) fail('Nie masz uprawnień do edycji tego wydarzenia.');
  const canEditBudget = pc.access?.areas?.values === true;
  return { source, canEditBudget };
}

/** Dane okna: bieżące pola wydarzenia, klient (do podglądu), kategorie, działalności i lokalizacje. */
async function editSetup(ctx: NativeContext, eventId: string) {
  const { source, canEditBudget } = await editableEvent(ctx, eventId);
  const [categoryList, companies, locations, contact] = await Promise.all([
    categories(ctx),
    accessibleCompanies(ctx),
    eventLocations(ctx),
    source.contact_person_id
      ? ctx.supabase.from('contacts').select('full_name, first_name, last_name').eq('id', source.contact_person_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const contactRow = (contact as { data: Row | null }).data;
  const budget = canEditBudget ? eventMoney(source, source.financials, 'budget') : null;
  return {
    event: {
      name: String(source.name || ''),
      categoryId: source.category_id ?? null,
      companyId: source.my_company_id ?? null,
      start: source.event_date ?? null,
      end: source.event_end_date ?? null,
      location: String(source.location || ''),
      locationId: source.location_id ?? null,
      roomIds: Array.isArray(source.location_room_ids) ? source.location_room_ids.map(String) : [],
      stageRoomId: source.stage_room_id ?? null,
      status: String(source.status || 'inquiry'),
      budget: budget != null ? String(budget) : '',
      hadBudget: budget != null,
    },
    canEditBudget,
    client: {
      type: source.client_type === 'individual' ? 'individual' : 'business',
      organization: source.organization?.name ?? null,
      contact: contactRow ? String(contactRow.full_name || `${contactRow.first_name ?? ''} ${contactRow.last_name ?? ''}`.trim()) : null,
    },
    categories: categoryList,
    companies,
    locations,
  };
}

/** Sale wybranej lokalizacji (w oknie edycji). */
async function rooms(ctx: NativeContext, _eventId: string, params: URLSearchParams) {
  return locationRooms(ctx, params.get('locationId') || '');
}

registerEventQueries('details', {
  editSetup: (ctx: NativeContext, eventId: string) => editSetup(ctx, eventId),
  rooms,
});

/**
 * „Zapisz zmiany” w „Edytuj event”: wymagane nazwa, data rozpoczęcia i lokalizacja; budżet tylko z obszarem „kwoty”
 * (wyczyszczony zapisujemy jako 0 — wyzwalacz `event_financials` pomija null); status z listy okna.
 */
async function editEvent(ctx: NativeContext, eventId: string, body: Row) {
  const { source, canEditBudget } = await editableEvent(ctx, eventId);
  const name = text(body.name, 500);
  const location = text(body.location, 500);
  const start = eventInstant(body.event_date);
  const end = eventInstant(body.event_end_date);
  const errors: Record<string, string> = {};
  if (!name) errors.name = 'Nazwa eventu jest wymagana';
  if (!start || start === 'invalid') errors.event_date = 'Data rozpoczęcia jest wymagana';
  if (end === 'invalid') errors.event_end_date = 'Wpisz poprawną datę i godzinę zakończenia.';
  else if (end && start && start !== 'invalid' && new Date(end.iso).getTime() <= new Date(start.iso).getTime()) {
    errors.event_end_date = 'Zakończenie musi być późniejsze niż rozpoczęcie wydarzenia.';
  }
  if (!location) errors.location = 'Lokalizacja jest wymagana';
  const status = text(body.status, 40);
  if (!EDIT_STATUSES.includes(status) && status !== String(source.status || '')) errors.status = 'Wybierz status z listy.';
  const optionalId = (value: unknown, field: string) => {
    const id = text(value, 64);
    if (id && !UUID.test(id)) errors[field] = 'Wybierz ponownie wartość z listy.';
    return id || null;
  };
  const categoryId = optionalId(body.category_id, 'category_id');
  const companyId = optionalId(body.my_company_id, 'my_company_id');
  const locationId = optionalId(body.location_id, 'location_id');
  const roomIds = ids(body.location_room_ids);
  const stageRoomId = text(body.stage_room_id, 64) || null;
  if (roomIds.length && !locationId) errors.location_room_ids = 'Najpierw wybierz obiekt, a następnie jego sale.';
  if (stageRoomId && !roomIds.includes(stageRoomId)) errors.stage_room_id = 'Miejsce sceny / DJ-a musi należeć do wybranych sal.';
  let budget: number | undefined;
  if (canEditBudget) {
    const raw = text(body.budget, 40).replace(',', '.');
    if (raw) {
      if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || Number(raw) > 99999999.99) {
        errors.budget = 'Wpisz budżet jako nieujemną kwotę z maksymalnie dwoma miejscami po przecinku.';
      } else {
        budget = Number(raw);
      }
    } else if (eventMoney(source, source.financials, 'budget') != null) {
      budget = 0;
    }
  }
  if (Object.keys(errors).length) fail(Object.values(errors)[0], errors);
  const update: Row = {
    name,
    category_id: categoryId,
    event_date: (start as { iso: string }).iso,
    event_end_date: end && end !== 'invalid' ? end.iso : null,
    location,
    location_id: locationId,
    location_room_ids: roomIds,
    stage_room_id: stageRoomId,
    status,
    my_company_id: companyId,
    ...(budget !== undefined ? { budget } : {}),
  };
  const { data, error } = await ctx.supabase.from('events').update(update).eq('id', eventId).select('id');
  if (error) fail(error.message || 'Błąd podczas aktualizacji eventu');
  if (!data?.length) fail('Nie masz uprawnień do edycji tego wydarzenia.');
  return { ok: true };
}

registerEventActions('details', { editEvent });
