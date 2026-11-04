'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Calendar,
  ChevronRight,
  Clock,
  MapPin,
  Package,
  Phone,
  Truck,
  User,
  UserCheck,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { OPERATIONAL_LABELS } from '@/lib/CRM/events/operationalStages';
import {
  EVENT_ACCESS_ROLE_LABELS,
  canViewEventArea,
  type EventAccess,
  type EventAccessRole,
} from '@/lib/events/access/eventAccess';
import WarehouseMessageModal from './WarehouseMessageModal';
import { useEventOnsiteContacts } from './EventOnsiteContacts';
import { telHref } from './steps/stepUi';

type FactKey = 'date' | 'loading' | 'place' | 'manager' | 'warehouse' | 'equipment' | 'vehicles' | 'onsite';

/** Kolejność informacji zależnie od roli osoby w wydarzeniu (najpierw to, czego potrzebuje na stanowisku). */
const ROLE_ORDER: Record<'driver' | 'warehouse' | 'manager' | 'default', FactKey[]> = {
  driver: ['date', 'loading', 'place', 'vehicles', 'onsite', 'manager', 'warehouse', 'equipment'],
  warehouse: ['loading', 'date', 'equipment', 'warehouse', 'vehicles', 'place', 'manager', 'onsite'],
  manager: ['date', 'place', 'onsite', 'loading', 'manager', 'warehouse', 'vehicles', 'equipment'],
  default: ['date', 'place', 'loading', 'manager', 'warehouse', 'equipment', 'vehicles', 'onsite'],
};

const ROLE_DISPLAY_ORDER: EventAccessRole[] = ['admin', 'seller', 'office', 'manager', 'warehouse', 'driver', 'team'];

type Facts = {
  loadingAt: string | null;
  managerName: string | null;
  operationalStatus: string | null;
  handoff: { accepted_at: string | null; accepted_by_name: string | null; ready_at: string | null; ready_by_name: string | null } | null;
  handoffKnown: boolean;
  canContactWarehouse: boolean;
  canPrepareWarehouse: boolean;
  vehicles: { id: string; label: string; driver: string | null }[] | null;
};

const EMPTY_FACTS: Facts = {
  loadingAt: null,
  managerName: null,
  operationalStatus: null,
  handoff: null,
  handoffKnown: false,
  canContactWarehouse: false,
  canPrepareWarehouse: false,
  vehicles: null,
};

const time = (value: Date) => value.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

function formatDateRange(start: string | null | undefined, end: string | null | undefined, schedulePending: boolean): string {
  if (!start) return 'Termin nieustalony';
  const from = new Date(start);
  if (Number.isNaN(from.getTime())) return 'Termin nieustalony';
  const day = from.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  if (schedulePending) return `${day} · godziny do ustalenia`;
  const to = end ? new Date(end) : null;
  if (!to || Number.isNaN(to.getTime())) return `${day}, ${time(from)}`;
  if (to.toDateString() === from.toDateString()) return `${day}, ${time(from)}–${time(to)}`;
  return `${day}, ${time(from)} – ${to.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}, ${time(to)}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'long' })}, ${time(date)}`;
}

function primaryRole(access: EventAccess): keyof typeof ROLE_ORDER {
  if (access.roles.manager) return 'manager';
  if (access.roles.driver) return 'driver';
  if (access.roles.warehouse) return 'warehouse';
  return 'default';
}

/**
 * „Najważniejsze” w Przeglądzie: termin, miejsce, załadunek, kierownik realizacji, magazyn, sprzęt, transport
 * i kontakt na miejscu — w kolejności zależnej od roli. Każda informacja z istniejących reguł dostępu (RLS / RPC);
 * czego baza nie zwróci, tego karta nie pokazuje.
 */
