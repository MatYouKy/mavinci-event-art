import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { systemLabel } from '@/lib/ui/systemLabels';
import { EVENT_STEP_ROLE_LABELS, EVENT_STEP_STATUS_LABELS, type EventStepRole, type EventStepStatus } from '@/lib/events/steps/eventSteps';
import { canViewEventArea, parseEventAccess } from '@/lib/events/access/eventAccess';
import type {
  EventCardData,
  EventCardEquipment,
  EventCardPerson,
  EventCardPreparation,
  EventCardScheduleRow,
  EventCardSubcontractor,
  EventCardVehicle,
} from '@/lib/events/print/buildEventCardHtml';

/**
 * Dane Karty imprezy.
 *
 * Dostęp: `get_realization_workspace` (klient zalogowanej osoby) — ta sama reguła co pulpit realizacji
 * w CRM i w aplikacji mobilnej: kierownik realizacji albo osoba, która może prowadzić realizację
 * (administrator, `events_manage`, autor wydarzenia). Dopiero gdy funkcja zwróci dane, serwer doczytuje
 * uzupełnienia (rejestracje aut, trasy, ekipę etapów, wymagania produktów) wyłącznie z kolumnami bez kwot.
 */

type Json = any;

export class EventCardError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

const text = (value: unknown) => (value == null ? '' : String(value).trim());
/** Rola z bazy po polsku (kody jak `technician` → „Technik”; własne nazwy ról bez zmian). */
const roleLabel = (value: unknown) => (text(value) ? systemLabel(text(value), 'role', { preserveCustom: true }) : '');
const purposeLabel = (value: unknown) => (text(value) ? systemLabel(text(value), 'vehiclePurpose', { preserveCustom: true }) : '');
const fullName = (row: { name?: string | null; surname?: string | null } | null | undefined) =>
  [row?.name, row?.surname].map(text).filter(Boolean).join(' ');

const EVENT_STATUS_LABELS: Record<string, string> = {
  inquiry: 'Zapytanie',
  offer_to_send: 'Oferta do wysłania',
  offer_sent: 'Oferta wysłana',
  offer_accepted: 'Oferta zaakceptowana',
  in_preparation: 'W przygotowaniu',
  ready_for_live: 'Gotowe do realizacji',
  in_progress: 'W trakcie',
  completed: 'Zrealizowane',
  invoiced: 'Zafakturowane',
  settled: 'Rozliczone',
  cancelled: 'Anulowane',
};

const plusMinutes = (iso: string | null | undefined, minutes: number | null | undefined) => {
  if (!iso || !minutes) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : new Date(date.getTime() + minutes * 60_000).toISOString();
};

const slug = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'wydarzenie';

export type LoadedEventCard = {
  data: EventCardData;
  companyId: string | null;
  fileName: string;
  dateLabel: string;
};

