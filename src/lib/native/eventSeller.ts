import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { arrangementSchedule, sellerArrangementError, type ArrangementScheduleKey } from '@/lib/seller/arrangements';
import { buildSellerEventSchedule, validSellerDay, type SellerEventDay } from '@/lib/seller/eventSchedule';
import { hotelContextError } from '@/lib/seller/hotel';
import type { NativeContext } from './auth';
import { eventLocations } from './eventCard';
import { registerEventActions, registerEventQueries, registerEventTab } from './eventTabs';

/**
 * Zakładka „Ustalenia” (`EventSellerCorrespondence`): oferty sprzedawców powiązane z wydarzeniem
 * (`get_event_seller_correspondence`) i rozmowa o realizacji (`get_seller_messages`, `send_seller_message`,
 * `mark_seller_conversation_read`, `open_seller_conversation`) — te same funkcje bazy co CRM i portal sprzedawcy.
 * Dla wybranej oferty także: przygotowanie wydarzenia i potwierdzenie realizacji (`SellerEventPreparation`,
 * `CreateSellerEventModal`), kreator przygotowań krok po kroku (`SellerRealizationWizard`) i dodatkowe ustalenia
 * realizacji z bazą hotelu (`SellerOfferArrangements`) — te same funkcje bazy i te same sprawdzenia co trasa
 * `/bridge/seller/offers/[id]`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  throw new Error(message);
}

async function sellerTab(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.rpc('get_event_seller_correspondence', { p_event: eventId });
  if (error) {
    return { error: 'Nie udało się wczytać ustaleń. Wymagane są uprawnienia do eventu i sprzedawcy oraz migracja rozmów ofert i realizacji.', offers: [] };
  }
  return {
    error: null,
    offers: ((data as any)?.offers || []).map((o: any) => ({
      id: o.id, number: o.offer_number ?? null, title: o.title ?? null, partnerId: o.sales_partner_id, partnerName: o.partner_name || '',
      brandName: o.brand_name || '', companyId: o.my_company_id, canStart: o.can_start === true,
      conversation: o.conversation ? {
        id: o.conversation.id, title: o.conversation.title || '', brandName: o.conversation.brand_name || '', lastMessage: o.conversation.last_message ?? null,
        lastAt: o.conversation.last_at ?? null, unread: Number(o.conversation.unread || 0), canSend: o.conversation.can_send === true,
      } : null,
    })),
  };
}

registerEventTab('seller-arrangements', sellerTab);

async function conversationOfEvent(ctx: NativeContext, eventId: string, conversationId: string) {
  if (!UUID.test(conversationId)) fail('Nieprawidłowa rozmowa.');
  const tab = await sellerTab(ctx, eventId);
  if (!tab.offers.some((offer: any) => offer.conversation?.id === conversationId)) fail('Ta rozmowa nie należy do ofert tego eventu.');
}

async function messages(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const id = params.get('conversationId') || '';
  await conversationOfEvent(ctx, eventId, id);
  const before = Number(params.get('before') || 0);
  const { data, error } = await ctx.supabase.rpc('get_seller_messages', before > 0 ? { p_conversation: id, p_before: before } : { p_conversation: id });
  if (error) fail('Nie udało się wczytać rozmowy. Ponowimy za chwilę.');
  return {
    messages: ((data || []) as any[]).map((m) => ({
      id: m.id, seq: Number(m.seq || 0), crm: m.sender_kind === 'crm', sender: m.sender_name || '', body: m.body || '', createdAt: m.created_at, own: m.own === true,
    })),
  };
}

registerEventQueries('seller-arrangements', { messages });

async function send(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const id = String(body.conversationId || '');
  await conversationOfEvent(ctx, eventId, id);
  const text = String(body.body || '').trim().slice(0, 10000);
  const messageId = String(body.messageId || '');
  if (!text || !UUID.test(messageId)) fail('Wpisz treść wiadomości.');
  const { error } = await ctx.supabase.rpc('send_seller_message', { p_conversation: id, p_message_id: messageId, p_body: text });
  if (error) fail(error.message || 'Nie potwierdzono wysyłki. Możesz ponowić; wiadomość nie zostanie zdublowana.');
  return { ok: true };
}

async function read(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const id = String(body.conversationId || '');
  await conversationOfEvent(ctx, eventId, id);
  const { error } = await ctx.supabase.rpc('mark_seller_conversation_read', { p_conversation: id, p_through: Number(body.through || 0) });
  if (error) fail('Nie udało się oznaczyć wiadomości jako przeczytanych.');
  return { ok: true };
}

/** „Rozpocznij rozmowę” — ten sam wątek oferty (także już powiązany z realizacją). */
async function open(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const offerId = String(body.offerId || '');
  const tab = await sellerTab(ctx, eventId);
  const offer = tab.offers.find((item: any) => item.id === offerId);
  if (!offer) fail('Ta oferta nie należy do tego eventu.');
  if (!offer.canStart) fail('Masz dostęp tylko do odczytu. Rozmowę może rozpocząć sprzedawca lub uprawniony opiekun.');
  const { error } = await ctx.supabase.rpc('open_seller_conversation', { p_partner: offer.partnerId, p_company: offer.companyId, p_offer: offer.id });
  if (error) fail('Nie udało się otworzyć rozmowy. Sprawdź uprawnienia do tej marki i spróbuj ponownie.');
  return { ok: true };
}

