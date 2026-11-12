import 'server-only';
import { createHash } from 'node:crypto';
import type { NativeContext } from './auth';
import { mapTeamTransportVehicles, summarizeTeamTransport, TEAM_TRANSPORT_VEHICLE_SELECT } from '@/lib/CRM/events/teamTransport';
import { imageCrop } from './team';
import { fetchEventByIdWith } from '@/lib/CRM/events/eventsIdData.server';
import { fetchEventOffersServer } from '@/lib/CRM/Offers/fetchEventOffers.server';
import {
  canViewEventArea, EVENT_TAB_LABELS, eventAccessSummary, isSalesColleagueView, parseEventAccess, parseEventSalesOverview, visibleEventTabs, type EventTabId,
} from '@/lib/events/access/eventAccess';
import { legacyEventAccess } from '@/lib/CRM/events/eventAccessFallback';
import { eventMoney } from '@/lib/CRM/events/eventFinancials';
import { getOfferPricingTotals, roundMoney } from '@/lib/CRM/Offers/offerTotals';

/*
 * Karta wydarzenia dla aplikacji na Maca — te same dane co strona `/crm/events/[id]` (`page.tsx`): przestrzeń realizacji
 * (`get_realization_workspace`), wydarzenie z dostępem (`fetchEventByIdWith` — ten sam kod co CRM), lokalizacja, kontakt (tylko
 * z obszarem „klient”), kategorie, oferty (z obszarem „oferta / umowa” albo „kwoty”) i przychód jak w CRM; podgląd sprzedaży
 * kolegi (`get_event_sales_overview`). Odpowiedź ze skrótem — Mac trzyma kartę na dysku i pobiera ją ponownie tylko po zmianie.
 */

const digest = (value: unknown) => createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 20);

export async function eventCardPage(ctx: NativeContext, eventId: string) {
  const client = ctx.supabase;
  const { data: realization } = await client.rpc('get_realization_workspace', { p_event_id: eventId });
  if (realization?.operational_only) return { kind: 'realization', realization };

  const event = await fetchEventByIdWith(client, eventId, ctx.employee.authUserId);
  if (!event || (event.permissionContext.access && isSalesColleagueView(event.permissionContext.access))) {
    const access = event?.permissionContext.access
      ?? (await client.rpc('get_event_access', { p_event_id: eventId }).then((r) => (r.error ? null : parseEventAccess(r.data))));
    if (access && isSalesColleagueView(access)) {
      const { data, error } = await client.rpc('get_event_sales_overview', { p_event_id: eventId });
      const overview = error ? null : parseEventSalesOverview(data);
      if (!overview?.event) return null;
      const locationId = (event as any)?.location_id;
      const { data: location } = locationId ? await client.from('locations').select('name,city').eq('id', locationId).maybeSingle() : { data: null };
      const row = event as any;
      return {
        kind: 'salesColleague', access, overview, locationName: [location?.name, location?.city].filter(Boolean).join(', ') || null,
        fallbackEvent: row ? { name: row.name ?? '', event_date: row.event_date ?? null, event_end_date: row.event_end_date ?? null, location: row.location ?? null, status: row.status ?? null } : null,
        accessSummary: eventAccessSummary(access),
      };
    }
    return null;
  }

  const areas = event.permissionContext.access?.areas;
  const canViewClient = areas?.client === true;
  const canViewValues = areas?.values === true;
  const flags = await eventCardFlags(ctx, event);
  const [location, contact, categories, offers, equipmentBadge] = await Promise.all([
    event.location_id
      ? client.from('locations').select('*').eq('id', event.location_id).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
    canViewClient && event.contact_person_id
      ? client.from('contacts').select('*').eq('id', event.contact_person_id).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
    client.from('event_categories').select('id, name, color, icon:custom_icons(id, name, svg_code, preview_color)').order('name', { ascending: true })
      .then((r) => r.data || []),
    areas?.commercial_docs || canViewValues ? fetchEventOffersServer(client as any, eventId) : Promise.resolve([]),
    flags.canViewOperations ? eventEquipmentBadge(ctx, eventId, String((event as any).status || '')) : Promise.resolve(null),
  ]);
  const acceptedOffer = (offers as any[]).find((offer) => offer.status === 'accepted');
  const storedExpectedRevenue = canViewValues ? eventMoney(event as any, event.financials, 'expected_revenue') : null;
  const expectedRevenue = !canViewValues
    ? null
    : (event as any).financial_source === 'calculation'
      ? storedExpectedRevenue
      : acceptedOffer
        ? getOfferPricingTotals(acceptedOffer).gross
        : storedExpectedRevenue;
  return {
    kind: 'full',
    canPrintCard: Boolean(realization),
    flags,
    event: { ...event, expected_revenue: expectedRevenue },
    location: location
      ? {
          id: location.id, name: location.name, formatted_address: location.formatted_address, address: location.address, city: location.city,
          postal_code: location.postal_code, google_maps_url: location.google_maps_url,
        }
      : null,
    contact,
    categories,
    offers,
    budget: canViewValues ? eventBudget(event, offers as any[]) : null,
    equipmentBadge,
  };
}