export async function loadEventCardData(
  userClient: SupabaseClient,
  eventId: string,
  authUserId: string,
): Promise<LoadedEventCard> {
  const { data: workspace, error: workspaceError } = await userClient.rpc('get_realization_workspace', { p_event_id: eventId });
  if (workspaceError) {
    throw new EventCardError('Nie udało się odczytać danych realizacji wydarzenia. Spróbuj ponownie.', 500);
  }
  if (!workspace) {
    throw new EventCardError(
      'Kartę imprezy przygotowuje kierownik realizacji, autor wydarzenia albo osoba z uprawnieniem do zarządzania wydarzeniami.',
      403,
    );
  }
  const ws = workspace as Json;

  const { data: responsibility } = await userClient.rpc('get_event_responsibility_team', { p_event_id: eventId });
  // Obszary danych (migracja 20261105090000): bez obszaru „klient” karta pokazuje kontakt na miejscu (imię, telefon), bez e-maili.
  const { data: accessData, error: accessError } = await userClient.rpc('get_event_access', { p_event_id: eventId });
  // Brak funkcji (migracja jeszcze niewdrożona) = dotychczasowe zachowanie; inny błąd = bez danych klienta.
  const accessMissing = accessError && ['PGRST202', '42883'].includes(String(accessError.code ?? ''));
  const access = accessError ? null : parseEventAccess(accessData);
  const showClientDetails = access ? canViewEventArea(access, 'client') : Boolean(accessMissing);
  const showClientName = access
    ? canViewEventArea(access, 'client') || canViewEventArea(access, 'sales_overview') || canViewEventArea(access, 'onsite_contact')
    : Boolean(accessMissing);

  // Uzupełnienia po potwierdzeniu dostępu — tylko kolumny operacyjne (bez kwot, kosztów i danych finansowych).
  const admin = createSupabaseAdminClient();
  const [eventRes, contactsRes, vehiclesRes, phasesRes, equipmentRes, offersRes, handoffRes, subcontractorsRes, weddingRes, generatorRes, stepsRes] =
    await Promise.all([
      admin
        .from('events')
        .select('id,name,event_date,event_end_date,my_company_id,location_room_ids,stage_room_id,loading_confirmed,loading_confirmed_at,equipment_checklist_notes,equipment_checklist_note_items,category:event_categories(name),organization:organizations!events_organization_id_fkey(name),location:locations(name,google_maps_url,latitude,longitude),company:my_companies(name,website)')
        .eq('id', eventId)
        .maybeSingle(),
      admin
        .from('event_contact_persons')
        .select('role,is_primary,notes,contact:contacts(full_name,first_name,last_name,phone,mobile,business_phone,email,position)')
        .eq('event_id', eventId),
      admin
        .from('event_vehicles')
        .select('id,role,status,departure_location,departure_time,arrival_time,return_departure_time,return_arrival_time,estimated_distance_km,travel_plan,notes,is_external,external_company_name,has_trailer,vehicle:vehicles!event_vehicles_vehicle_id_fkey(name,brand,model,registration_number,number_of_seats),driver_id,driver:employees!event_vehicles_driver_id_fkey(id,name,surname,phone_number)')
        .eq('event_id', eventId),
      admin
        .from('event_phases')
        .select('id,name,start_time,end_time,sequence_order,phase_type:event_phase_types(name),assignments:event_phase_assignments(role,assignment_start,assignment_end,invitation_status,travel_to_notes,travel_from_notes,employee:employees!event_phase_assignments_employee_id_fkey(id,name,surname,phone_number)),phase_vehicles:event_phase_vehicles(purpose,assigned_start,assigned_end,vehicle:vehicles(name,registration_number),driver:employees!event_phase_vehicles_driver_id_fkey(id,name,surname,phone_number))')
        .eq('event_id', eventId)
        .order('sequence_order', { ascending: true }),
      admin
        .from('event_equipment')
        .select('quantity,notes,is_optional,removed_from_offer,use_external_rental,reservation_status,item:equipment_items(name,category:warehouse_categories(name)),kit:equipment_kits(name),cable:cables(name)')
        .eq('event_id', eventId),
      admin
        .from('offers')
        .select('id,status,items:offer_items(name,quantity,unit,display_order,product:offer_products(name,offer_additional_requirements,setup_time_hours,teardown_time_hours))')
        .eq('event_id', eventId)
        .eq('status', 'accepted'),
      admin.from('event_warehouse_handoffs').select('requested_at,accepted_at,accepted_by_name,ready_at,ready_by_name').eq('event_id', eventId).maybeSingle(),
      admin.from('subcontractor_tasks').select('id,subcontractor:subcontractors(company_name)').eq('event_id', eventId),
      admin
        .from('wedding_cards')
        .select('people:wedding_card_people(side,role,first_name,last_name,phone,notes,sort_order)')
        .eq('event_id', eventId)
        .maybeSingle(),
      admin.from('employees').select('name,surname').or(`auth_user_id.eq.${authUserId},id.eq.${authUserId}`).maybeSingle(),
      // Kroki realizacji (migracja 20261104200000). Przed wdrożeniem migracji zapytanie zwraca błąd — karta używa wtedy braków i wynajmów.
      admin
        .from('event_steps')
        .select('step_key,stage,kind,source,title,quantity,unit,supplier,owner_role,due_at,status,status_note,expected_at,blocks_ready,sort_order,assignee:employees!event_steps_assignee_id_fkey(name,surname)')
        .eq('event_id', eventId)
        .in('stage', ['handoff', 'preparation'])
        .neq('status', 'archived')
        .order('sort_order', { ascending: true }),
    ]);

  if (eventRes.error || !eventRes.data) {
    throw new EventCardError('Nie udało się odczytać wydarzenia do karty imprezy. Spróbuj ponownie.', 500);
  }
  const vehiclesRows: Json[] = vehiclesRes.data ?? [];

  const event: Json = eventRes.data ?? {};
  const notices: string[] = [];

  // Kierownik imprezy: kierownik realizacji, a gdy go nie wyznaczono — koordynator wydarzenia.
  const team: Json[] = Array.isArray(ws.team) ? ws.team : [];
  const responsibilityRows: Json[] = Array.isArray(responsibility) ? responsibility : [];
  const phoneByEmployee = new Map<string, string>();
  for (const member of team) if (member.employee_id && member.phone) phoneByEmployee.set(member.employee_id, member.phone);
  for (const row of responsibilityRows) {
    if (row.employee_id && row.employee?.phone_number) phoneByEmployee.set(row.employee_id, row.employee.phone_number);
  }

  let manager: EventCardPerson | null = null;
  const realization = ws.realization as Json;
  if (realization?.manager_id || realization?.manager_name) {
    const member = team.find((m) => m.employee_id === realization.manager_id);
    const resp = responsibilityRows.find((r) => r.employee_id === realization.manager_id);
    manager = {
      name: text(realization.manager_name) || text(member?.name) || fullName(resp?.employee),
      role: 'Kierownik realizacji',
      phone: phoneByEmployee.get(realization.manager_id) || null,
      email: member?.email || resp?.employee?.email || null,
    };
  } else {
    const coordinator = team.find((m) => /koordynator/i.test(text(m.role)));
    if (coordinator) {
      manager = { name: text(coordinator.name), role: 'Koordynator wydarzenia', phone: coordinator.phone || null, email: coordinator.email || null };
      notices.push('Nie wyznaczono kierownika realizacji — na karcie jest koordynator wydarzenia. Wyznacz kierownika w zakładce Zespół.');
    } else {
      notices.push('Nie wyznaczono kierownika realizacji ani koordynatora wydarzenia.');
    }
  }

  // Klient i kontakty.
  const clientContacts: EventCardPerson[] = [];
  const mainContact = ws.contact as Json;
  if (text(mainContact?.name)) {
    clientContacts.push({ name: text(mainContact.name), role: 'Osoba kontaktowa', phone: mainContact.phone || null, email: showClientDetails ? mainContact.email || null : null });
  }
  for (const row of (contactsRes.data ?? []) as Json[]) {
    const contact = row.contact;
    const name = text(contact?.full_name) || [contact?.first_name, contact?.last_name].map(text).filter(Boolean).join(' ');
    if (!name || clientContacts.some((c) => c.name === name)) continue;
    clientContacts.push({
      name,
      role: text(row.role) || text(contact?.position) || null,
      phone: contact?.mobile || contact?.phone || contact?.business_phone || null,
      email: showClientDetails ? contact?.email || null : null,
      note: text(row.notes) || null,
    });
  }
  // Na weselu: para młoda, świadkowie i rodzice z karty weselnej.
  const weddingPeople = ((weddingRes.data as Json)?.people ?? []) as Json[];
  for (const person of weddingPeople.sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))) {
    const name = [person.first_name, person.last_name].map(text).filter(Boolean).join(' ');
    if (!name || !person.phone) continue;
    clientContacts.push({ name, role: [text(person.role), text(person.side)].filter(Boolean).join(' · ') || 'Karta weselna', phone: person.phone, note: text(person.notes) || null });
  }

  // Miejsce.
  const location = (ws.location ?? {}) as Json;
  const rooms: Json[] = Array.isArray(location.rooms) ? location.rooms : [];
  const selectedRoomIds: string[] = Array.isArray(location.selected_rooms) ? location.selected_rooms : [];
  const roomNotes = rooms
    .filter((room) => selectedRoomIds.includes(room.id) || room.id === location.stage_room_id)
    .map((room) => `${text(room.name)}${room.id === location.stage_room_id ? ' (scena)' : ''}${text(room.notes) ? `: ${text(room.notes)}` : ''}`)
    .filter(Boolean);
  const venueContacts: EventCardPerson[] = text(location.contact_name) || location.phone
    ? [{ name: text(location.contact_name) || 'Kontakt w obiekcie', role: 'Obiekt', phone: location.phone || null }]
    : [];
  const mapUrl = text(event.location?.google_maps_url)
    || (event.location?.latitude && event.location?.longitude ? `https://maps.google.com/?q=${event.location.latitude},${event.location.longitude}` : '');
  if (location.name && !venueContacts.length) notices.push('Brak telefonu do osoby kontaktowej w obiekcie — uzupełnij go w karcie lokalizacji.');

  // Etapy, ekipa etapów i auta przypisane do etapów.
  const phases: Json[] = phasesRes.data ?? [];
  const schedule: EventCardScheduleRow[] = [];
  const phaseCrewByEmployee = new Map<string, Set<string>>();
  const travelCrew = new Map<string, EventCardPerson>();
  for (const phase of phases) {
    const typeName = text(phase.phase_type?.name) || text(phase.name);
    const crew = (phase.assignments ?? []).filter((a: Json) => a.invitation_status !== 'rejected' && a.employee);
    const crewNames = crew.map((a: Json) => fullName(a.employee)).filter(Boolean);
    const phaseVehicles = (phase.phase_vehicles ?? []).map((pv: Json) =>
      [text(pv.vehicle?.name), text(pv.vehicle?.registration_number)].filter(Boolean).join(' '),
    ).filter(Boolean);
    schedule.push({
      start: phase.start_time,
      end: phase.end_time,
      title: text(phase.name) || typeName,
      details: [phaseVehicles.length ? `Auta: ${phaseVehicles.join(', ')}` : '', ...crew.map((a: Json) => text(a.travel_to_notes) || text(a.travel_from_notes)).filter(Boolean)].filter(Boolean).join('\n') || null,
      people: crewNames.join(', ') || null,
      kind: /dojazd|powrót|powrot|załadunek|zaladunek|rozładunek|rozladunek/i.test(typeName) ? 'logistics' : 'phase',
    });
    for (const a of crew) {
      const id = a.employee.id;
      if (!phaseCrewByEmployee.has(id)) phaseCrewByEmployee.set(id, new Set());
      phaseCrewByEmployee.get(id)!.add(typeName);
      if (/dojazd/i.test(typeName)) {
        travelCrew.set(id, { name: fullName(a.employee), role: roleLabel(a.role) || null, phone: a.employee.phone_number || null });
      }
    }
  }

  // Agenda (godziny z agendy klienta).
  for (const item of (Array.isArray(ws.agenda) ? ws.agenda : []) as Json[]) {
    if (!text(item.title)) continue;
    schedule.push({ start: item.time, title: text(item.title), details: text(item.description) || null, kind: 'agenda' });
  }

  // Auta: wyjazd, przyjazd, powrót, trasa; pasażerowie z etapu „Dojazd”.
  const activeVehicles = vehiclesRows.filter((v) => text(v.status) !== 'cancelled');
  // Gdy są etapy „Dojazd” / „Powrót”, wyjazdy i powroty aut są już w harmonogramie — bez podwójnych wierszy.
  const hasTravelPhases = phases.some((p) => /dojazd|powrót|powrot/i.test(text(p.phase_type?.name) || text(p.name)));
  const driverIds = new Set<string>();
  const vehicles: EventCardVehicle[] = activeVehicles.map((v) => {
    const plan = (v.travel_plan ?? {}) as Json;
    const outbound = plan.outbound ?? {};
    const minutes = Number(outbound.plannedMinutes ?? outbound.baseMinutes ?? 0) || null;
    const name = v.is_external
      ? `${text(v.external_company_name) || 'Auto zewnętrzne'}`
      : [text(v.vehicle?.name), [text(v.vehicle?.brand), text(v.vehicle?.model)].filter(Boolean).join(' ')].filter(Boolean).join(' — ') || 'Auto';
    const driver = v.driver ? { name: fullName(v.driver), role: 'Kierowca', phone: v.driver.phone_number || null } : null;
    const departureTime = v.departure_time || null;
    const arrivalTime = v.arrival_time || plusMinutes(departureTime, minutes);
    if (departureTime && !hasTravelPhases) {
      schedule.push({ start: departureTime, title: `Wyjazd: ${name}`, details: text(v.departure_location) || text(plan.origin) || null, people: driver?.name || null, kind: 'logistics' });
    }
    if (v.return_departure_time && !hasTravelPhases) {
      schedule.push({ start: v.return_departure_time, title: `Powrót: ${name}`, people: driver?.name || null, kind: 'logistics' });
    }
    return {
      name: `${name}${v.has_trailer ? ' + przyczepa' : ''}`,
      registration: text(v.vehicle?.registration_number) || null,
      driver,
      passengers: [],
      departure: { place: text(v.departure_location) || text(plan.origin) || null, time: departureTime },
      arrival: { place: text(plan.destination) || text(location.name) || null, time: arrivalTime },
      returnTime: v.return_arrival_time || v.return_departure_time || null,
      distanceKm: v.estimated_distance_km != null ? Number(v.estimated_distance_km) : null,
      durationMinutes: minutes,
      notes: [text(v.role) ? `Zadanie: ${purposeLabel(v.role)}` : '', text(v.notes)].filter(Boolean).join('\n') || null,
    };
  });
  for (const v of activeVehicles) if (v.driver_id) driverIds.add(v.driver_id);
  const passengers = [...travelCrew.entries()].filter(([id]) => !driverIds.has(id)).map(([, person]) => person);
  if (vehicles.length === 1) {
    vehicles[0].passengers = passengers;
  } else if (vehicles.length > 1 && passengers.length) {
    notices.push(`Przydział osób do aut nie jest zapisany w CRM. Na dojazd są przypisani: ${passengers.map((p) => p.name).join(', ')} — ustal, kto jedzie którym autem.`);
  }
  if (!vehicles.length && phases.some((p) => /dojazd/i.test(text(p.phase_type?.name) || text(p.name)))) {
    notices.push('Etap „Dojazd” nie ma przypisanego auta z kierowcą.');
  }

  // Zespół: role z wydarzenia, odpowiedzialności (magazyn, kierowca, kierownik) i etapy.
  const people = new Map<string, EventCardPerson & { roles: Set<string> }>();
  const addMember = (id: string | null | undefined, name: string, role: string | null | undefined, phone?: string | null, email?: string | null) => {
    if (!name) return;
    const key = id || name;
    const existing = people.get(key) ?? { name, roles: new Set<string>(), phone: phone || null, email: email || null };
    for (const part of text(role).split(',').map((value) => value.trim()).filter(Boolean)) {
      if (![...existing.roles].some((known) => known.toLowerCase() === part.toLowerCase())) existing.roles.add(part);
    }
    existing.phone = existing.phone || phone || null;
    people.set(key, existing);
  };
  for (const member of team) addMember(member.employee_id, text(member.name), text(member.responsibilities) || roleLabel(member.role), member.phone, member.email);
  for (const row of responsibilityRows) {
    for (const role of (row.responsibility_roles ?? []) as string[]) {
      addMember(row.employee_id, fullName(row.employee), role, row.employee?.phone_number, row.employee?.email);
    }
  }
  const teamCard: EventCardPerson[] = [...people.entries()].map(([id, person]) => ({
    name: person.name,
    role: [...person.roles].join(', ') || null,
    phone: person.phone || null,
    email: person.email || null,
    note: phaseCrewByEmployee.has(id) ? `Etapy: ${[...phaseCrewByEmployee.get(id)!].join(', ')}` : null,
  }));

  // Podwykonawcy.
  const companyByTask = new Map<string, string>();
  for (const row of (subcontractorsRes.data ?? []) as Json[]) {
    if (row.subcontractor?.company_name) companyByTask.set(row.id, row.subcontractor.company_name);
  }
  const subcontractors: EventCardSubcontractor[] = ((Array.isArray(ws.subcontractors) ? ws.subcontractors : []) as Json[]).map((task) => ({
    company: companyByTask.get(task.id) || text(task.name) || 'Podwykonawca',
    scope: [text(task.name) !== companyByTask.get(task.id) ? text(task.name) : '', text(task.scope)].filter(Boolean).join(' — ') || null,
    contact: task.contact_name || task.phone ? { name: text(task.contact_name) || 'Kontakt', phone: task.phone || null, email: task.email || null } : null,
    when: [task.start, task.end].filter(Boolean).length ? `${formatShort(task.start)}${task.end ? ` – ${formatShort(task.end)}` : ''}` : null,
  }));

  // Sprzęt (bez opcjonalnych i usuniętych z oferty) + braki i wynajem zewnętrzny do przygotowania.
  const equipmentRows: Json[] = equipmentRes.data ?? [];
  const equipment: EventCardEquipment[] = [];
  const preparation: EventCardPreparation[] = [];
  const eventDate = text(event.event_date) || text(ws.event_date);
  for (const row of equipmentRows) {
    if (row.removed_from_offer) continue;
    const name = text(row.item?.name) || text(row.kit?.name) || text(row.cable?.name) || 'Sprzęt';
    if (row.is_optional && row.reservation_status === 'planned') {
      preparation.push({ label: `Brak w magazynie: ${name} × ${row.quantity ?? 1} — zapewnić (wynajem, zakup lub zamiana)`, owner: 'Magazyn', status: 'Do zamówienia', urgent: true });
      continue;
    }
    if (row.is_optional) continue;
    if (row.use_external_rental) {
      preparation.push({ label: `Wynajem zewnętrzny: ${name} × ${row.quantity ?? 1} — potwierdzić odbiór i zwrot`, owner: 'Magazyn', status: 'Do potwierdzenia' });
    }
    const group = text(row.item?.category?.name) || (row.kit ? 'Zestawy' : row.cable ? 'Okablowanie' : 'Sprzęt');
    const notes = [text(row.notes), row.use_external_rental ? 'wynajem zewnętrzny' : ''].filter(Boolean).join(' · ');
    // Ta sama pozycja dodana kilka razy (np. z kilku usług oferty) — jedna linia z sumą sztuk.
    const same = equipment.find((entry) => entry.group === group && entry.name === name);
    if (same) {
      same.quantity = Number(same.quantity ?? 0) + Number(row.quantity ?? 0);
      if (notes && !text(same.notes).includes(notes)) same.notes = [text(same.notes), notes].filter(Boolean).join(' · ');
    } else {
      equipment.push({ group, name, quantity: row.quantity ?? null, notes: notes || null });
    }
  }
  equipment.sort((a, b) => text(a.group).localeCompare(text(b.group), 'pl') || a.name.localeCompare(b.name, 'pl'));

  // „Do przygotowania i zamówienia” z kroków realizacji: zamówienia z wyprzedzeniem, sprawdzenia stanu, braki,
  // wynajmy, potwierdzenia z klientem i obiektem, ręczne kroki — z właścicielem, terminem i stanem.
  const stepRows: Json[] = stepsRes.error ? [] : (stepsRes.data ?? []);
  if (stepRows.length) {
    const nowMs = Date.now();
    const prepSteps = stepRows.filter((step) => step.stage === 'preparation');
    preparation.length = 0;
    for (const step of prepSteps) {
      const live = ['open', 'in_progress', 'problem'].includes(text(step.status));
      const quantity = step.quantity != null ? ` — ${String(step.quantity).replace(/\.00$/, '').replace('.', ',')}${text(step.unit) ? ` ${text(step.unit)}` : ''}` : '';
      const supplier = text(step.supplier) ? ` · dostawca: ${text(step.supplier)}` : '';
      const owner = [EVENT_STEP_ROLE_LABELS[step.owner_role as EventStepRole] || '', fullName(step.assignee)].filter(Boolean).join(': ');
      const statusText = [
        EVENT_STEP_STATUS_LABELS[step.status as EventStepStatus] || text(step.status),
        step.expected_at && live ? `dostawa ${formatShort(step.expected_at)}` : '',
        step.status === 'problem' ? text(step.status_note) : '',
      ].filter(Boolean).join(' · ');
      preparation.push({
        label: `${text(step.title)}${quantity}${supplier}`,
        dueDate: text(step.due_at) || null,
        owner,
        status: statusText,
        urgent: live && (step.status === 'problem' || (step.due_at ? new Date(step.due_at).getTime() < nowMs : false)),
      });
    }
    const openBlocking = prepSteps.filter((step) => step.blocks_ready && ['open', 'in_progress', 'problem'].includes(text(step.status)));
    if (openBlocking.length) {
      notices.push(`Niezamknięte kroki przygotowania (${openBlocking.length}): ${openBlocking.slice(0, 4).map((step) => text(step.title)).join('; ')}${openBlocking.length > 4 ? '…' : ''}.`);
    }
    const handoffOpen = stepRows.filter((step) => step.stage === 'handoff' && ['open', 'in_progress', 'problem'].includes(text(step.status)));
    for (const step of handoffOpen) {
      if (step.step_key === 'warehouse_accept') continue; // ten sam komunikat niżej („Magazyn nie przyjął…”).
      if (step.step_key === 'manager_appointed') continue; // komunikat o kierowniku jest wyżej.
      notices.push(`Czekamy na: ${text(step.title)} — ${EVENT_STEP_ROLE_LABELS[step.owner_role as EventStepRole] || 'osoba odpowiedzialna'}${fullName(step.assignee) ? ` (${fullName(step.assignee)})` : ''}.`);
    }
  }

  // Notatki do checklisty sprzętu.
  const checklistNotes = Array.isArray(event.equipment_checklist_note_items)
    ? (event.equipment_checklist_note_items as Json[]).map((item) => text(item?.text ?? item?.content ?? item?.label ?? item)).filter(Boolean)
    : [];

  // Co sprzedano + wymagania produktów z zaakceptowanej oferty (bez cen).
  const soldItems: string[] = [];
  const productRequirements: string[] = [];
  for (const offer of (offersRes.data ?? []) as Json[]) {
    for (const item of [...(offer.items ?? [])].sort((a: Json, b: Json) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0))) {
      const name = text(item.name) || text(item.product?.name);
      if (!name) continue;
      soldItems.push(`${name}${Number(item.quantity) > 1 ? ` × ${item.quantity}${text(item.unit) ? ` ${text(item.unit)}` : ''}` : ''}`);
      const reqs: Json[] = Array.isArray(item.product?.offer_additional_requirements) ? item.product.offer_additional_requirements : [];
      for (const req of reqs) {
        const title = text(req?.title);
        if (title) productRequirements.push(`${name}: ${title}${text(req?.description) ? ` — ${text(req.description)}` : ''}`);
      }
    }
  }

  // Odpowiedzialność magazynu.
  const handoff = handoffRes.data as Json;
  if (handoff?.requested_at && !handoff.accepted_at) {
    notices.push('Magazyn nie przyjął jeszcze realizacji do przygotowania.');
  }
  const warehouseStatus = handoff?.ready_at
    ? `Gotowe — ${text(handoff.ready_by_name) || 'magazyn'}`
    : handoff?.accepted_at
      ? `W przygotowaniu — ${text(handoff.accepted_by_name) || 'magazyn'}`
      : handoff?.requested_at
        ? 'Czeka na przyjęcie przez magazyn'
        : null;

  const guidelines: Array<{ title: string; text: string }> = [];
  if (soldItems.length) guidelines.push({ title: 'Zakres — co zostało sprzedane', text: soldItems.map((line) => `• ${line}`).join('\n') });
  if (text(ws.description)) guidelines.push({ title: 'Opis wydarzenia', text: text(ws.description) });
  if (productRequirements.length) guidelines.push({ title: 'Wymagania usług (do sprawdzenia z klientem i obiektem)', text: productRequirements.map((line) => `• ${line}`).join('\n') });
  const agendaNotes = ((Array.isArray(ws.agenda_notes) ? ws.agenda_notes : []) as Json[]).map((n) => text(n.content)).filter(Boolean);
  if (agendaNotes.length) guidelines.push({ title: 'Uwagi z agendy', text: agendaNotes.map((line) => `• ${line}`).join('\n') });
  if (roomNotes.length) guidelines.push({ title: 'Sale i dostęp', text: roomNotes.join('\n') });
  if (text(location.notes)) guidelines.push({ title: 'Uwagi o obiekcie', text: text(location.notes) });
  if (text(event.equipment_checklist_notes) || checklistNotes.length) {
    guidelines.push({ title: 'Uwagi do sprzętu', text: [text(event.equipment_checklist_notes), ...checklistNotes.map((line) => `• ${line}`)].filter(Boolean).join('\n') });
  }
  for (const task of (Array.isArray(ws.subcontractors) ? ws.subcontractors : []) as Json[]) {
    const body = [text(task.guidelines), text(task.deliverables) ? `Rezultat: ${text(task.deliverables)}` : '', text(task.notes)].filter(Boolean).join('\n');
    if (body) guidelines.push({ title: `Wytyczne dla podwykonawcy: ${companyByTask.get(task.id) || text(task.name)}`, text: body });
  }

  const statusKey = text(ws.status) || '';
  const start = text(ws.event_date) || text(event.event_date) || null;
  const end = text(ws.event_end_date) || text(event.event_end_date) || null;
  const data: EventCardData = {
    companyLogoUrl: null,
    companyName: text(event.company?.name) || null,
    website: text(event.company?.website) || null,
    generatedAt: new Date().toISOString(),
    generatedBy: fullName(generatorRes.data as Json) || null,
    event: {
      name: text(ws.name) || text(event.name) || 'Wydarzenie',
      status: [EVENT_STATUS_LABELS[statusKey] || null, warehouseStatus ? `Magazyn: ${warehouseStatus}` : null, event.loading_confirmed ? 'Załadunek potwierdzony' : null].filter(Boolean).join(' · ') || null,
      category: text(event.category?.name) || null,
      start,
      end,
    },
    manager,
    client: { name: showClientName ? text(event.organization?.name) || text(mainContact?.name) || null : null, contacts: clientContacts },
    venue: {
      name: text(location.name) || null,
      address: [text(location.address), text(location.city) && !text(location.address).includes(text(location.city)) ? text(location.city) : ''].filter(Boolean).join(', ') || null,
      mapUrl: mapUrl || null,
      contacts: venueContacts,
      notes: null,
    },
    schedule,
    team: teamCard,
    vehicles,
    subcontractors,
    equipment,
    preparation,
    guidelines,
    files: ((Array.isArray(ws.files) ? ws.files : []) as Json[]).map((file) => ({ name: text(file.name) })).filter((file) => file.name),
    notices,
  };

  const dateLabel = start ? formatDay(start) : '';
  return {
    data,
    companyId: event.my_company_id ?? null,
    fileName: `Karta_imprezy_${slug(data.event.name)}${start ? `_${formatDay(start).split('.').reverse().join('-')}` : ''}.pdf`,
    dateLabel,
  };
}

function formatDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function formatShort(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}