registerEventActions('seller-arrangements', { send, read, open });

// ---------------------------------------------------------------------------------------------------------------
// Oferta wybrana w zakładce — przygotowanie, kreator kroków, ustalenia realizacji i potwierdzenie realizacji
// ---------------------------------------------------------------------------------------------------------------

/** Brak funkcji w bazie (migracja nieuruchomiona) — jak `['PGRST202','42883','42P01']` w trasie sprzedawcy. */
const MISSING = ['PGRST202', '42883', '42P01'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const CONFIRMED = ['offer_accepted', 'in_preparation', 'ready_for_live', 'in_progress', 'completed', 'invoiced', 'settled'];
type DbError = { code?: string; message?: string } | null;

const str = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const opt = (value: unknown) => (value == null || value === '' ? null : String(value));
const num = (value: unknown) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
const obj = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {});
const list = (value: unknown) => (Array.isArray(value) ? (value as any[]) : []);

/** Oferta musi należeć do tego wydarzenia i być widoczna w zakresie uprawnień (jak lista ofert zakładki). */
async function offerOfEvent(ctx: NativeContext, eventId: string, offerId: string) {
  if (!UUID.test(offerId)) fail('Nieprawidłowa oferta.');
  const tab = await sellerTab(ctx, eventId);
  if (tab.error) fail(tab.error);
  const offer = tab.offers.find((item: any) => item.id === offerId);
  if (!offer) fail('Ta oferta nie należy do tego eventu albo jest poza Twoimi uprawnieniami.');
  return offer;
}

/** `checkHandoff` z trasy sprzedawcy. */
function checkHandoff(error: DbError) {
  if (error && MISSING.slice(0, 2).includes(error.code || '')) {
    fail('Akceptacja oferty i osobne potwierdzenie realizacji wymagają migracji 20260917150000 (po 20260911234500 i 20260911235000).');
  }
  if (error) fail(error.message || 'Nie udało się wykonać operacji');
}

/** `authorize` + `can_manage` + wersja przekazania (jak akcje `event_draft` / `create_event` trasy sprzedawcy). */
async function managedHandoff(ctx: NativeContext, eventId: string, offerId: string) {
  await offerOfEvent(ctx, eventId, offerId);
  const state = await ctx.supabase.rpc('seller_offer_workflow_state', { p_offer_id: offerId });
  if (state.error) fail(state.error.message || 'Nie udało się wykonać operacji');
  if (!state.data) fail('To nie jest oferta sprzedawcy');
  const version = await ctx.supabase.rpc('seller_offer_handoff_version');
  checkHandoff(version.error);
  if (Number(version.data) < 4) {
    fail('Automatyczny event po akceptacji wymaga migracji 20261028170000_seller_acceptance_event_handoff.sql. Nie zapisano nowej akceptacji.');
  }
  if ((state.data as any).can_manage !== true) fail('Brak uprawnień');
}