/**
 * Uprawnienia i zakładki karty dokładnie jak `EventDetailPageClient`: obszary z bazy (albo dotychczasowe reguły), zawężenie
 * zakładek z ustawień pracownika, warunki modułów (Finanse — `can_view_event_commercials`, Ustalenia — dokumenty handlowe
 * i zakres sprzedaży, Mavinci LIVE — wymagane moduły; na Macu ta zakładka otwiera CRM).
 */
async function eventCardFlags(ctx: NativeContext, event: any) {
  const pc = event.permissionContext || {};
  const current = event.currentEmployee || {};
  const isAdmin = pc.isAdmin === true;
  const isCreator = pc.isCreator === true;
  const access = pc.access ?? legacyEventAccess({
    eventId: event.id ?? null, isAdmin, isCreator, role: current.role ?? null, accessLevel: current.access_level ?? null,
    permissions: Array.isArray(current.permissions) ? current.permissions : [], billing: false,
  });
  const scopes: string[] = Array.isArray(current.permissions) ? current.permissions : [];
  const has = (scope: string) => scopes.includes(scope);
  const canViewCommercialDocs = canViewEventArea(access, 'commercial_docs');
  const canViewOperations = canViewEventArea(access, 'operations');
  const [commercials, liveModules] = await Promise.all([
    ctx.supabase.rpc('can_view_event_commercials', { p_event_id: event.id }),
    canViewOperations ? ctx.supabase.rpc('get_event_required_mavinci_live_modules', { p_event_id: event.id }) : Promise.resolve({ data: [], error: null }),
  ]);
  const canViewFinanceValues = !commercials.error && commercials.data === true;
  const canViewSellerCorrespondence = canViewCommercialDocs && (isCreator || isAdmin || ['offers_view', 'offers_manage', 'finances_view', 'finances_manage'].some(has));
  const hasLimitedAccess = pc.hasLimitedAccess === true;
  const liveCount = !liveModules.error && Array.isArray(liveModules.data) ? liveModules.data.length : 0;
  const tabs = visibleEventTabs(access, pc.employeeEventTabs ?? null, (tab: EventTabId) => {
    if (hasLimitedAccess && !isCreator && !isAdmin) return tab === 'overview';
    if (tab === 'finances') return canViewFinanceValues;
    if (tab === 'seller-arrangements') return canViewSellerCorrespondence;
    if (tab === 'mavinci-live') return liveCount > 0;
    return true;
  });
  const categoryName = String(event.category?.name || '').trim().toLocaleLowerCase('pl-PL');
  const isWeddingEvent = categoryName.startsWith('wesel');
  return {
    access,
    tabs: tabs.map((id) => ({ id, label: id === 'agenda' && isWeddingEvent ? 'Karta weselna' : EVENT_TAB_LABELS[id] })),
    isAdmin, isCreator, hasLimitedAccess, isWeddingEvent,
    userAssignmentStatus: pc.userAssignmentStatus ?? null,
    canViewClient: canViewEventArea(access, 'client'),
    canViewOnsiteContact: canViewEventArea(access, 'onsite_contact'),
    canViewValues: canViewEventArea(access, 'values'),
    canViewCommercialDocs,
    canViewBilling: canViewEventArea(access, 'billing'),
    canViewOperations,
    canEventManage: pc.canManageEvent ?? Boolean(isCreator || isAdmin || has('events_manage')),
    canManageTeam: pc.canManageTeam === true || isCreator || isAdmin,
    canViewFinanceValues,
    canViewCommercials: isCreator || current.role === 'admin' || ['finances_manage', 'finances_view', 'offers_manage', 'offers_view'].some(has) || canViewFinanceValues,
    canViewSellerCorrespondence,
    sellsEvent: pc.sellsEvent === true,
    // Role osoby w wydarzeniu (kolejność „Najważniejsze”, „Twoja rola”).
    roles: Object.entries((access as any).roles || {}).filter(([, value]) => value === true).map(([key]) => key),
    // Szczegóły → Akcje (`EventDetailsAction`): kategoria (oferty), checklista sprzętu (magazyn), podsumowanie dostępu.
    canOffers: has('offers_manage') || has('admin'),
    canEquipment: has('equipment_manage') || has('admin'),
    accessSummary: eventAccessSummary(access),
  };
}

/** Statusy, w których sprzęt jest już „do wydania” (`EventEquipmentStatusBadge`). */
const EQUIPMENT_PREPARATION_STATUSES = new Set(['offer_accepted', 'in_preparation', 'ready_for_live', 'in_progress']);

/**
 * Stan sprzętu w nagłówku (`EventEquipmentStatusBadge`): do wydania → wydany → czeka na zwrot → rozbieżności / zwrócony.
 * Bez tabeli checklist albo bez dostępu do realizacji — bez odznaki.
 */