export default function EventKeyFactsCard({
  eventId,
  eventDate,
  eventEndDate,
  schedulePending = false,
  locationName,
  locationAddress,
  mapsUrl,
  equipmentCount,
  access,
  onNavigate,
  canOpenTab,
}: {
  eventId: string;
  eventDate: string | null | undefined;
  eventEndDate?: string | null;
  schedulePending?: boolean;
  locationName?: string | null;
  locationAddress?: string | null;
  mapsUrl?: string | null;
  equipmentCount?: number | null;
  access: EventAccess;
  onNavigate?: (tab: string) => void;
  canOpenTab?: (tab: string) => boolean;
}) {
  const canSeeOnsite = canViewEventArea(access, 'onsite_contact');
  const { contacts } = useEventOnsiteContacts(eventId, canSeeOnsite);
  const [facts, setFacts] = useState<Facts>(EMPTY_FACTS);
  const [messageMode, setMessageMode] = useState<'request' | 'message' | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [phases, realization, handoff, canContact, canPrepare, vehicles] = await Promise.all([
        supabase
          .from('event_phases')
          .select('name, start_time, phase_type:event_phase_types(name)')
          .eq('event_id', eventId)
          .not('start_time', 'is', null)
          .order('start_time', { ascending: true }),
        supabase.rpc('get_event_realization_assignment', { p_event_id: eventId }),
        supabase
          .from('event_warehouse_handoffs')
          .select('accepted_at, accepted_by_name, ready_at, ready_by_name')
          .eq('event_id', eventId)
          .maybeSingle(),
        supabase.rpc('can_contact_event_warehouse', { p_event_id: eventId }),
        supabase.rpc('can_prepare_warehouse_event', { p_event_id: eventId }),
        supabase
          .from('event_vehicles')
          .select(
            'id, status, is_external, external_vehicle_name, external_company_name, vehicle:vehicles!event_vehicles_vehicle_id_fkey(name, registration_number), driver:employees!event_vehicles_driver_id_fkey(name, surname)',
          )
          .eq('event_id', eventId)
          .order('created_at', { ascending: true }),
      ]);
      if (cancelled) return;

      const loadingPhase = (phases.data ?? []).find((phase: any) => {
        const type = Array.isArray(phase.phase_type) ? phase.phase_type[0] : phase.phase_type;
        return /^za.adunek/i.test(String(type?.name || phase.name || '').trim());
      }) as { start_time?: string | null } | undefined;

      const realizationData = (realization.error ? null : realization.data) as
        | { realization?: { manager_name?: string | null } | null; status?: string | null }
        | null;

      const vehicleRows = vehicles.error
        ? null
        : (vehicles.data ?? [])
            .filter((row: any) => (row.status ?? 'planned') !== 'cancelled')
            .map((row: any) => {
              const vehicle = Array.isArray(row.vehicle) ? row.vehicle[0] : row.vehicle;
              const driver = Array.isArray(row.driver) ? row.driver[0] : row.driver;
              const label = row.is_external
                ? [row.external_vehicle_name, row.external_company_name].filter(Boolean).join(' · ') || 'Pojazd zewnętrzny'
                : [vehicle?.name, vehicle?.registration_number].filter(Boolean).join(' · ') || 'Pojazd';
              const driverName = driver ? [driver.name, driver.surname].filter(Boolean).join(' ') : null;
              return { id: String(row.id), label, driver: driverName || null };
            });

      setFacts({
        loadingAt: loadingPhase?.start_time ?? null,
        managerName: realizationData?.realization?.manager_name ?? null,
        operationalStatus: realizationData?.status ?? null,
        handoff: handoff.error ? null : (handoff.data as Facts['handoff']),
        handoffKnown: !handoff.error,
        canContactWarehouse: !canContact.error && canContact.data === true,
        canPrepareWarehouse: !canPrepare.error && canPrepare.data === true,
        vehicles: vehicleRows,
      });
    };
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [eventId]);

  const roles = ROLE_DISPLAY_ORDER.filter(role => access.roles[role]).map(role => EVENT_ACCESS_ROLE_LABELS[role]);
  const order = ROLE_ORDER[primaryRole(access)];
  const primaryContact = contacts.find(contact => contact.is_primary) ?? contacts[0] ?? null;

  const rows = useMemo(() => {
    const items: Partial<Record<FactKey, { icon: LucideIcon; label: string; value: ReactNode; tab?: string }>> = {};
    items.date = { icon: Calendar, label: 'Termin', value: formatDateRange(eventDate, eventEndDate, schedulePending), tab: 'details' };
    if (facts.loadingAt) items.loading = { icon: Clock, label: 'Załadunek', value: formatDateTime(facts.loadingAt), tab: 'phases' };
    items.place = {
      icon: MapPin,
      label: 'Miejsce',
      value: locationName ? (
        <span>
          {mapsUrl ? (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="hover:text-[#d3bb73] hover:underline">
              {locationName}
            </a>
          ) : (
            locationName
          )}
          {locationAddress && <span className="block text-xs text-[#e5e4e2]/50">{locationAddress}</span>}
        </span>
      ) : (
        'Brak lokalizacji'
      ),
      tab: 'details',
    };
    items.manager = {
      icon: UserCheck,
      label: 'Kierownik realizacji',
      value: (
        <span>
          {facts.managerName || 'Nie wyznaczono'}
          {facts.operationalStatus && OPERATIONAL_LABELS[facts.operationalStatus] && (
            <span className="block text-xs text-[#e5e4e2]/50">{OPERATIONAL_LABELS[facts.operationalStatus]}</span>
          )}
        </span>
      ),
      tab: 'team',
    };
    if (facts.handoffKnown) {
      const handoff = facts.handoff;
      const status = handoff?.ready_at
        ? `Gotowe do wydania${handoff.ready_by_name ? ` · ${handoff.ready_by_name}` : ''}`
        : handoff?.accepted_at
          ? `W przygotowaniu · przyjął(a) ${handoff.accepted_by_name || 'magazyn'}`
          : 'Czeka na przyjęcie przez magazyn';
      items.warehouse = {
        icon: Warehouse,
        label: 'Magazyn',
        value: (
          <span>
            {status}
            {facts.canContactWarehouse && !facts.canPrepareWarehouse && (
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                {!handoff?.accepted_at && (
                  <button
                    type="button"
                    onClick={() => setMessageMode('request')}
                    className="rounded-md bg-[#d3bb73]/15 px-2 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/25"
                  >
                    Poproś o przyjęcie
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMessageMode('message')}
                  className="rounded-md bg-white/5 px-2 py-1 text-xs text-[#d3bb73] hover:bg-white/10"
                >
                  Napisz do magazynu
                </button>
              </span>
            )}
          </span>
        ),
        tab: 'equipment',
      };
    }
    if (typeof equipmentCount === 'number') {
      items.equipment = {
        icon: Package,
        label: 'Sprzęt',
        value: equipmentCount ? `${equipmentCount} ${equipmentCount === 1 ? 'pozycja' : equipmentCount % 10 >= 2 && equipmentCount % 10 <= 4 && (equipmentCount % 100 < 12 || equipmentCount % 100 > 14) ? 'pozycje' : 'pozycji'}` : 'Nie przypisano sprzętu',
        tab: 'equipment',
      };
    }
    if (facts.vehicles) {
      items.vehicles = {
        icon: Truck,
        label: 'Transport',
        value: facts.vehicles.length ? (
          <ul className="space-y-0.5">
            {facts.vehicles.map(vehicle => (
              <li key={vehicle.id}>
                {vehicle.label}
                <span className="text-[#e5e4e2]/50"> — {vehicle.driver ? `kierowca: ${vehicle.driver}` : 'bez kierowcy'}</span>
              </li>
            ))}
          </ul>
        ) : (
          'Brak zaplanowanych pojazdów'
        ),
        tab: 'logistics',
      };
    }
    if (canSeeOnsite) {
      const phone = telHref(primaryContact?.phone);
      items.onsite = {
        icon: User,
        label: 'Kontakt na miejscu',
        value: primaryContact ? (
          <span>
            {primaryContact.name}
            {primaryContact.role && <span className="block text-xs text-[#e5e4e2]/50">{primaryContact.role}</span>}
            {phone && (
              <a href={phone} className="mt-1 inline-flex items-center gap-1.5 text-xs text-[#d3bb73] hover:underline">
                <Phone className="h-3.5 w-3.5" aria-hidden />
                {primaryContact.phone}
              </a>
            )}
            {contacts.length > 1 && (
              <span className="block text-xs text-[#e5e4e2]/45">Pozostałe kontakty: {contacts.length - 1} (Szczegóły)</span>
            )}
          </span>
        ) : (
          'Nie podano'
        ),
        tab: 'details',
      };
    }
    return order.flatMap(key => (items[key] ? [{ key, ...items[key]! }] : []));
  }, [
    order,
    facts,
    eventDate,
    eventEndDate,
    schedulePending,
    locationName,
    locationAddress,
    mapsUrl,
    equipmentCount,
    canSeeOnsite,
    primaryContact,
    contacts.length,
  ]);

  return (
    <section aria-labelledby={`key-facts-${eventId}`} className="rounded-xl bg-white/5 p-4 sm:p-5">
      <h3 id={`key-facts-${eventId}`} className="font-medium text-[#e5e4e2]">
        Najważniejsze
      </h3>
      {roles.length > 0 && <p className="mt-0.5 text-xs text-[#e5e4e2]/50">Twoja rola: {roles.join(', ')}</p>}
      <dl className="mt-3 space-y-1">
        {rows.map(row => {
          const Icon = row.icon;
          const openable = Boolean(row.tab && onNavigate && (!canOpenTab || canOpenTab(row.tab)));
          return (
            <div key={row.key} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.03]">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]" aria-hidden />
              <div className="min-w-0 flex-1">
                <dt className="text-xs text-[#e5e4e2]/50">{row.label}</dt>
                <dd className="mt-0.5 break-words text-sm text-[#e5e4e2]">{row.value}</dd>
              </div>
              {openable && (
                <button
                  type="button"
                  onClick={() => onNavigate?.(row.tab!)}
                  aria-label={`Otwórz: ${row.label}`}
                  title="Otwórz zakładkę"
                  className="shrink-0 rounded-md p-1 text-[#e5e4e2]/35 hover:bg-white/5 hover:text-[#d3bb73]"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          );
        })}
      </dl>
      {messageMode && (
        <WarehouseMessageModal eventId={eventId} request={messageMode === 'request'} onClose={() => setMessageMode(null)} />
      )}
    </section>
  );
}