// MARK: Przygotowanie wydarzenia z oferty (`SellerEventPreparation` + GET trasy sprzedawcy, część `realization`)

/** Sprzedawca i jego organizacja w podsumowaniu oferty (`loadOfferSummary`) — po sprawdzeniu dostępu do tej oferty. */
async function sellerSummary(admin: ReturnType<typeof createSupabaseAdminClient>, offer: Record<string, any>) {
  try {
    const branding = obj(offer.partner_branding_snapshot);
    let sellerName = str(branding.display_name);
    let organizationName = str(branding.organization_name);
    if (!sellerName) {
      const partner = await admin.from('sales_partner_profiles')
        .select('contact:contacts!contact_id(full_name),employee:employees!employee_id(name,surname)')
        .eq('id', offer.sales_partner_id).single();
      if (partner.error) throw partner.error;
      const one = (value: any) => (Array.isArray(value) ? value[0] : value);
      const contact = one((partner.data as any)?.contact), employee = one((partner.data as any)?.employee);
      sellerName = contact?.full_name || [employee?.name, employee?.surname].filter(Boolean).join(' ');
    }
    // Organizacja zapisana przy ofercie, nigdy nowe ustawienie domyślne sprzedawcy.
    if (!organizationName && offer.partner_organization_id) {
      const organization = await admin.from('organizations').select('name,alias').eq('id', offer.partner_organization_id).maybeSingle();
      if (organization.error) throw organization.error;
      organizationName = organization.data?.alias || organization.data?.name || '';
    }
    return { sellerName: sellerName || 'Sprzedawca', sellerOrganization: organizationName };
  } catch {
    return null;
  }
}

async function preparation(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const offerId = params.get('offerId') || '';
  await offerOfEvent(ctx, eventId, offerId);
  const state = await ctx.supabase.rpc('seller_offer_workflow_state', { p_offer_id: offerId });
  if (state.error) fail(state.error.message || 'Nie udało się wczytać stanu przygotowania.');
  if (!state.data) fail('To nie jest oferta sprzedawcy');
  const canManage = (state.data as any).can_manage === true;
  const admin = createSupabaseAdminClient();
  const owner = await admin.from('offers')
    .select('sales_partner_id,my_company_id,status,event_id,partner_branding_snapshot,partner_organization_id')
    .eq('id', offerId).eq('sales_channel', 'seller_portal').single();
  if (owner.error || !owner.data) fail(owner.error?.message || 'Nie udało się wczytać stanu przygotowania.');
  let linked: { id: string; status: string } | null = null;
  let canViewEvent = false;
  if (owner.data.event_id) {
    const event = await admin.from('events').select('id,status').eq('id', owner.data.event_id).eq('my_company_id', owner.data.my_company_id).maybeSingle();
    if (event.error) fail(event.error.message || 'Nie udało się wczytać stanu przygotowania.');
    if (event.data) {
      const view = await ctx.supabase.rpc('get_seller_offer_arrangements', { p_offer: offerId });
      // Odnośniki CRM nie mogą sugerować dostępu, gdy wydarzenie jest poza zakresem czytającego.
      if (view.error) fail(view.error.message || 'Nie udało się wczytać stanu przygotowania.');
      if (!(view.data as any)?.event) fail('Nie udało się ustalić etapu powiązanego eventu. Odśwież status.');
      linked = { id: String(event.data.id), status: String((view.data as any).event.status) };
      canViewEvent = canManage && (view.data as any).event.can_view_crm === true;
    }
  }
  const create = canManage ? await ctx.supabase.rpc('seller_offer_can_create_event', { p_offer_id: offerId }) : null;
  if (create?.error && !MISSING.slice(0, 2).includes(create.error.code || '')) fail(create.error.message || 'Nie udało się wczytać stanu przygotowania.');
  const version = await ctx.supabase.rpc('seller_offer_handoff_version');
  if (version.error && !MISSING.slice(0, 2).includes(version.error.code || '')) fail(version.error.message || 'Nie udało się wczytać stanu przygotowania.');
  const confirmed = Boolean(linked && CONFIRMED.includes(linked.status));
  const stage = linked?.status === 'cancelled' ? 'cancelled' : confirmed ? 'confirmed' : owner.data.status === 'accepted' ? 'awaiting_crm_confirmation' : 'offer';
  const summary = await sellerSummary(admin, owner.data);
  return {
    canManage,
    eventId: linked?.id ?? null,
    stage,
    matching: linked?.id === eventId && canViewEvent,
    canCreateEvent: create?.data === true,
    autoEventReady: Number(version.data) >= 4,
    sellerName: summary?.sellerName ?? null,
    sellerOrganization: summary?.sellerOrganization ?? null,
  };
}