async function eventEquipmentBadge(ctx: NativeContext, eventId: string, eventStatus: string) {
  const [stages, lines] = await Promise.all([
    ctx.supabase.from('event_equipment_checklists')
      .select('dispatch_confirmed_at,loadback_confirmed_at,return_confirmed_at,return_issue_count,issues_ack_at').eq('event_id', eventId).maybeSingle(),
    ctx.supabase.from('event_equipment').select('id', { count: 'exact', head: true }).eq('event_id', eventId).not('removed_from_offer', 'is', true),
  ]);
  if (stages.error || lines.error) return null;
  const row = stages.data as any;
  if (row?.return_confirmed_at) {
    return Number(row.return_issue_count || 0) > 0 && !row.issues_ack_at
      ? { label: 'Sprzęt: rozbieżności', tone: 'danger' }
      : { label: 'Sprzęt: zwrócony', tone: 'success' };
  }
  if (row?.loadback_confirmed_at) return { label: 'Sprzęt: czeka na zwrot', tone: 'warning' };
  if (row?.dispatch_confirmed_at) return { label: 'Sprzęt: wydany — czeka na załadunek po wydarzeniu', tone: 'progress' };
  if ((lines.count ?? 0) > 0 && EQUIPMENT_PREPARATION_STATUSES.has(eventStatus)) return { label: 'Sprzęt: do wydania', tone: 'neutral' };
  return null;
}

/**
 * Duplikowanie jak `handleDuplicateEvent`: dane podstawowe (bez ludzi, plików i dokumentów), status „draft”, autor — bieżący
 * pracownik, kwoty z `event_financials` tylko z obszarem „kwoty”.
 */
export async function duplicateEvent(ctx: NativeContext, eventId: string) {
  const event = await fetchEventByIdWith(ctx.supabase, eventId, ctx.employee.authUserId);
  if (!event) throw new Error('Nie znaleziono wydarzenia albo nie masz do niego dostępu.');
  const canViewValues = event.permissionContext.access?.areas?.values === true;
  const source = event as any;
  const duplicated: Record<string, unknown> = {
    created_by: ctx.employee.id,
    name: `${source.name} (kopia)`,
    description: source.description || null,
    event_date: source.event_date,
    event_end_date: source.event_end_date || null,
    location_id: source.location_id || null,
    status: 'draft',
    notes: source.notes || null,
    category_id: source.category_id || null,
    organization_id: source.organization_id || null,
    contact_person_id: source.contact_person_id || null,
    my_company_id: source.my_company_id || null,
    client_type: source.client_type || 'business',
    expected_revenue: canViewValues ? eventMoney(source, source.financials, 'expected_revenue') || null : null,
    estimated_costs: canViewValues ? eventMoney(source, source.financials, 'estimated_costs') || null : null,
  };
  const { data, error } = await ctx.supabase.from('events').insert(duplicated).select('id').single();
  if (error) throw error;
  return String((data as any).id);
}

/**
 * Karta „Budżet” w Szczegółach dokładnie jak `EventDetailPageClient`: najnowsza oferta (zaakceptowana ma pierwszeństwo, potem
 * wysłana / szkic wg daty zmiany; przy źródle „kalkulacja” bez oferty), sumy `getOfferPricingTotals`, koszty i wynik z oferty.
 */
function eventBudget(event: any, offers: any[]) {
  const latest = event.financial_source === 'calculation'
    ? null
    : offers.filter((offer) => ['accepted', 'sent', 'draft'].includes(offer.status)).sort((a, b) => {
        const acceptedPriority = Number(b.status === 'accepted') - Number(a.status === 'accepted');
        if (acceptedPriority) return acceptedPriority;
        return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
      })[0] || null;
  const totals = latest ? getOfferPricingTotals(latest) : null;
  const planned = totals?.gross ?? Number(eventMoney(event, event.financials, 'expected_revenue') || 0);
  const costNet = latest?.total_cost == null ? null : Number(latest.total_cost);
  return {
    source: latest ? 'Źródło: oferta' : event.financial_source === 'calculation' ? 'Źródło: kalkulacja' : 'Źródło: wydarzenie',
    planned,
    actual: Number(eventMoney(event, event.financials, 'actual_revenue') || 0),
    offer: latest && totals ? {
      id: String(latest.id), number: latest.offer_number ?? '', accepted: latest.status === 'accepted',
      listNet: totals.listNet, discountAmount: totals.discountAmount, net: totals.net, taxAmount: totals.taxAmount, gross: totals.gross,
      taxPercent: totals.taxPercent, hasMixedVatRates: totals.hasMixedVatRates === true,
      logisticsPriceNet: latest.logistics_enabled && Number(latest.logistics_price_net) > 0 ? Number(latest.logistics_price_net) : null,
      costNet,
      profitNet: costNet != null ? roundMoney(totals.net - costNet) : null,
      logisticsCostMissing: latest.logistics_cost_net == null,
    } : null,
  };
}

/** Karta ze skrótem — gdy skrót u Maca jest ten sam, odpowiedź jest pusta (`unchanged`). */
export async function eventCardPageWithHash(ctx: NativeContext, eventId: string, known?: string | null) {
  const page = await eventCardPage(ctx, eventId);
  if (!page) return null;
  const hash = digest(page);
  return known && known === hash ? { hash, unchanged: true } : { hash, page };
}

const MISSING = new Set(['42883', 'PGRST202']);
const HIDDEN = new Set(['42501', '42883', 'PGRST202']);

/**
 * Przegląd karty (`effectiveTab === 'overview'`) — te same zapytania co panele CRM, tokenem pracownika:
 * kroki realizacji (`EventStepsPanel`: `get_event_steps`), kontrola przed wydarzeniem (`EventPreflightPanel`: `get_event_preflight`,
 * tylko gdy można zarządzać wydarzeniem), „Najważniejsze” (`EventKeyFactsCard`: fazy z załadunkiem, kierownik realizacji,
 * przekazanie magazynowi, uprawnienia magazynu, pojazdy, kontakty na miejscu, liczba pozycji sprzętu).
 */