// MARK: Potwierdzenie realizacji (`CreateSellerEventModal` — `event_draft` i `create_event`)

async function eventDraft(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const offerId = params.get('offerId') || '';
  await managedHandoff(ctx, eventId, offerId);
  const result = await ctx.supabase.rpc('get_seller_event_draft', { p_offer_id: offerId });
  checkHandoff(result.error);
  const raw = obj(result.data);
  const [categories, locations] = await Promise.all([
    ctx.supabase.from('event_categories').select('id,name').eq('is_active', true).order('name'),
    eventLocations(ctx).then((rows) => ({ rows, error: null as string | null }))
      .catch(() => ({ rows: [] as Awaited<ReturnType<typeof eventLocations>>, error: 'Nie udało się pobrać bazy lokalizacji. Miejsce podane przez sprzedawcę pozostaje dostępne.' })),
  ]);
  const arrangements = obj(raw.arrangements);
  return {
    eventId: opt(raw.event_id),
    alreadyConfirmed: Boolean(raw.event_id) && raw.confirmation_required === false,
    eventUpdatedAt: opt(raw.event_updated_at),
    locationId: opt(raw.location_id),
    categoryId: opt(raw.category_id),
    sourceKey: str(raw.source_key),
    revision: Number(raw.revision || 0),
    brandName: str(raw.brand_name),
    offerNumber: str(raw.offer_number),
    name: str(raw.name),
    location: str(raw.location),
    description: str(raw.description),
    setupAt: opt(raw.setup_at), startsAt: opt(raw.starts_at), endsAt: opt(raw.ends_at), teardownAt: opt(raw.teardown_at),
    client: clientView(raw.client),
    eventDays: eventDaysView(arrangements.event_days),
    contacts: list(arrangements.contacts).map(contactView),
    room: str(arrangements.room),
    technical: str(arrangements.technical_requirements),
    logistics: str(arrangements.logistics_requirements),
    items: list(raw.items).map((item) => ({ id: str(item.id), name: str(item.name), quantity: Number(item.quantity || 0), unit: opt(item.unit) })),
    categories: categories.error ? [] : (categories.data || []).map((row: any) => ({ id: String(row.id), name: str(row.name) })),
    categoryError: categories.error ? 'Nie udało się wczytać kategorii. Możesz ją uzupełnić później w evencie.' : null,
    locations: locations.rows,
    locationsError: locations.error,
  };
}

/** „Potwierdź realizację” — walidacja formularza CRM i `complete_seller_event_handoff` (bez tworzenia kolejnej kopii wydarzenia). */
async function confirmRealization(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const offerId = str(body.offerId);
  await managedHandoff(ctx, eventId, offerId);
  if (body.confirm !== true) fail('Potwierdź osobno realizację eventu.');
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail('Event, oferta lub ustalenia zmieniły się. Zamknij formularz i wczytaj aktualne dane.');
  const input = obj(body.values);
  const schedule = obj(input.schedule);
  const values: Record<string, unknown> = {
    event_updated_at: opt(input.eventUpdatedAt),
    name: str(input.name).trim(),
    location: str(input.location).trim(),
    location_id: opt(input.locationId),
    description: str(input.description),
    category_id: opt(input.categoryId),
  };
  if (values.location_id && !UUID.test(String(values.location_id))) fail('Nieprawidłowa lokalizacja.');
  if (values.category_id && !UUID.test(String(values.category_id))) fail('Nieprawidłowa kategoria.');
  for (const [key, label] of arrangementSchedule) {
    const slot = obj(schedule[key]);
    const date = str(slot.date).trim(), time = str(slot.time).trim();
    if (Boolean(date) !== Boolean(time)) fail(`${label}: uzupełnij datę oraz godzinę albo pozostaw oba pola puste.`);
    if (date && (!validSellerDay(date) || !TIME.test(time))) fail('Popraw daty zaznaczone w formularzu.');
    values[key] = date ? `${date}T${time}` : null;
  }
  if (!values.name || !values.starts_at || !values.ends_at) fail('Uzupełnij nazwę oraz daty i godziny rozpoczęcia i zakończenia eventu.');
  if (String(values.ends_at) <= String(values.starts_at)) fail('Koniec musi być późniejszy niż początek eventu.');
  const result = await ctx.supabase.rpc('complete_seller_event_handoff', {
    p_offer_id: offerId, p_source_key: str(body.sourceKey), p_revision: body.revision, p_values: values,
  });
  if (result.error && MISSING.slice(0, 2).includes(result.error.code || '')) {
    fail('Potwierdzenie eventu wymaga migracji 20261028170000_seller_acceptance_event_handoff.sql. Dane formularza pozostają zachowane.');
  }
  checkHandoff(result.error);
  const created = obj(result.data);
  if (!created.event_id) fail('Nie otrzymano potwierdzenia zapisu eventu. Odśwież status przed ponowieniem.');
  return { eventId: String(created.event_id) };
}

// MARK: Kreator przygotowań (`SellerRealizationWizard` — `wizard_state` i `wizard_update`)

function wizardMissing(error: DbError) {
  if (error && MISSING.includes(error.code || '')) {
    fail('Kroki przygotowania wymagają migracji 20261028190000_seller_realization_wizard.sql. Dane formularza pozostają zachowane.');
  }
  if (error) fail(error.message || 'Nie udało się wykonać operacji');
}

function wizardView(raw: Record<string, any>) {
  const context = obj(raw.context);
  return {
    offerId: str(raw.offer_id), eventId: opt(raw.event_id), partnerId: str(raw.partner_id), companyId: str(raw.company_id),
    revision: Number(raw.revision || 0), finishKey: str(raw.finish_key),
    active: raw.active === true, manager: raw.manager === true, seller: raw.seller === true,
    completed: raw.completed === true, completedAt: opt(raw.completed_at), canComplete: raw.can_complete === true,
    confirmationRequired: raw.confirmation_required === true,
    client: clientView(raw.client),
    legacyContactBody: opt(raw.legacy_contact_body),
    context: {
      location: opt(context.location), room: opt(context.room), participants: num(context.participants),
      startsAt: opt(context.starts_at), endsAt: opt(context.ends_at),
      technical: opt(context.technical), logistics: opt(context.logistics), materialsDue: opt(context.materials_due),
      requirements: list(context.requirements).map((item) => ({
        name: str(item.name), technical: opt(item.technical), logistics: opt(item.logistics), accommodation: opt(item.accommodation),
      })),
    },
    steps: list(raw.steps).map((step) => ({
      key: str(step.key), status: str(step.status), available: step.available === true, revision: Number(step.revision || 0),
      contextKey: str(step.context_key), payload: obj(step.payload), reviewNote: opt(step.review_note),
      submittedAt: opt(step.submitted_at), reviewedAt: opt(step.reviewed_at),
      canSubmit: step.can_submit === true, canReview: step.can_review === true,
    })),
    history: list(raw.history).map((item) => ({
      revision: Number(item.revision || 0), stepKey: str(item.step_key), action: str(item.action), at: str(item.at),
      payload: item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload) ? item.payload : null,
      reviewNote: opt(item.review_note),
    })),
  };
}

async function wizard(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const offerId = params.get('offerId') || '';
  await offerOfEvent(ctx, eventId, offerId);
  const result = await ctx.supabase.rpc('get_seller_realization_wizard', { p_offer: offerId });
  wizardMissing(result.error);
  if (!result.data) fail('Nie udało się wczytać stanu przygotowań.');
  return wizardView(result.data as Record<string, any>);
}