export async function eventCardOverview(ctx: NativeContext, eventId: string, options: { canManage: boolean; canSeeOnsite: boolean }) {
  const s = ctx.supabase;
  const [steps, preflight, phases, realization, handoff, canContact, canPrepare, vehicles, onsite, equipment] = await Promise.all([
    s.rpc('get_event_steps', { p_event_id: eventId }),
    options.canManage ? s.rpc('get_event_preflight', { p_event_id: eventId }) : Promise.resolve({ data: null, error: null }),
    s.from('event_phases').select('name, start_time, phase_type:event_phase_types(name)').eq('event_id', eventId)
      .not('start_time', 'is', null).order('start_time', { ascending: true }),
    s.rpc('get_event_realization_assignment', { p_event_id: eventId }),
    s.from('event_warehouse_handoffs').select('accepted_at, accepted_by_name, ready_at, ready_by_name').eq('event_id', eventId).maybeSingle(),
    s.rpc('can_contact_event_warehouse', { p_event_id: eventId }),
    s.rpc('can_prepare_warehouse_event', { p_event_id: eventId }),
    s.from('event_vehicles')
      .select('id, status, is_external, external_vehicle_name, external_company_name, vehicle:vehicles!event_vehicles_vehicle_id_fkey(name, registration_number), driver:employees!event_vehicles_driver_id_fkey(name, surname)')
      .eq('event_id', eventId).order('created_at', { ascending: true }),
    options.canSeeOnsite ? s.rpc('get_event_onsite_contacts', { p_event_id: eventId }) : Promise.resolve({ data: [], error: null }),
    s.from('event_equipment').select('id', { count: 'exact', head: true }).eq('event_id', eventId)
      .or('removed_from_offer.is.null,removed_from_offer.eq.false'),
  ]);
  const stepsCode = (steps.error as any)?.code ?? '';
  const loadingPhase = ((phases.data ?? []) as any[]).find((phase) => {
    const type = Array.isArray(phase.phase_type) ? phase.phase_type[0] : phase.phase_type;
    return /^za.adunek/i.test(String(type?.name || phase.name || '').trim());
  });
  const realizationData = (realization.error ? null : realization.data) as any;
  const vehicleRows = vehicles.error ? null : ((vehicles.data ?? []) as any[])
    .filter((row) => (row.status ?? 'planned') !== 'cancelled')
    .map((row) => {
      const vehicle = Array.isArray(row.vehicle) ? row.vehicle[0] : row.vehicle;
      const driver = Array.isArray(row.driver) ? row.driver[0] : row.driver;
      const label = row.is_external
        ? [row.external_vehicle_name, row.external_company_name].filter(Boolean).join(' · ') || 'Pojazd zewnętrzny'
        : [vehicle?.name, vehicle?.registration_number].filter(Boolean).join(' · ') || 'Pojazd';
      const driverName = driver ? [driver.name, driver.surname].filter(Boolean).join(' ') : null;
      return { id: String(row.id), label, driver: driverName || null };
    });
  const onsiteCode = (onsite.error as any)?.code ?? '';
  return {
    // `hidden` — panel kroków się nie pokazuje; `unavailable` — funkcji nie ma w bazie (wtedy dawne panele realizacji i magazynu).
    steps: steps.error ? { hidden: HIDDEN.has(stepsCode), unavailable: MISSING.has(stepsCode), error: !HIDDEN.has(stepsCode) } : { snapshot: steps.data },
    preflight: preflight.error ? (MISSING.has((preflight.error as any).code ?? '') ? null : null) : preflight.data,
    facts: {
      loadingAt: loadingPhase?.start_time ?? null,
      managerName: realizationData?.realization?.manager_name ?? null,
      operationalStatus: realizationData?.status ?? null,
      handoff: handoff.error ? null : handoff.data,
      handoffKnown: !handoff.error,
      canContactWarehouse: !canContact.error && canContact.data === true,
      canPrepareWarehouse: !canPrepare.error && canPrepare.data === true,
      vehicles: vehicleRows,
    },
    onsite: onsite.error
      ? { contacts: [], error: !HIDDEN.has(onsiteCode) }
      : { contacts: Array.isArray(onsite.data) ? onsite.data : [], error: false },
    equipmentCount: equipment.error ? null : equipment.count ?? 0,
  };
}

export async function eventCardOverviewWithHash(ctx: NativeContext, eventId: string, known: string | null, options: { canManage: boolean; canSeeOnsite: boolean }) {
  const overview = await eventCardOverview(ctx, eventId, options);
  const hash = digest(overview);
  return known && known === hash ? { hash, unchanged: true } : { hash, overview };
}

/**
 * RPC wywoływane z karty na Macu dokładnie jak z przeglądarki (`supabase.rpc`, token pracownika, RLS i reguły w bazie).
 * Tylko funkcje używane przez przeniesione panele karty.
 */