/** Zapis kroku: identyfikator żądania (ponowienie nie dubluje), wersja, kontekst i rola sprawdzane w jednej transakcji bazy. */
async function wizardUpdate(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const offerId = str(body.offerId);
  await offerOfEvent(ctx, eventId, offerId);
  const payload = body.payload;
  if (!UUID.test(str(body.requestId)) || !Number.isSafeInteger(body.revision) || body.revision < 0
    || typeof body.contextKey !== 'string' || !/^[0-9a-f]{32}$/.test(body.contextKey)
    || !['contact', 'organization', 'materials', 'plan', 'finish'].includes(body.step)
    || !['save', 'submit', 'approve', 'changes_requested', 'complete'].includes(body.operation)
    || !payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.values(payload).some((value) => value !== null && !['string', 'number', 'boolean'].includes(typeof value))
    || typeof body.note !== 'string' || body.note.length > 3000) {
    fail('Nieprawidłowe dane kroku przygotowania. Odśwież formularz.');
  }
  const result = await ctx.supabase.rpc('update_seller_realization_wizard', {
    p_offer: offerId, p_step: body.step, p_action: body.operation, p_revision: body.revision,
    p_context_key: body.contextKey, p_request: body.requestId, p_payload: payload, p_note: body.note,
  });
  wizardMissing(result.error);
  if (!result.data) fail('Nie udało się wczytać stanu przygotowań.');
  return wizardView(result.data as Record<string, any>);
}

// MARK: Ustalenia realizacji (`SellerOfferArrangements` — `get_seller_offer_arrangements`, `get_seller_hotel_context`, zapis)

function clientView(value: unknown) {
  const client = obj(value);
  return { name: opt(client.name), company: opt(client.company), email: opt(client.email), phone: opt(client.phone) };
}
function contactView(value: unknown) {
  const contact = obj(value);
  return { name: str(contact.name), role: str(contact.role), email: str(contact.email), phone: str(contact.phone) };
}
function eventDaysView(value: unknown): Array<{ date: string; startTime: string; endTime: string }> | null {
  return Array.isArray(value) ? value.map((day) => ({ date: str(day?.date), startTime: str(day?.start_time), endTime: str(day?.end_time) })) : null;
}
function roomView(value: unknown) {
  const room = obj(value);
  return { id: str(room.id), name: str(room.name), notes: str(room.notes), technical: obj(room.technical) };
}
function venueView(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const venue = obj(value);
  return {
    organizationId: str(venue.organization_id), organizationName: str(venue.organization_name),
    locationId: str(venue.location_id), locationName: str(venue.location_name),
    room: roomView(venue.room), technicalDetails: obj(venue.technical_details),
  };
}
const scheduleView = (value: Record<string, any>) => ({
  setupAt: opt(value.setup_at), startsAt: opt(value.starts_at), endsAt: opt(value.ends_at), teardownAt: opt(value.teardown_at),
});

function hotelView(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const hotel = obj(value);
  const location = hotel.location ? obj(hotel.location) : null;
  return {
    available: hotel.available === true,
    organization: hotel.organization ? { id: str(hotel.organization.id), name: str(hotel.organization.name) } : null,
    location: location ? { id: str(location.id), name: str(location.name), rooms: list(location.rooms).map(roomView), technicalDetails: obj(location.technical_details) } : null,
    contacts: list(hotel.contacts).map((contact) => ({ id: str(contact.id), ...contactView(contact) })),
  };
}

function arrangementsView(raw: Record<string, any>) {
  const values = obj(raw.values);
  const offer = obj(raw.offer);
  const event = raw.event ? obj(raw.event) : null;
  return {
    canEdit: raw.can_edit === true,
    values: {
      revision: Number(values.revision || 0),
      room: str(values.room),
      venue: venueView(values.venue_snapshot),
      participantCount: num(values.participant_count),
      eventDays: eventDaysView(values.event_days),
      ...scheduleView(values),
      materialsDueDate: opt(values.materials_due_date),
      technical: str(values.technical_requirements),
      logistics: str(values.logistics_requirements),
      contacts: list(values.contacts).map(contactView),
      updatedAt: opt(values.updated_at),
    },
    offer: {
      id: str(offer.id), title: opt(offer.title), eventDate: opt(offer.event_date), location: opt(offer.location), status: str(offer.status),
      baseNet: num(offer.base_net), clientNet: num(offer.client_net),
    },
    client: clientView(raw.client),
    event: event ? {
      id: str(event.id), name: str(event.name), status: str(event.status), location: opt(event.location),
      canViewCrm: event.can_view_crm === true, ...scheduleView(event),
    } : null,
    team: list(raw.team).map((person) => ({ id: str(person.id), ...contactView(person) })),
  };
}