export const EVENT_CARD_RPCS = new Set([
  'get_event_steps', 'update_event_step', 'add_event_step', 'get_event_preflight', 'get_event_onsite_contacts',
  'get_event_warehouse_recipients', 'send_event_warehouse_message', 'accept_warehouse_event', 'advance_warehouse_event',
  'advance_realization', 'get_event_realization_assignment', 'get_event_responsibility_team',
  'appoint_realization_manager', 'revoke_realization_manager',
  // Harmonogram: konflikty obsady, przypisanie osoby i pojazdu do faz, fazy przejazdu bez godzin.
  'get_employee_realization_conflicts', 'assign_event_employee_to_phases_with_conflict_decision', 'assign_event_vehicle_to_phases',
  'save_flexible_travel_phase',
]);

// ---------------------------------------------------------------------------------------------------------------
// Przestrzeń realizacji (`RealizationWorkspace`) — materiały lokalizacji i pliki operacyjne podpisywane jak w CRM,
// tylko te, które zwraca `get_realization_workspace` dla tej osoby (bez podpisywania dowolnych ścieżek).
// ---------------------------------------------------------------------------------------------------------------

const isCadPath = (path: string) => /\.(dxf|dwg)$/i.test(path);

/** Linki do rzutów i zdjęć lokalizacji oraz wybranych sal (`TechnicalDetailsView`: bucket `location-materials`, godzina). */
export async function realizationAssetUrls(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.rpc('get_realization_workspace', { p_event_id: eventId });
  if (error || !data) return null;
  const location = (data as any).location || {};
  const selected: string[] = Array.isArray(location.selected_rooms) ? location.selected_rooms.map(String) : [];
  const rooms: any[] = Array.isArray(location.rooms) ? location.rooms.filter((room: any) => selected.includes(String(room.id))) : [];
  const assets = [location.technical_details, ...rooms.map((room) => room.technical)]
    .flatMap((details: any) => (Array.isArray(details?.assets) ? details.assets : []))
    .filter((asset: any) => typeof asset?.path === 'string' && asset.path);
  const unique = Array.from(new Map<string, any>(assets.map((asset: any) => [String(asset.path), asset] as [string, any])).values());
  const signed = await Promise.all(unique.map(async (asset) => {
    const result = await ctx.supabase.storage.from('location-materials')
      .createSignedUrl(asset.path, 3600, isCadPath(asset.path) ? { download: String(asset.name || 'plik') } : undefined);
    return [String(asset.path), result.error ? null : result.data?.signedUrl ?? null] as const;
  }));
  return Object.fromEntries(signed.filter(([, url]) => Boolean(url)));
}

/** Plik operacyjny (`RealizationWorkspace.file`): adres http(s) z wpisu albo podpisany link do `event-files` na 5 minut. */
export async function realizationFileUrl(ctx: NativeContext, eventId: string, fileId: string) {
  const { data, error } = await ctx.supabase.rpc('get_realization_workspace', { p_event_id: eventId });
  if (error || !data) return null;
  const file = ((data as any).files || []).find((item: any) => String(item.id) === fileId);
  if (!file) return null;
  const name = String(file.name || 'Plik');
  try {
    const url = new URL(String(file.url || ''));
    if (['http:', 'https:'].includes(url.protocol)) return { url: url.href, name };
  } catch {
    // brak adresu — podpisany link do pliku
  }
  if (!file.path) return { url: null, name };
  const signed = await ctx.supabase.storage.from('event-files').createSignedUrl(String(file.path), 300);
  if (signed.error) throw new Error('Nie udało się otworzyć pliku.');
  return { url: signed.data?.signedUrl ?? null, name };
}

// ---------------------------------------------------------------------------------------------------------------
// Szczegóły (`EventsDetailsTab`, `EventDetailsAction`, `EventRooms`, `EditRealizationCompanyModal`) — te same zapytania co CRM.
// ---------------------------------------------------------------------------------------------------------------

/** Logo firmy: logo „signature” z brandbooka, potem `logo_url`; ścieżka względna → publiczny bucket `company-logos`. */
function resolveCompanyLogo(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path) || path.startsWith('data:')) return path;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/${path}`;
}

const ACCEPTED_FOR_CONFIRMATION = ['offer_accepted', 'in_preparation', 'ready_for_live', 'in_progress', 'completed', 'invoiced', 'settled'];

/**
 * Dodatki Szczegółów: firma realizująca z logo, sale lokalizacji z wyborem wydarzenia, historia potwierdzenia e-mail
 * (gdy można zmieniać status i wydarzenie jest zaakceptowane), ostatnia checklista sprzętu (status „Gotowy do realizacji”).
 */
export async function eventCardDetails(ctx: NativeContext, eventId: string, options: { canManageStatus: boolean; canEquipment: boolean }) {
  const s = ctx.supabase;
  const { data: event, error } = await s.from('events')
    .select('id, status, my_company_id, location_id, location_room_ids, stage_room_id').eq('id', eventId).maybeSingle();
  if (error || !event) return null;
  const confirmationNeeded = options.canManageStatus && ACCEPTED_FOR_CONFIRMATION.includes(String(event.status));
  const checklistNeeded = options.canEquipment && event.status === 'ready_for_live';
  const [company, logo, location, history, checklist] = await Promise.all([
    event.my_company_id ? s.from('my_companies').select('*').eq('id', event.my_company_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    event.my_company_id
      ? s.from('company_brandbook_logos').select('url').eq('company_id', event.my_company_id).eq('label', 'signature').maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    event.location_id ? s.from('locations').select('rooms').eq('id', event.location_id).single() : Promise.resolve({ data: null, error: null }),
    confirmationNeeded
      ? s.from('event_audit_log').select('new_value,created_at').eq('event_id', eventId).eq('field_name', 'acceptance_confirmation_email')
        .eq('action', 'email_sent').order('created_at', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    checklistNeeded
      ? s.from('event_files').select('id, name, file_path, created_at').eq('event_id', eventId).eq('document_type', 'equipment_checklist')
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const companyRow = company.error ? null : (company.data as any);
  const rooms = Array.isArray((location.data as any)?.rooms) ? ((location.data as any).rooms as any[]) : [];
  return {
    company: companyRow ? {
      id: String(companyRow.id), name: companyRow.name ?? null, legal_name: companyRow.legal_name ?? null,
      logo_url: resolveCompanyLogo((logo.data as any)?.url || companyRow.logo_url || null),
    } : null,
    rooms: event.location_id ? {
      locationId: String(event.location_id),
      error: Boolean(location.error),
      rooms: rooms.map((room) => ({ id: String(room.id), name: String(room.name ?? ''), notes: room.notes ? String(room.notes) : null })),
      selected: Array.isArray(event.location_room_ids) ? event.location_room_ids.map(String) : [],
      stage: event.stage_room_id ? String(event.stage_room_id) : null,
    } : null,
    confirmation: confirmationNeeded ? {
      historyError: Boolean(history.error),
      delivery: history.data ? { recipient: (history.data as any).new_value || '', sentAt: (history.data as any).created_at } : null,
    } : null,
    checklist: checklistNeeded ? { available: Boolean((checklist.data as any)?.file_path), error: Boolean(checklist.error) } : null,
  };
}

export async function eventCardDetailsWithHash(ctx: NativeContext, eventId: string, known: string | null, options: { canManageStatus: boolean; canEquipment: boolean }) {
  const details = await eventCardDetails(ctx, eventId, options);
  if (!details) return null;
  const hash = digest(details);
  return known && known === hash ? { hash, unchanged: true } : { hash, details };
}

/** Aktywne firmy realizujące z logo (`EditRealizationCompanyModal`). */
export async function realizationCompanies(ctx: NativeContext) {
  const { data, error } = await ctx.supabase.from('my_companies').select('id, name, legal_name, nip, email, phone, logo_url, is_default')
    .eq('is_active', true).order('is_default', { ascending: false }).order('name');
  if (error) throw error;
  const ids = (data ?? []).map((company) => company.id);
  const { data: logos } = ids.length
    ? await ctx.supabase.from('company_brandbook_logos').select('company_id, url').in('company_id', ids).eq('label', 'signature')
    : { data: [] as any[] };
  const byCompany = new Map<string, string>((logos ?? []).map((logo: any) => [String(logo.company_id), String(logo.url)] as [string, string]));
  return (data ?? []).map((company: any) => ({
    id: String(company.id), name: company.name ?? '', legal_name: company.legal_name ?? null, nip: company.nip ?? null,
    email: company.email ?? null, logo_url: resolveCompanyLogo(byCompany.get(company.id) || company.logo_url || null),
  }));
}

/** Lokalizacje do wyboru (`LocationSelector` — `useLocations`: cała lista, filtrowanie po nazwie, mieście i adresie). */
export async function eventLocations(ctx: NativeContext) {
  const { data, error } = await ctx.supabase.from('locations').select('id, name, address, city, postal_code, formatted_address').order('name');
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: String(row.id), name: row.name ?? '', address: row.address ?? null, city: row.city ?? null,
    postal_code: row.postal_code ?? null, formatted_address: row.formatted_address ?? null,
  }));
}

/** Odbiorca potwierdzenia: kontakt wydarzenia, potem organizacja (`loadEventAcceptanceConfirmationPreview`). */
export async function eventConfirmationPreview(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const { data: event, error } = await s.from('events').select('id, name, event_date, contact_person_id, organization_id').eq('id', eventId).single();
  if (error || !event) throw new Error('Nie udało się odczytać wydarzenia i odbiorcy potwierdzenia.');
  const [contactResult, organizationResult] = await Promise.all([
    event.contact_person_id
      ? s.from('contacts').select('full_name, first_name, last_name, email').eq('id', event.contact_person_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    event.organization_id
      ? s.from('organizations').select('name, email').eq('id', event.organization_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (contactResult.error || organizationResult.error) throw new Error('Nie udało się odczytać odbiorcy potwierdzenia.');
  const contact = contactResult.data as any;
  const organization = organizationResult.data as any;
  return {
    eventId: String(event.id),
    eventName: event.name || 'Wydarzenie',
    eventDate: event.event_date || null,
    recipientEmail: contact?.email || organization?.email || null,
    recipientName: contact?.email
      ? contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ')
      : organization?.name || '',
  };
}

/** Wysyłka potwierdzenia jak `sendEventAcceptanceConfirmation`: kontrola odbiorcy, funkcja `send-event-confirmation` z tokenem pracownika. */
export async function sendEventConfirmation(ctx: NativeContext, token: string, eventId: string, expectedRecipientEmail: string) {
  const preview = await eventConfirmationPreview(ctx, eventId);
  if (!preview.recipientEmail || preview.recipientEmail !== expectedRecipientEmail) {
    throw new Error('Odbiorca potwierdzenia zmienił się lub nie ma adresu e-mail. Sprawdź dane wydarzenia przed wysyłką.');
  }
  let response: Response;
  try {
    response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-event-confirmation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ eventId, acceptedById: ctx.employee.authUserId ?? null }),
    });
  } catch {
    throw new Error('Nie udało się potwierdzić wyniku wysyłki. Sprawdź wysłane wiadomości przed ponownym wysłaniem.');
  }
  const result = (await response.json().catch(() => null)) as any;
  if (!response.ok || result?.success !== true) {
    throw new Error(result?.message || result?.error || 'Nie udało się potwierdzić wysyłki. Sprawdź wysłane wiadomości przed ponowieniem.');
  }
  return {
    recipientEmail: result.recipientEmail || preview.recipientEmail,
    sentAt: result.sentAt || new Date().toISOString(),
    historyRecorded: result.historyRecorded === true,
  };
}

/** Link do ostatniej checklisty sprzętu (`handleShowChecklistPdf`) — podpisany na godzinę. */
export async function equipmentChecklistUrl(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.from('event_files').select('name, file_path').eq('event_id', eventId)
    .eq('document_type', 'equipment_checklist').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data?.file_path) return null;
  const signed = await ctx.supabase.storage.from('event-files').createSignedUrl(data.file_path, 3600);
  if (signed.error) throw signed.error;
  return { url: signed.data?.signedUrl ?? null, name: data.name || 'checklista-sprzetu.pdf' };
}

// ---------------------------------------------------------------------------------------------------------------
// Zespół (`useEventTeam`, `TeamMembersList`, `AddEventEmployeeModal`) — te same zapytania i zapisy co CRM, tokenem pracownika.
// ---------------------------------------------------------------------------------------------------------------

export const EVENT_TEAM_PERMISSIONS = [
  'can_edit_event', 'can_edit_phases', 'can_edit_agenda', 'can_edit_tasks', 'can_edit_files', 'can_edit_equipment', 'can_invite_members', 'can_view_budget',
] as const;

/** Zespół: przypisania (`getEventEmployees`) z rolami odpowiedzialności, osoby z odpowiedzialności bez przypisania, kierownik realizacji. */
export async function eventTeam(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const [assignments, responsibility, leadership, vehicles] = await Promise.all([
    s.from('employee_assignments')
      .select('*, employee:employees!employee_assignments_employee_id_fkey(id, name, surname, avatar_url, avatar_metadata)')
      .eq('event_id', eventId).order('created_at', { ascending: true }),
    s.rpc('get_event_responsibility_team', { p_event_id: eventId }),
    s.rpc('get_event_realization_assignment', { p_event_id: eventId }),
    // Auta wydarzenia do przydziału transportu (bez dostępu do logistyki — bez sekcji transportu).
    s.from('event_vehicles').select(TEAM_TRANSPORT_VEHICLE_SELECT).eq('event_id', eventId).order('created_at', { ascending: true }),
  ]);
  const extra = responsibility.error || !Array.isArray(responsibility.data) ? [] : (responsibility.data as any[]);
  const rows = ((assignments.data ?? []) as any[]).map((row) => ({
    ...row,
    responsibility_roles: extra.find((person) => person.employee_id === row.employee_id)?.responsibility_roles || [],
  }));
  for (const member of extra) if (!rows.some((row) => row.employee_id === member.employee_id)) rows.push(member);
  const members = rows.map((row: any) => {
    const employee = Array.isArray(row.employee) ? row.employee[0] : row.employee;
    return {
      id: String(row.id),
      employeeId: String(row.employee_id || employee?.id || ''),
      hasEmployee: Boolean(employee),
      name: `${employee?.name ?? ''} ${employee?.surname ?? ''}`.trim() || 'Brak danych pracownika',
      avatarUrl: employee?.avatar_url || null,
      avatar: imageCrop(employee?.avatar_metadata),
      role: row.role || null,
      responsibilities: row.responsibilities || null,
      status: row.status || 'pending',
      invitationEmailSent: Boolean(row.invitation_email_sent),
      automatic: row.automatic_member === true,
      responsibilityRoles: Array.isArray(row.responsibility_roles) ? row.responsibility_roles.map(String) : [],
      permissions: Object.fromEntries(EVENT_TEAM_PERMISSIONS.map((key) => [key, row[key] === true])),
      transportVehicleId: row.transport_event_vehicle_id ? String(row.transport_event_vehicle_id) : null,
    };
  });
  const fleet = vehicles.error ? null : mapTeamTransportVehicles((vehicles.data ?? []) as any[]);
  const summary = fleet ? summarizeTeamTransport(fleet, members.filter((member) => member.hasEmployee).map((member) => ({
    employeeId: member.employeeId, transportVehicleId: member.transportVehicleId, rejected: member.status === 'rejected',
  }))) : null;
  return {
    members,
    transport: fleet && summary ? {
      vehicles: summary.loads.map((load) => ({ ...load.vehicle, people: load.people, overCapacity: load.overCapacity })),
      withoutVehicle: summary.withoutVehicle,
      teamSize: summary.teamSize,
      knownSeats: summary.knownSeats,
      shortage: summary.shortage,
      warnings: summary.warnings,
    } : null,
    error: Boolean(assignments.error),
    leadership: leadership.error ? null : leadership.data ?? null,
    leadershipError: Boolean(leadership.error),
  };
}

export async function eventTeamWithHash(ctx: NativeContext, eventId: string, known: string | null) {
  const team = await eventTeam(ctx, eventId);
  const hash = digest(team);
  return known && known === hash ? { hash, unchanged: true } : { hash, team };
}

/** Do okna „Dodaj osobę do zespołu”: aktywni pracownicy, poziomy dostępu i fazy timeline przypisane w tym wydarzeniu. */
export async function eventTeamCandidates(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const [employees, levels, phases] = await Promise.all([
    s.rpc('employees_public_list'),
    s.from('access_levels').select('*').order('order_index'),
    s.from('event_phase_assignments')
      .select('employee_id, phase_id, phase_work_start, phase_work_end, event_phases!inner(id, name, event_id)')
      .eq('event_phases.event_id', eventId),
  ]);
  if (employees.error) throw employees.error;
  const byEmployee: Record<string, { phaseId: string; name: string; workStart: string | null; workEnd: string | null }[]> = {};
  for (const row of (phases.data ?? []) as any[]) {
    const phase = Array.isArray(row.event_phases) ? row.event_phases[0] : row.event_phases;
    (byEmployee[String(row.employee_id)] ||= []).push({
      phaseId: String(row.phase_id), name: phase?.name ?? '', workStart: row.phase_work_start ?? null, workEnd: row.phase_work_end ?? null,
    });
  }
  return {
    employees: ((employees.data ?? []) as any[]).filter((row) => row?.is_active === true).map((row) => ({
      id: String(row.id), name: row.name ?? '', surname: row.surname ?? '', occupation: row.occupation ?? null,
    })),
    accessLevels: levels.error ? [] : ((levels.data ?? []) as any[]).map((level) => ({
      id: String(level.id), name: level.name ?? '', description: level.description ?? '', slug: level.slug ?? null,
    })),
    phases: byEmployee,
    phasesError: Boolean(phases.error),
  };
}

/** Zaproszenie / aktualny timeline (`send-event-invitation`) jak `supabase.functions.invoke` w przeglądarce. */
export async function sendTeamInvitation(ctx: NativeContext, assignmentId: string, includePhases: boolean, mode: 'invitation' | 'timeline_update') {
  const result = await ctx.supabase.functions.invoke('send-event-invitation', { body: { assignmentId, includePhases, mode } });
  if (result.error) return { ok: false, skipped: false };
  return { ok: true, skipped: Boolean((result.data as any)?.skipped) };
}

/** Dodanie do zespołu (`addEventEmployee`): przypisanie z uprawnieniami, zgodność ze starszą bazą, zaproszenie e-mailem. */
export async function addTeamMember(ctx: NativeContext, eventId: string, input: Record<string, any>) {
  const permissions = input.permissions && typeof input.permissions === 'object' ? input.permissions : {};
  const payload: Record<string, unknown> = {
    event_id: eventId,
    employee_id: String(input.employeeId || ''),
    role: typeof input.role === 'string' ? input.role : '',
    responsibilities: typeof input.responsibilities === 'string' && input.responsibilities ? input.responsibilities : null,
    // Zakres widoczności z roli pracownika — baza ustawia go przy dodaniu (migracja 20261112212000).
    access_level_id: null,
    ...Object.fromEntries(EVENT_TEAM_PERMISSIONS.map((key) => [key, permissions[key] === true])),
  };
  let { data, error } = await ctx.supabase.from('employee_assignments').insert(payload).select().single();
  if (error?.code === 'PGRST204' && error.message?.includes('can_edit_phases')) {
    const { can_edit_phases: _phase, ...compatible } = payload;
    const retry = await ctx.supabase.from('employee_assignments').insert(compatible).select().single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  if ((data as any)?.id && (data as any).status === 'pending' && input.sendInvitation !== false) {
    // Jak w CRM: nieudana wiadomość nie cofa dodania do zespołu.
    await sendTeamInvitation(ctx, String((data as any).id), input.includePhases === true, 'invitation').catch(() => null);
  }
  return data;
}

/** Uprawnienia w wydarzeniu (`savePermissions`) — ze zgodnością ze starszą bazą bez `can_edit_phases`. */
export async function saveTeamPermissions(ctx: NativeContext, assignmentId: string, permissions: Record<string, unknown>) {
  const form = Object.fromEntries(EVENT_TEAM_PERMISSIONS.map((key) => [key, permissions[key] === true]));
  let { error } = await ctx.supabase.from('employee_assignments')
    .update({ ...form, permissions_updated_at: new Date().toISOString() }).eq('id', assignmentId);
  if (error?.code === 'PGRST204' && error.message?.includes('can_edit_phases')) {
    const { can_edit_phases: _phase, ...compatible } = form;
    const retry = await ctx.supabase.from('employee_assignments')
      .update({ ...compatible, permissions_updated_at: new Date().toISOString() }).eq('id', assignmentId);
    error = retry.error;
  }
  if (error) throw error;
}