/** Ustalenia z podpowiedziami bazy hotelu (błąd bazy hotelu nie blokuje ręcznego wpisania danych). */
async function arrangementsReply(ctx: NativeContext, offerId: string, data?: unknown) {
  const [main, hotel] = await Promise.all([
    data ? Promise.resolve({ data, error: null as DbError }) : ctx.supabase.rpc('get_seller_offer_arrangements', { p_offer: offerId }),
    ctx.supabase.rpc('get_seller_hotel_context', { p_offer: offerId }),
  ]);
  if (main.error) fail(sellerArrangementError(main.error));
  if (!main.data) fail('Nie znaleziono danych ustaleń.');
  return {
    ...arrangementsView(main.data as Record<string, any>),
    hotel: hotel.error ? null : hotelView(hotel.data),
    hotelError: hotel.error ? hotelContextError(hotel.error) : null,
  };
}

async function arrangements(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const offerId = params.get('offerId') || '';
  await offerOfEvent(ctx, eventId, offerId);
  return arrangementsReply(ctx, offerId);
}

/** Podpisane adresy planów i zdjęć przestrzeni (`TechnicalDetailsView`) — tylko pliki zapisanej sali i bazy hotelu tej oferty. */
async function venueAssets(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const offerId = params.get('offerId') || '';
  await offerOfEvent(ctx, eventId, offerId);
  const [main, hotel] = await Promise.all([
    ctx.supabase.rpc('get_seller_offer_arrangements', { p_offer: offerId }),
    ctx.supabase.rpc('get_seller_hotel_context', { p_offer: offerId }),
  ]);
  if (main.error) fail(sellerArrangementError(main.error));
  const venue = obj(obj(obj(main.data).values).venue_snapshot);
  const location = obj(obj(hotel.error ? null : hotel.data).location);
  const details = [obj(venue.room).technical, venue.technical_details, location.technical_details, ...list(location.rooms).map((room) => obj(room).technical)];
  const assets = details.flatMap((value) => list(obj(value).assets)).filter((asset) => typeof asset?.path === 'string' && asset.path);
  const unique = Array.from(new Map<string, any>(assets.map((asset) => [String(asset.path), asset] as [string, any])).values());
  const signed = await Promise.all(unique.map(async (asset) => {
    const path = String(asset.path);
    const result = await ctx.supabase.storage.from('location-materials')
      .createSignedUrl(path, 3600, /\.(dxf|dwg)$/i.test(path) ? { download: String(asset.name || 'plik') } : undefined);
    return [path, result.error ? null : result.data?.signedUrl ?? null] as const;
  }));
  return { urls: Object.fromEntries(signed.filter(([, url]) => Boolean(url))) };
}

/** „Zapisz ustalenia” — ta sama walidacja co formularz CRM; przestrzeń z bazy hotelu odczytana na nowo po stronie serwera. */
async function saveArrangements(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const offerId = str(body.offerId);
  await offerOfEvent(ctx, eventId, offerId);
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail('Nieprawidłowa wersja ustaleń. Wczytaj aktualne dane.');
  const days: SellerEventDay[] | null = body.eventDays == null ? null : list(body.eventDays).map((day) => ({
    date: str(day?.date).trim(), start_time: str(day?.startTime).trim(), end_time: str(day?.endTime).trim(),
  }));
  const daily = days === null ? null : buildSellerEventSchedule(days);
  if (daily?.error) fail(daily.error);
  const input = obj(body.schedule);
  const slots = {} as Record<ArrangementScheduleKey, string | null>;
  for (const [key, label] of arrangementSchedule) {
    if (daily && (key === 'starts_at' || key === 'ends_at')) {
      slots[key] = daily[key];
      continue;
    }
    const slot = obj(input[key]);
    const date = str(slot.date).trim(), time = str(slot.time).trim();
    if (date && !validSellerDay(date)) fail('Popraw daty i godziny zaznaczone w formularzu.');
    if (Boolean(date) !== Boolean(time) || (time && !TIME.test(time))) fail(`${label}: uzupełnij datę i godzinę albo pozostaw oba pola puste.`);
    slots[key] = date ? `${date}T${time}` : null;
  }
  if ((slots.starts_at && slots.ends_at && slots.ends_at < slots.starts_at)
    || (slots.setup_at && slots.starts_at && slots.setup_at > slots.starts_at)
    || (slots.teardown_at && slots.ends_at && slots.teardown_at < slots.ends_at)) {
    fail('Sprawdź kolejność terminów: montaż, początek, koniec i demontaż.');
  }
  const participants = str(body.participantCount).trim();
  if (participants && (!/^\d+$/.test(participants) || Number(participants) > 1000000)) {
    fail('Liczba uczestników: podaj liczbę całkowitą od 0 do 1 000 000.');
  }
  const materials = str(body.materialsDueDate).trim();
  if (materials && !validSellerDay(materials)) fail('Popraw daty i godziny zaznaczone w formularzu.');
  const technical = str(body.technical), logistics = str(body.logistics);
  if (technical.length > 3000) fail('Wymagania techniczne mogą mieć maksymalnie 3000 znaków.');
  if (logistics.length > 3000) fail('Logistyka i wymagania organizacyjne mogą mieć maksymalnie 3000 znaków.');
  const contacts = list(body.contacts);
  if (contacts.length > 12) fail('Możesz dodać do 12 kontaktów organizacyjnych');
  // Przestrzeń: zapisana bez zmian, sala z aktualnej bazy hotelu tej oferty albo wpis ręczny bez powiązania.
  const venue = obj(body.venue);
  let room = str(body.room);
  if (room.length > 200) fail('Nazwa sali / przestrzeni może mieć maksymalnie 200 znaków.');
  let snapshot: unknown = null;
  if (venue.mode === 'keep') {
    const current = await ctx.supabase.rpc('get_seller_offer_arrangements', { p_offer: offerId });
    if (current.error) fail(sellerArrangementError(current.error));
    snapshot = obj(obj(current.data).values).venue_snapshot ?? null;
  } else if (venue.mode === 'room') {
    const hotel = await ctx.supabase.rpc('get_seller_hotel_context', { p_offer: offerId });
    if (hotel.error) fail(hotelContextError(hotel.error));
    const context = obj(hotel.data);
    const location = obj(context.location);
    const picked = list(location.rooms).find((item) => str(obj(item).id) === str(venue.roomId));
    if (context.available !== true || !context.organization || !context.location || !picked) {
      fail('Sala nie jest już dostępna w bazie hotelu. Wybierz inną przestrzeń.');
    }
    snapshot = {
      organization_id: context.organization.id, organization_name: context.organization.name,
      location_id: location.id, location_name: location.name, room: picked, technical_details: location.technical_details,
    };
    room = str(obj(picked).name);
  } else if (venue.mode !== 'none') {
    fail('Nieprawidłowe dane przestrzeni. Odśwież formularz.');
  }
  const result = await ctx.supabase.rpc('save_seller_offer_arrangements', {
    p_offer: offerId, p_revision: body.revision,
    p_values: {
      ...(daily ? { event_days: daily.days } : {}),
      ...slots, room, venue_snapshot: snapshot, participant_count: participants === '' ? null : Number(participants),
      materials_due_date: materials || null, technical_requirements: technical, logistics_requirements: logistics,
      contacts: contacts.map((contact) => ({ name: str(contact?.name), role: str(contact?.role), email: str(contact?.email), phone: str(contact?.phone) })),
    },
  });
  if (result.error) fail(sellerArrangementError(result.error));
  if (!result.data) fail('Nie otrzymano potwierdzenia zapisu. Wczytaj aktualne dane przed ponowieniem.');
  return arrangementsReply(ctx, offerId, result.data);
}

registerEventQueries('seller-arrangements', { preparation, eventDraft, wizard, arrangements, venueAssets });
registerEventActions('seller-arrangements', { confirmRealization, wizardUpdate, saveArrangements });
