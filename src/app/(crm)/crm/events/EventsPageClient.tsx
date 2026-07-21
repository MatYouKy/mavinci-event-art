/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Plus,
  Search,
  Calendar,
  MapPin,
  Building2,
  Tag,
  SlidersHorizontal,
  ArrowUpDown,
  Trash2,
  AlertTriangle,
  Grid2x2 as Grid,
  List,
  User,
  Table2,
  AlertCircle,
  PencilLine,
  Copy,
  Loader2,
} from 'lucide-react';
import EventWizard from '@/components/crm/EventWizard';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { Modal } from '@/components/UI/Modal';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';
import { EventStatusBadge } from './UI/EventStatusBadge';
import { ViewMode } from '../settings/page';
import { EventCategoryRow, EventRow } from '@/lib/CRM/events/eventsData.server';
import { IEmployee } from '../employees/type';
import { hasScope } from './[id]/helpers/hasScope';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import { eventStatusLabels } from './[id]/components/tabs/EventsDetailsTab/EventDetailsAction';

const moveKey = (arr: EventsTableColKey[], from: EventsTableColKey, to: EventsTableColKey) => {
  const a = [...arr];
  const fromIdx = a.indexOf(from);
  const toIdx = a.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return a;
  a.splice(fromIdx, 1);
  a.splice(toIdx, 0, from);
  return a;
};

/**
 * ✅ POPRAWKA: jeżeli organizations jest null, a mamy contacts,
 * to pokaż "first_name + last_name" zamiast "Brak klienta".
 * Dodatkowo trimming + fallbacki.
 */
const getContactLabel = (c?: any) => {
  const first = String(c?.first_name ?? '').trim();
  const last = String(c?.last_name ?? '').trim();
  const full = `${first} ${last}`.trim();
  return full.length > 0 ? full : null;
};

const getOrgLabel = (org?: any, contacts?: any) => {
  // firma / organizacja
  const orgLabel = org?.alias || org?.name;
  if (orgLabel) return orgLabel;

  // osoba kontaktowa (np. wesele)
  const contactLabel = getContactLabel(contacts);
  if (contactLabel) return contactLabel;

  return 'Brak klienta';
};

const getLocationLabel = (loc?: any, fallback?: string) => {
  if (!loc) return fallback || 'Brak lokalizacji';
  const city = loc.city ? ` — ${loc.city}` : '';
  return `${loc.name || 'Lokalizacja'}${city}`;
};

const getLocationLabelMobile = (
  locations?: {
    name?: string | null;
  } | null,
  locationFallback?: string | null,
) => {
  if (locations?.name) {
    return locations.name;
  }

  if (typeof locationFallback === 'string' && locationFallback.length > 0) {
    return locationFallback.split(',')[0].trim();
  }

  return 'Brak lokalizacji';
};

const getLocationLabelDesktop = (loc?: any, fallback?: string) => {
  if (!loc) return fallback || 'Brak lokalizacji';
  const extra = loc.city ? ` — ${loc.city}` : '';
  return `${loc.name || 'Lokalizacja'}${extra}`;
};

const getMapsHref = (loc?: any, fallback?: string) => {
  const q = loc?.formatted_address || loc?.address || loc?.name || fallback || '';
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
};

export const statusColors: Record<string, string> = {
  offer_sent: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  offer_accepted: 'bg-green-500/20 text-green-400 border-green-500/30',
  in_preparation: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  in_progress: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  invoiced: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  offer_to_send: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  inquiry: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  cancelled: 'bg-red-500/20 text-red-400 border-red-500/30',
  settled: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  ready_for_live: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
};

const SETTLED_STATUSES = new Set(['settled', 'cancelled']);

type PastUrgency = 'red' | 'orange' | null;
type CopiedFinancialSource = 'calculation' | 'offer' | null;

function getPastUrgency(event: any): PastUrgency {
  if (SETTLED_STATUSES.has(event.status)) return null;
  const eventEndDate = event.event_end_date || event.event_date;
  if (!eventEndDate) return null;
  const end = new Date(eventEndDate);
  end.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (end >= today) return null;
  const daysPast = Math.floor((today.getTime() - end.getTime()) / (1000 * 60 * 60 * 24));
  return daysPast > 7 ? 'red' : 'orange';
}

const stop = (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

type DuplicateLocationOption = {
  id: string;
  name: string;
  city: string | null;
  formatted_address: string | null;
  address: string | null;
};

type DuplicateOrganizationOption = {
  id: string;
  name: string;
  alias: string | null;
};

type DuplicateContactOption = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

type DuplicateClientSelection =
  | {
      type: 'business';
      id: string;
    }
  | {
      type: 'individual';
      id: string;
    }
  | null;

type SortField = 'event_date' | 'name' | 'budget' | 'created_at';
type SortDirection = 'asc' | 'desc';

type EventsTableColKey =
  | 'name'
  | 'client'
  | 'date'
  | 'location'
  | 'status'
  | 'category'
  | 'budget'
  | 'actions';

const DEFAULT_EVENTS_COL_WIDTHS: Record<EventsTableColKey, number> = {
  name: 400,
  client: 180,
  date: 110,
  location: 220,
  status: 140,
  category: 130,
  budget: 110,
  actions: 150,
};

const DEFAULT_COL_ORDER: EventsTableColKey[] = [
  'name',
  'client',
  'date',
  'location',
  'status',
  'category',
  'budget',
  'actions',
];

function ResizableTh({
  label,
  width,
  min = 120,
  max = 900,
  align = 'left',
  draggable = false,
  sortable = false,
  sortField,
  currentSortField,
  sortDirection,
  onSort,
  onDragStart,
  onDragOver,
  onDrop,
  onResize,
  onResizeEnd,
}: {
  label: React.ReactNode;
  width: number;
  min?: number;
  max?: number;
  align?: 'left' | 'right' | 'center';

  // drag reorder
  draggable?: boolean;
  onDragStart?: React.DragEventHandler<HTMLTableCellElement>;
  onDragOver?: React.DragEventHandler<HTMLTableCellElement>;
  onDrop?: React.DragEventHandler<HTMLTableCellElement>;

  // sort
  sortable?: boolean;
  sortField?: SortField;
  currentSortField?: SortField;
  sortDirection?: SortDirection;
  onSort?: (field: SortField) => void;

  // resize
  onResize: (nextWidth: number) => void; // ✅ live
  onResizeEnd: (nextWidth: number) => void; // ✅ persist
}) {
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);

  const isSorted = sortable && sortField === currentSortField;

  return (
    <th
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="relative select-none border-b border-[#d3bb73]/10 bg-[#0f1117] px-3 py-3 text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/60"
      style={{
        width,
        minWidth: width,
        maxWidth: width,
        textAlign: align,
      }}
    >
      <div
        className={`flex items-center gap-2 truncate pr-3 ${sortable ? 'cursor-pointer hover:text-[#d3bb73]' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (sortable && sortField && onSort) {
            onSort(sortField);
          }
        }}
      >
        <span className="truncate">{label}</span>
        {sortable && isSorted && (
          <ArrowUpDown
            className={`h-3 w-3 flex-shrink-0 transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`}
          />
        )}
      </div>

      {/* uchwyt do resize */}
      <div
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-[#d3bb73]/10"
        title="Zmień szerokość kolumny"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();

          draggingRef.current = true;
          startXRef.current = e.clientX;
          startWRef.current = width;

          const onMove = (ev: MouseEvent) => {
            if (!draggingRef.current) return;
            const delta = ev.clientX - startXRef.current;
            const next = Math.min(max, Math.max(min, startWRef.current + delta));
            onResize(next); // ✅ LIVE
          };

          const onUp = (ev: MouseEvent) => {
            if (!draggingRef.current) return;
            draggingRef.current = false;

            const delta = ev.clientX - startXRef.current;
            const next = Math.min(max, Math.max(min, startWRef.current + delta));

            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);

            onResize(next); // domknij live
            onResizeEnd(next); // ✅ PERSIST
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }}
      />
    </th>
  );
}

export default function EventsPageClient({
  initialData,
  currentEmployee,
}: {
  initialData: { events: EventRow[]; viewMode: ViewMode; categories: EventCategoryRow[] };
  currentEmployee: IEmployee;
}) {
  const isUserAdmin =
    currentEmployee.role === 'admin' || currentEmployee.permissions?.includes('events_manage');

  const { events: initialEvents, categories, viewMode: initialViewMode } = initialData;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const { setViewMode, getModulePrefs, setModulePrefs } = useUserPreferences() as any;
  const [events, setEvents] = useState<any[]>(initialEvents);
  const [filteredEvents, setFilteredEvents] = useState<any[]>([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('event_date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [showPastEvents, setShowPastEvents] = useState<boolean>(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<any>(null);

  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [eventToChangeStatus, setEventToChangeStatus] = useState<any>(null);
  const [draftStatus, setDraftStatus] = useState<string>('inquiry');
  const [savingStatus, setSavingStatus] = useState(false);

  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [eventToDuplicate, setEventToDuplicate] = useState<any>(null);
  const [duplicatingEvent, setDuplicatingEvent] = useState(false);

  const [changeDuplicateDate, setChangeDuplicateDate] = useState(false);
  const [changeDuplicateLocation, setChangeDuplicateLocation] = useState(false);
  const [changeDuplicateClient, setChangeDuplicateClient] = useState(false);

  const [duplicateStartDate, setDuplicateStartDate] = useState('');
  const [duplicateEndDate, setDuplicateEndDate] = useState('');

  const [duplicateLocationId, setDuplicateLocationId] = useState('');
  const [duplicateClient, setDuplicateClient] = useState<DuplicateClientSelection>(null);

  const [duplicateLocations, setDuplicateLocations] = useState<DuplicateLocationOption[]>([]);

  const [duplicateOrganizations, setDuplicateOrganizations] = useState<
    DuplicateOrganizationOption[]
  >([]);

  const [duplicateContacts, setDuplicateContacts] = useState<DuplicateContactOption[]>([]);

  const [loadingDuplicateOptions, setLoadingDuplicateOptions] = useState(false);

  const [openingEvent, setOpeningEvent] = useState(false);
  const [openingEventName, setOpeningEventName] = useState('');

  const [viewMode, setLocalViewMode] = useState<ViewMode>(initialViewMode as ViewMode);

  const modulePrefs = (getModulePrefs?.('events') ?? {}) as any;
  const [colOrder, setColOrder] = useState<EventsTableColKey[]>(() => {
    const prefOrder = modulePrefs?.table?.colOrder as EventsTableColKey[] | undefined;
    const base = prefOrder?.length ? prefOrder : DEFAULT_COL_ORDER;

    // jeśli user nie ma prawa do budżetu – usuń budget z order
    return isUserAdmin ? base : base.filter((k) => k !== 'budget');
  });

  const canViewEventStatus = isUserAdmin || hasScope('events_manage', currentEmployee);
  const canDeleteEvents =
    isUserAdmin ||
    hasScope('events_manage', currentEmployee) ||
    currentEmployee.permissions?.includes('admin') ||
    currentEmployee.permissions?.includes('events_manage');

  const canViewEventBudget =
    isUserAdmin ||
    hasScope('finances_manage', currentEmployee) ||
    hasScope('finances_view', currentEmployee) ||
    hasScope('offers_manage', currentEmployee) ||
    hasScope('offers_view', currentEmployee) ||
    hasScope('invoices_manage', currentEmployee) ||
    hasScope('invoices_view', currentEmployee);

  const canAddNewEvent =
    isUserAdmin ||
    hasScope('events_manage', currentEmployee) ||
    currentEmployee.role === 'admin' ||
    currentEmployee.permissions?.includes('events_create');
  // ---- Table widths from prefs (fallback to defaults)

  const [colWidths, setColWidths] = useState<Record<EventsTableColKey, number>>(() => ({
    ...DEFAULT_EVENTS_COL_WIDTHS,
    ...(modulePrefs?.table?.colWidths ?? {}),
  }));
  const persistColWidths = async (key: EventsTableColKey, w: number) => {
    const next = { ...colWidths, [key]: w };
    setColWidths(next);

    await setModulePrefs?.('events', {
      table: {
        ...(modulePrefs?.table ?? {}),
        colWidths: next,
        colOrder: modulePrefs?.table?.colOrder, // nie zgub kolejności
      },
    });
  };
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const persistColOrder = async (next: EventsTableColKey[]) => {
    const sanitized = next.filter((k) => {
      if (k === 'budget' && !canViewEventBudget) return false;
      if (k === 'status' && !canViewEventStatus) return false;
      if (k === 'actions' && !canViewEventStatus) return false;
      return true;
    });

    setColOrder(sanitized);

    await setModulePrefs?.('events', {
      table: {
        ...(modulePrefs?.table ?? {}),
        colOrder: sanitized,
        colWidths,
      },
    });
  };

  const handleDuplicateClick = async (e: React.MouseEvent | null, event: any) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (duplicatingEvent) return;

    resetDuplicateOptions();

    setEventToDuplicate(event);

    setDuplicateStartDate(event.event_date ?? '');
    setDuplicateEndDate(event.event_end_date ?? event.event_date ?? '');

    setDuplicateLocationId(event.location_id ?? '');

    if (event.organization_id) {
      setDuplicateClient({
        type: 'business',
        id: event.organization_id,
      });
    } else if (event.contact_person_id) {
      setDuplicateClient({
        type: 'individual',
        id: event.contact_person_id,
      });
    }

    setDuplicateModalOpen(true);

    await fetchDuplicateOptions();
  };

  const copyAcceptedCalculation = async (
    sourceEventId: string,
    targetEventId: string,
  ): Promise<boolean> => {
    const { data: sourceCalculation, error: calculationError } = await supabase
      .from('event_calculations')
      .select('*')
      .eq('event_id', sourceEventId)
      .eq('is_accepted', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (calculationError) {
      throw calculationError;
    }

    if (!sourceCalculation) {
      return false;
    }

    const { data: sourceItems, error: itemsError } = await supabase
      .from('event_calculation_items')
      .select('*')
      .eq('calculation_id', sourceCalculation.id)
      .order('position', { ascending: true });

    if (itemsError) {
      throw itemsError;
    }

    const {
      id: _sourceCalculationId,
      event_id: _sourceCalculationEventId,
      created_at: _sourceCalculationCreatedAt,
      updated_at: _sourceCalculationUpdatedAt,
      generated_pdf_path: _sourceCalculationPdf,
      ...calculationData
    } = sourceCalculation;

    const { data: newCalculation, error: insertCalculationError } = await supabase
      .from('event_calculations')
      .insert({
        ...calculationData,
        event_id: targetEventId,
        is_accepted: true,
        generated_pdf_path: null,
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertCalculationError) {
      throw insertCalculationError;
    }

    if (sourceItems?.length) {
      const itemsPayload = sourceItems.map((item: any, index: number) => {
        const {
          id: _sourceItemId,
          calculation_id: _sourceCalculationId,
          created_at: _sourceItemCreatedAt,
          updated_at: _sourceItemUpdatedAt,
          ...itemData
        } = item;

        return {
          ...itemData,
          calculation_id: newCalculation.id,
          position: item.position ?? index,
        };
      });

      const { error: insertItemsError } = await supabase
        .from('event_calculation_items')
        .insert(itemsPayload);

      if (insertItemsError) {
        throw insertItemsError;
      }
    }

    return true;
  };

  const copyAcceptedOffer = async (
    sourceEventId: string,
    targetEventId: string,
  ): Promise<boolean> => {
    const { data: sourceOffer, error: offerError } = await supabase
      .from('offers')
      .select('*')
      .eq('event_id', sourceEventId)
      .eq('status', 'accepted')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (offerError) {
      throw offerError;
    }

    if (!sourceOffer) {
      return false;
    }

    const { data: sourceOfferItems, error: offerItemsError } = await supabase
      .from('offer_items')
      .select('*')
      .eq('offer_id', sourceOffer.id)
      .order('position', { ascending: true });

    if (offerItemsError) {
      throw offerItemsError;
    }

    const {
      id: _sourceOfferId,
      event_id: _sourceOfferEventId,
      created_at: _sourceOfferCreatedAt,
      updated_at: _sourceOfferUpdatedAt,
      offer_number: _sourceOfferNumber,
      generated_pdf_path: _sourceOfferPdf,
      ...offerData
    } = sourceOffer;

    const { data: newOffer, error: insertOfferError } = await supabase
      .from('offers')
      .insert({
        ...offerData,
        event_id: targetEventId,
        status: 'accepted',
        generated_pdf_path: null,
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertOfferError) {
      throw insertOfferError;
    }

    if (sourceOfferItems?.length) {
      const offerItemsPayload = sourceOfferItems.map((item: any, index: number) => {
        const {
          id: _sourceItemId,
          offer_id: _sourceOfferId,
          created_at: _sourceItemCreatedAt,
          updated_at: _sourceItemUpdatedAt,
          ...itemData
        } = item;

        return {
          ...itemData,
          offer_id: newOffer.id,
          position: item.position ?? index,
        };
      });

      const { error: insertOfferItemsError } = await supabase
        .from('offer_items')
        .insert(offerItemsPayload);

      if (insertOfferItemsError) {
        throw insertOfferItemsError;
      }
    }

    return true;
  };

  const copyEventFinancialSource = async (
    sourceEventId: string,
    targetEventId: string,
  ): Promise<CopiedFinancialSource> => {
    /*
     * Zaakceptowana kalkulacja ma pierwszeństwo.
     * Jeżeli istnieje, nie kopiujemy oferty.
     */
    const calculationCopied = await copyAcceptedCalculation(sourceEventId, targetEventId);

    if (calculationCopied) {
      return 'calculation';
    }

    /*
     * Zaakceptowana oferta jest kopiowana tylko wtedy,
     * gdy wydarzenie nie ma zaakceptowanej kalkulacji.
     */
    const offerCopied = await copyAcceptedOffer(sourceEventId, targetEventId);

    if (offerCopied) {
      return 'offer';
    }

    return null;
  };

  const resetDuplicateOptions = () => {
    setChangeDuplicateDate(false);
    setChangeDuplicateLocation(false);
    setChangeDuplicateClient(false);

    setDuplicateStartDate('');
    setDuplicateEndDate('');

    setDuplicateLocationId('');
    setDuplicateClient(null);
  };

  const fetchDuplicateOptions = async () => {
    try {
      setLoadingDuplicateOptions(true);

      const [locationsResult, organizationsResult, contactsResult] = await Promise.all([
        supabase
          .from('locations')
          .select('id, name, city, formatted_address, address')
          .order('name', { ascending: true }),

        supabase.from('organizations').select('id, name, alias').order('name', { ascending: true }),

        supabase
          .from('contacts')
          .select('id, first_name, last_name, email')
          .order('last_name', { ascending: true }),
      ]);

      if (locationsResult.error) {
        throw locationsResult.error;
      }

      if (organizationsResult.error) {
        throw organizationsResult.error;
      }

      if (contactsResult.error) {
        throw contactsResult.error;
      }

      setDuplicateLocations(locationsResult.data ?? []);
      setDuplicateOrganizations(organizationsResult.data ?? []);
      setDuplicateContacts(contactsResult.data ?? []);
    } catch (error) {
      console.error('Error loading duplicate options:', error);
      showSnackbar('Nie udało się pobrać listy miejsc lub klientów', 'error');
    } finally {
      setLoadingDuplicateOptions(false);
    }
  };

  const handleDuplicateConfirm = async () => {
    if (!eventToDuplicate?.id || duplicatingEvent) return;

    let duplicatedEventId: string | null = null;

    try {
      setDuplicatingEvent(true);

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session?.user?.id) {
        throw new Error('Brak aktywnej sesji użytkownika');
      }

      /*
       * Pobieramy cały rekord bezpośrednio z tabeli events.
       * Obiekt wyświetlany na liście może nie zawierać wszystkich ID relacji.
       */
      const { data: sourceEvent, error: sourceEventError } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventToDuplicate.id)
        .single();

      if (sourceEventError) {
        throw sourceEventError;
      }

      if (!sourceEvent) {
        throw new Error('Nie znaleziono wydarzenia do zduplikowania');
      }
      if (changeDuplicateDate && !duplicateStartDate) {
        showSnackbar('Wybierz datę rozpoczęcia wydarzenia', 'error');
        return;
      }

      if (changeDuplicateLocation && !duplicateLocationId) {
        showSnackbar('Wybierz nowe miejsce wydarzenia', 'error');
        return;
      }

      if (changeDuplicateClient && !duplicateClient) {
        showSnackbar('Wybierz nowego klienta', 'error');
        return;
      }

      const duplicatedEvent = {
        name: `${sourceEvent.name} (kopia)`,

        description: sourceEvent.description ?? null,
        notes: sourceEvent.notes ?? null,

        event_date: changeDuplicateDate ? duplicateStartDate : sourceEvent.event_date,

        event_end_date: changeDuplicateDate
          ? duplicateEndDate || duplicateStartDate
          : (sourceEvent.event_end_date ?? null),

        /*
         * Lokalizacja tekstowa oraz właściwe ID lokalizacji.
         */
        location_id: changeDuplicateLocation
          ? duplicateLocationId || null
          : (sourceEvent.location_id ?? null),

        location: changeDuplicateLocation ? null : (sourceEvent.location ?? null),

        /*
         * Kategoria wydarzenia.
         */
        category_id: sourceEvent.category_id ?? null,

        /*
         * Klient firmowy lub indywidualny oraz osoba kontaktowa.
         */
        organization_id: changeDuplicateClient
          ? duplicateClient?.type === 'business'
            ? duplicateClient.id
            : null
          : (sourceEvent.organization_id ?? null),

        contact_person_id: changeDuplicateClient
          ? duplicateClient?.type === 'individual'
            ? duplicateClient.id
            : null
          : (sourceEvent.contact_person_id ?? null),

        client_type: changeDuplicateClient
          ? (duplicateClient?.type ?? sourceEvent.client_type ?? 'business')
          : (sourceEvent.client_type ?? 'business'),

        /*
         * Firma wystawiająca dokumenty.
         */
        my_company_id: sourceEvent.my_company_id ?? null,

        /*
         * Dane finansowe zapisane bezpośrednio w events.
         * Właściwe źródło finansowe zostanie skopiowane niżej.
         */
        expected_revenue: Number(sourceEvent.expected_revenue ?? 0),
        estimated_costs: Number(sourceEvent.estimated_costs ?? 0),
        budget: sourceEvent.budget ?? null,

        /*
         * Kopia zawsze zaczyna jako nowe zapytanie.
         */
        status: 'inquiry',

        created_by: session.user.id,
        updated_at: new Date().toISOString(),
      };

      const { data: duplicated, error: duplicateError } = await supabase
        .from('events')
        .insert(duplicatedEvent)
        .select('id, name')
        .single();

      if (duplicateError) {
        throw duplicateError;
      }

      duplicatedEventId = duplicated.id;

      /*
       * Kopiujemy dokładnie jedno źródło finansowe:
       *
       * 1. zaakceptowaną kalkulację,
       * 2. albo zaakceptowaną ofertę, gdy kalkulacji nie ma.
       */
      const copiedFinancialSource = await copyEventFinancialSource(sourceEvent.id, duplicated.id);

      /*
       * Jeżeli twórca oryginalnego wydarzenia był przypisany jako pracownik,
       * nowy event nie dziedziczy całego zespołu. Dodajemy jedynie osobę
       * wykonującą duplikowanie jako autora/koordynatora.
       */
      const { error: assignmentError } = await supabase.from('employee_assignments').insert({
        event_id: duplicated.id,
        employee_id: session.user.id,
        role: 'Autor/Koordynator',
      });

      if (assignmentError) {
        console.warn(
          'Nie udało się przypisać użytkownika do zduplikowanego wydarzenia:',
          assignmentError,
        );
      }

      let successMessage = 'Wydarzenie zostało zduplikowane.';

      if (copiedFinancialSource === 'calculation') {
        successMessage += ' Skopiowano zaakceptowaną kalkulację wraz z pozycjami.';
      } else if (copiedFinancialSource === 'offer') {
        successMessage += ' Skopiowano zaakceptowaną ofertę wraz z pozycjami.';
      } else {
        successMessage += ' Oryginalne wydarzenie nie miało zaakceptowanej kalkulacji ani oferty.';
      }

      showSnackbar(successMessage, 'success');

      setDuplicateModalOpen(false);
      setEventToDuplicate(null);

      await fetchEvents();

      router.push(`/crm/events/${duplicated.id}`);
    } catch (err: any) {
      console.error('Error duplicating event:', err);

      /*
       * Jeżeli event został już utworzony, ale kopiowanie kalkulacji
       * lub oferty się nie udało, usuwamy niepełną kopię.
       */
      if (duplicatedEventId) {
        const { error: rollbackError } = await supabase
          .from('events')
          .delete()
          .eq('id', duplicatedEventId);

        if (rollbackError) {
          console.error('Nie udało się usunąć niepełnej kopii eventu:', rollbackError);
        }
      }

      showSnackbar(err?.message || 'Wystąpił błąd podczas duplikowania wydarzenia', 'error');
    } finally {
      setDuplicatingEvent(false);
    }
  };

  const canViewCommercials =
    isUserAdmin ||
    hasScope('finances_manage', currentEmployee) ||
    hasScope('finances_view', currentEmployee) ||
    hasScope('offers_manage', currentEmployee) ||
    hasScope('offers_view', currentEmployee) ||
    hasScope('invoices_manage', currentEmployee) ||
    hasScope('invoices_view', currentEmployee);

  const handleViewModeChange = async (mode: ViewMode) => {
    setLocalViewMode(mode);
    await setViewMode('events', mode);
  };

  const dragKeyRef = useRef<EventsTableColKey | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel('events-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events',
        },
        () => {
          fetchEvents();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleOpenEvent = (event: any) => {
    setOpeningEventName(event?.name || '');
    setOpeningEvent(true);

    router.push(`/crm/events/${event.id}`);
  };

  useEffect(() => {
    applyFiltersAndSort();
  }, [events, searchQuery, statusFilter, categoryFilter, sortField, sortDirection, showPastEvents]);

  const fetchEvents = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        setEvents([]);
        return;
      }

      const currentUserId = session.user.id;

      const { data: employee } = await supabase
        .from('employees')
        .select('permissions, role')
        .eq('id', currentUserId)
        .maybeSingle();

      const isAdmin =
        employee?.role === 'admin' || employee?.permissions?.includes('events_manage');

      let query = supabase.from('events').select(
        `
          *,
          organizations(name, alias),
          contacts(first_name, last_name),
          event_categories(name, color),
          locations(name, formatted_address, address, city, postal_code)
        `,
      );

      if (!isAdmin) {
        const { data: assignedEvents } = await supabase
          .from('employee_assignments')
          .select('event_id')
          .eq('employee_id', currentUserId);

        const eventIds = assignedEvents?.map((a) => a.event_id) || [];

        const { data: createdEvents } = await supabase
          .from('events')
          .select('id')
          .eq('created_by', currentUserId);

        const createdEventIds = createdEvents?.map((e) => e.id) || [];
        const allEventIds = Array.from(new Set([...eventIds, ...createdEventIds])) as string[];

        if (allEventIds.length === 0) {
          setEvents([]);
          return;
        }

        query = query.in('id', allEventIds);
      }

      const { data, error } = await query.order('event_date', { ascending: true });

      if (error) {
        console.error('Error fetching events:', error);
        return;
      }

      if (data) {
        setEvents(data);
        return;
      }
    } catch (err) {
      console.error('Error:', err);
    }

    setEvents([]);
  };

  const handleDeleteClick = (e: React.MouseEvent | null, event: any) => {
    if (e) e.stopPropagation();
    setEventToDelete(event);
    setDeleteModalOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!eventToDelete) return;

    try {
      const { data, error, status, statusText } = await supabase
        .from('events')
        .delete()
        .eq('id', eventToDelete.id)
        .select('id, name');
      if (error) throw error;

      if (!data || data.length === 0) {
        showSnackbar('Nie masz uprawnień do usunięcia tego eventu lub event nie istnieje', 'error');
        return;
      }

      showSnackbar('Event został usunięty', 'success');
      setDeleteModalOpen(false);
      setEventToDelete(null);
      fetchEvents();
    } catch (err: any) {
      console.error('Error deleting event:', err);
      showSnackbar(err.message || 'Błąd podczas usuwania eventu', 'error');
    }
  };

  const applyFiltersAndSort = () => {
    let result = [...events];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (event) =>
          event.name?.toLowerCase().includes(query) ||
          event.location?.toLowerCase().includes(query) ||
          event.locations?.name?.toLowerCase().includes(query) ||
          event.locations?.address?.toLowerCase().includes(query) ||
          event.locations?.city?.toLowerCase().includes(query) ||
          event.organizations?.name?.toLowerCase().includes(query) ||
          event.description?.toLowerCase().includes(query),
      );
    }

    if (statusFilter !== 'all') {
      result = result.filter((event) => event.status === statusFilter);
    }

    if (categoryFilter !== 'all') {
      result = result.filter((event) => event.category_id === categoryFilter);
    }

    if (!showPastEvents) {
      result = result.filter((event) => {
        const endDate = new Date(event.event_end_date || event.event_date);
        endDate.setHours(0, 0, 0, 0);
        if (endDate >= today) return true;
        return !SETTLED_STATUSES.has(event.status);
      });
    }

    result.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (sortField === 'event_date' || sortField === 'created_at') {
        aVal = new Date(aVal || 0).getTime();
        bVal = new Date(bVal || 0).getTime();
      }

      if (sortField === 'budget') {
        aVal = Number(aVal || 0);
        bVal = Number(bVal || 0);
      }

      if (sortField === 'name') {
        aVal = String(aVal || '').toLowerCase();
        bVal = String(bVal || '').toLowerCase();
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    setFilteredEvents(result);
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleStatusClick = (e: React.MouseEvent | null, event: any) => {
    if (e) e.stopPropagation();

    setEventToChangeStatus(event);
    setDraftStatus(event.status || 'inquiry');
    setStatusModalOpen(true);
  };

  const handleStatusConfirm = async () => {
    if (!eventToChangeStatus?.id) return;

    try {
      setSavingStatus(true);

      const { error } = await supabase
        .from('events')
        .update({
          status: draftStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', eventToChangeStatus.id);

      if (error) throw error;

      showSnackbar('Status wydarzenia został zmieniony', 'success');
      setStatusModalOpen(false);
      setEventToChangeStatus(null);
      await fetchEvents();
    } catch (err: any) {
      console.error('Error updating event status:', err);
      showSnackbar(err.message || 'Błąd podczas zmiany statusu', 'error');
    } finally {
      setSavingStatus(false);
    }
  };

  const handleSaveEvent = async (eventData: any) => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const { data, error } = await supabase
        .from('events')
        .insert([
          {
            name: eventData.name,
            client_id:
              eventData.client_id && eventData.client_id.trim() !== '' ? eventData.client_id : null,
            category_id:
              eventData.category_id && eventData.category_id.trim() !== ''
                ? eventData.category_id
                : null,
            event_date: eventData.event_date,
            event_end_date: eventData.event_end_date || null,
            location: eventData.location,
            budget: eventData.budget ? parseFloat(eventData.budget) : null,
            description: eventData.description || null,
            status: eventData.status,
            attachments: eventData.attachments || [],
            created_by: session?.user?.id || null,
          },
        ])
        .select();

      if (error) {
        console.error('Error saving event:', error);
        showSnackbar('Błąd podczas zapisywania eventu: ' + error.message, 'error');
        return;
      }

      if (data && data[0] && session?.user?.id) {
        const { error: assignmentError } = await supabase.from('employee_assignments').insert([
          {
            event_id: data[0].id,
            employee_id: session.user.id,
            role: 'Autor/Koordynator',
          },
        ]);

        if (assignmentError) {
          console.error('Error adding creator to team:', assignmentError);
        }
      }
      showSnackbar('Event zapisany pomyślnie!', 'success');
      setIsModalOpen(false);
      await fetchEvents();
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd podczas zapisywania eventu', 'error');
    }
  };

  useEffect(() => {
    const error = searchParams.get('error');
    const info = searchParams.get('info');
    const eventName = searchParams.get('event');

    if (error === 'invalid_token') {
      showSnackbar('Nieprawidłowy lub nieważny token zaproszenia', 'error');
      router.replace('/crm/events');
    } else if (error === 'token_expired') {
      showSnackbar(
        'Token zaproszenia wygasł. Zaloguj się do systemu aby potwierdzić udział.',
        'error',
      );
      router.replace('/crm/events');
    } else if (info === 'invitation_rejected') {
      showSnackbar(`Zaproszenie do wydarzenia "${eventName}" zostało odrzucone`, 'info');
      router.replace('/crm/events');
    } else if (error === 'update_failed') {
      showSnackbar('Nie udało się zaktualizować statusu zaproszenia', 'error');
      router.replace('/crm/events');
    }
  }, [searchParams, router, showSnackbar]);

  const renderCell: Record<EventsTableColKey, (event: any) => React.ReactNode> = {
    name: (event) => (
      <>
        <div className="truncate font-medium">{event.name}</div>
        <div className="mt-0.5 truncate text-xs text-[#e5e4e2]/40">
          {event.created_at
            ? `Utworzono: ${new Date(event.created_at).toLocaleDateString('pl-PL')}`
            : 'Utworzono: —'}
        </div>
      </>
    ),

    client: (event) => {
      const clientLabel = getOrgLabel(event.organizations, event.contacts);
      const isContactClient = !event.organizations && !!getContactLabel(event.contacts);

      return (
        <div className="flex min-w-0 items-center gap-2">
          {isContactClient ? (
            <User className="h-4 w-4 flex-shrink-0 text-[#e5e4e2]/50" />
          ) : (
            <Building2 className="h-4 w-4 flex-shrink-0 text-[#e5e4e2]/50" />
          )}
          <span className="truncate">{clientLabel}</span>
        </div>
      );
    },

    date: (event) =>
      event.event_date ? new Date(event.event_date).toLocaleDateString('pl-PL') : '—',

    location: (event) => (
      <a
        href={getMapsHref(event.locations, event.location) ?? undefined}
        target="_blank"
        rel="noreferrer"
        onClick={stop}
        className="block truncate text-[#e5e4e2]/70 hover:text-[#d3bb73]"
        title="Otwórz w mapach"
      >
        {getLocationLabelDesktop(event.locations, event.location)}
      </a>
    ),

    status: (event) => <EventStatusBadge status={event.status} />,

    category: (event) => (
      <span className="block truncate">{event.event_categories?.name ?? '—'}</span>
    ),

    budget: (event) => (
      <span className="font-medium text-[#d3bb73]">
        {event.expected_revenue ? event.expected_revenue.toLocaleString() : '0'} zł
      </span>
    ),

    actions: (event) =>
      canAddNewEvent || canViewEventStatus || canDeleteEvents ? (
        <ResponsiveActionBar
          disabledBackground
          mobileBreakpoint={2000}
          actions={[
            ...(canAddNewEvent
              ? [
                  {
                    label: 'Duplikuj',
                    onClick: () => handleDuplicateClick(null, event),
                    icon: <Copy className="h-4 w-4" />,
                    variant: 'default' as const,
                    disabled: duplicatingEvent,
                  },
                ]
              : []),

            ...(canViewEventStatus
              ? [
                  {
                    label: 'Zmień status',
                    onClick: () => handleStatusClick(null, event),
                    icon: <PencilLine className="h-4 w-4" />,
                    variant: 'default' as const,
                  },
                ]
              : []),

            ...(canDeleteEvents
              ? [
                  {
                    label: 'Usuń',
                    onClick: () => handleDeleteClick(null, event),
                    icon: <Trash2 className="h-4 w-4" />,
                    variant: 'danger' as const,
                  },
                ]
              : []),
          ]}
        />
      ) : null,
  };

  const actions = useMemo<Action[]>(() => {
    const arr: Action[] = [];

    if (canViewEventStatus) {
      arr.push({
        label: 'Kategorie',
        onClick: () => router.push('/crm/event-categories'),
        icon: <Tag className="h-4 w-4" />,
        variant: 'default',
        show: true,
      });
    }

    if (canAddNewEvent) {
      arr.push({
        label: 'Nowy event',
        onClick: () => setIsModalOpen(true),
        icon: <Plus className="h-4 w-4" />,
        variant: 'primary',
        show: true,
      });
    }

    return arr;
  }, [router, canViewEventStatus, canAddNewEvent]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="mt-3 text-2xl font-light text-[#e5e4e2]">Eventy</h2>
        <div className="mt-3 flex items-center gap-3">
          <ResponsiveActionBar actions={actions} />
        </div>
      </div>

      {/* Filtry i sortowanie */}
      <div className="space-y-4 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-2 md:p-4">
        {/* MOBILE toolbar */}
        <div className="flex items-center justify-between gap-2 md:hidden">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMobileSearch(true)}
              className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1117] p-2 text-[#e5e4e2]/70 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
              title="Szukaj"
            >
              <Search className="h-4 w-4" />
            </button>

            <button
              onClick={() => setShowMobileFilters(true)}
              className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1117] p-2 text-[#e5e4e2]/70 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
              title="Filtry"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>

            <button
              onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
              className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1117] p-2 text-[#e5e4e2]/70 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
              title={sortDirection === 'asc' ? 'Rosnąco' : 'Malejąco'}
            >
              <ArrowUpDown
                className={`h-4 w-4 transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`}
              />
            </button>

            <button
              onClick={() => setShowPastEvents(!showPastEvents)}
              className={`rounded-lg border border-[#d3bb73]/10 p-2 transition-colors ${
                showPastEvents
                  ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                  : 'bg-[#0f1117] text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]'
              }`}
              title={showPastEvents ? 'Ukryj rozliczone' : 'Pokaż rozliczone'}
            >
              <Calendar className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleViewModeChange('list')}
              className={`rounded-lg p-2 transition-colors ${
                viewMode === 'list'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0f1117] text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
              title="Widok listy"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleViewModeChange('grid')}
              className={`rounded-lg p-2 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0f1117] text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
              title="Widok siatki"
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleViewModeChange('table')}
              className={`rounded-lg p-2 transition-colors ${
                viewMode === 'table'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0f1117] text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
              title="Widok tabeli"
            >
              <Table2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* MOBILE summary */}
        <div className="flex items-center justify-between text-xs text-[#e5e4e2]/50 md:hidden">
          <div>
            Znaleziono: <span className="font-medium text-[#d3bb73]">{filteredEvents.length}</span>{' '}
            / {events.length}
          </div>
          {!showPastEvents &&
            (() => {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const settledPastCount = events.filter((event) => {
                const endDate = new Date(event.event_end_date || event.event_date);
                endDate.setHours(0, 0, 0, 0);
                return endDate < today && SETTLED_STATUSES.has(event.status);
              }).length;
              return settledPastCount > 0 ? (
                <span className="text-[#e5e4e2]/40">(ukryto {settledPastCount} rozliczonych)</span>
              ) : null;
            })()}
        </div>

        {/* DESKTOP content */}
        <div className="hidden flex-wrap items-center gap-4 md:flex">
          <div className="min-w-[250px] flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/50" />
              <input
                type="text"
                placeholder="Szukaj po nazwie, lokalizacji, kliencie..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] py-2 pl-10 pr-4 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
              />
            </div>
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
          >
            <option value="all">Wszystkie statusy</option>
            <option value="settled">Rozliczony</option>
            <option value="offer_sent">Oferta wysłana</option>
            <option value="offer_accepted">Zaakceptowana</option>
            <option value="in_preparation">Przygotowanie</option>
            <option value="in_progress">W trakcie</option>
            <option value="completed">Zakończony</option>
            <option value="invoiced">Rozliczony</option>
            <option value="offer_to_send">Oferta do wysłania</option>
            <option value="inquiry">Zapytanie</option>
            <option value="cancelled">Anulowany</option>
            <option value="ready_for_live">Gotowy do realizacji</option>
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
          >
            <option value="all">Wszystkie kategorie</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-[#e5e4e2]/50" />
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
              className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
            >
              <option value="event_date">Data eventu</option>
              <option value="created_at">Data utworzenia</option>
              <option value="name">Nazwa</option>
              <option value="budget">Budżet</option>
            </select>
            <button
              onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
              className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] p-2 transition-colors hover:bg-[#d3bb73]/10"
              title={sortDirection === 'asc' ? 'Rosnąco' : 'Malejąco'}
            >
              <ArrowUpDown
                className={`h-4 w-4 text-[#e5e4e2] transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`}
              />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleViewModeChange('list')}
              className={`rounded-lg p-2 transition-colors ${
                viewMode === 'list'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0f1117] text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
              title="Widok listy"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleViewModeChange('grid')}
              className={`rounded-lg p-2 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0f1117] text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
              title="Widok siatki"
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleViewModeChange('table')}
              className={`rounded-lg p-2 transition-colors ${
                viewMode === 'table'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#0f1117] text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
              title="Widok tabeli"
            >
              <Table2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* DESKTOP footer */}
        <div className="hidden items-center justify-between border-t border-[#d3bb73]/10 pt-4 md:flex">
          <button
            onClick={() => setShowPastEvents(!showPastEvents)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              showPastEvents
                ? 'border border-[#d3bb73]/30 bg-[#d3bb73]/20 text-[#d3bb73]'
                : 'border border-[#d3bb73]/20 bg-[#0f1117] text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10'
            }`}
          >
            <Calendar className="h-4 w-4" />
            {showPastEvents ? 'Ukryj rozliczone' : 'Pokaż rozliczone'}
          </button>

          <div className="text-sm text-[#e5e4e2]/50">
            Znaleziono: <span className="font-medium text-[#d3bb73]">{filteredEvents.length}</span>{' '}
            z {events.length} eventów
          </div>
        </div>

        {/* MOBILE SEARCH MODAL */}
        {showMobileSearch && (
          <div className="fixed inset-0 z-[9999]">
            <div className="absolute left-1/2 top-20 w-[92%] -translate-x-1/2 rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-medium text-[#e5e4e2]">Szukaj</div>
                <button
                  onClick={() => setShowMobileSearch(false)}
                  className="rounded-lg p-2 text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
                >
                  ✕
                </button>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/50" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Szukaj po nazwie, lokalizacji, kliencie..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] py-2.5 pl-10 pr-4 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* MOBILE FILTERS MODAL */}
        {showMobileFilters && (
          <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm md:hidden">
            <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl border-t border-[#d3bb73]/20 bg-[#1c1f33] p-4">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm font-medium text-[#e5e4e2]">Filtry</div>
                <button
                  onClick={() => setShowMobileFilters(false)}
                  className="rounded-lg p-2 text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2.5 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                >
                  <option value="all">Wszystkie statusy</option>
                  <option value="offer_sent">Oferta wysłana</option>
                  <option value="offer_accepted">Zaakceptowana</option>
                  <option value="in_preparation">Przygotowanie</option>
                  <option value="in_progress">W trakcie</option>
                  <option value="completed">Zakończony</option>
                  <option value="invoiced">Rozliczony</option>
                  <option value="settled">Rozliczony</option>
                  <option value="offer_to_send">Oferta do wysłania</option>
                  <option value="inquiry">Zapytanie</option>
                  <option value="cancelled">Anulowany</option>
                  <option value="ready_for_live">Gotowy do realizacji</option>
                </select>

                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2.5 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                >
                  <option value="all">Wszystkie kategorie</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>

                <select
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value as SortField)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-4 py-2.5 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                >
                  <option value="event_date">Data eventu</option>
                  <option value="created_at">Data utworzenia</option>
                  <option value="name">Nazwa</option>
                  <option value="budget">Budżet</option>
                </select>

                <div className="text-xs text-[#e5e4e2]/50">
                  Kierunek sortowania: <span className="text-[#d3bb73]">{sortDirection}</span>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => {
                    setStatusFilter('all');
                    setCategoryFilter('all');
                    setSortField('event_date');
                    setSortDirection('asc');
                  }}
                  className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] py-2.5 text-sm text-[#e5e4e2]/80 hover:bg-[#d3bb73]/10"
                >
                  Reset
                </button>
                <button
                  onClick={() => setShowMobileFilters(false)}
                  className="flex-1 rounded-lg bg-[#d3bb73] py-2.5 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                >
                  Zastosuj
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {viewMode === 'table' ? (
        <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr>
                  {colOrder.map((key, index) => {
                    // pomiń budget jeśli brak uprawnień (gdyby kiedyś prefs to zawierały)
                    if (key === 'budget' && !canViewEventBudget) return null;
                    if (key === 'status' && !canViewEventStatus) return null;
                    if (key === 'actions' && !canViewEventStatus) return null;

                    const labelMap: Record<EventsTableColKey, React.ReactNode> = {
                      name: 'Nazwa',
                      client: 'Klient',
                      date: 'Data',
                      location: 'Lokalizacja',
                      status: 'Status',
                      category: 'Kategoria',
                      budget: 'Budżet',
                      actions: 'Akcje',
                    };
                    const minMap: Partial<Record<EventsTableColKey, number>> = {
                      name: 180,
                      client: 140,
                      date: 100,
                      location: 170,
                      status: 120,
                      category: 110,
                      budget: 100,
                      actions: 140,
                    };

                    const align: 'left' | 'right' =
                      key === 'budget' || key === 'actions' ? 'right' : 'left';

                    // mapowanie kluczy kolumn na pola sortowania
                    const sortFieldMap: Partial<Record<EventsTableColKey, SortField>> = {
                      name: 'name',
                      date: 'event_date',
                      budget: 'budget',
                    };

                    const colSortField = sortFieldMap[key];
                    const isSortable = !!colSortField;

                    return (
                      <ResizableTh
                        key={`${key}-${index}`}
                        label={labelMap[key]}
                        width={colWidths[key]}
                        min={minMap[key] ?? 120}
                        align={align}
                        draggable
                        sortable={isSortable}
                        sortField={colSortField}
                        currentSortField={sortField}
                        sortDirection={sortDirection}
                        onSort={(field) => toggleSort(field)}
                        onDragStart={() => {
                          dragKeyRef.current = key;
                        }}
                        onDragOver={(e) => {
                          e.preventDefault(); // ✅ konieczne
                        }}
                        onDrop={() => {
                          const from = dragKeyRef.current;
                          if (!from || from === key) return;
                          const nextOrder = moveKey(colOrder, from, key);
                          persistColOrder(nextOrder);
                          dragKeyRef.current = null;
                        }}
                        onResize={(w) => setColWidths((prev) => ({ ...prev, [key]: w }))}
                        onResizeEnd={(w) => persistColWidths(key, w)}
                      />
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {filteredEvents.map((event) => {
                  const urgency = getPastUrgency(event);
                  return (
                    <tr
                      key={event.id}
                      onClick={() => handleOpenEvent(event)}
                      className={`cursor-pointer border-b border-[#d3bb73]/5 text-[#e5e4e2] hover:bg-[#0f1117] ${
                        urgency === 'red'
                          ? 'bg-red-500/5'
                          : urgency === 'orange'
                            ? 'bg-orange-500/5'
                            : ''
                      }`}
                    >
                      {colOrder.map((key) => {
                        if (key === 'budget' && !canViewEventBudget) return null;
                        if (key === 'status' && !canViewEventStatus) return null;

                        const cellClassMap: Record<EventsTableColKey, string> = {
                          name: 'px-2 py-2',
                          client: 'px-2 py-2 text-[#e5e4e2]/80',
                          date: 'px-2 py-2 text-[#e5e4e2]/80',
                          location: 'px-2 py-2',
                          status: 'px-2 py-2',
                          category: 'px-2 py-2 text-[#e5e4e2]/80',
                          budget: 'px-2 py-2 text-right text-[#e5e4e2]/80',
                          actions: 'px-2 py-2 text-right whitespace-nowrap',
                        };

                        return (
                          <td
                            key={key}
                            className={cellClassMap[key]}
                            onClick={key === 'actions' ? stop : undefined}
                          >
                            <div className="flex items-center gap-1.5">
                              {key === 'name' && urgency && (
                                <AlertCircle
                                  className={`h-4 w-4 flex-shrink-0 ${urgency === 'red' ? 'text-red-500' : 'text-orange-500'}`}
                                />
                              )}
                              <div className="min-w-0 flex-1">{renderCell[key](event)}</div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-[#d3bb73]/10 px-4 py-3 text-xs text-[#e5e4e2]/50">
            <div>
              Widok: <span className="text-[#d3bb73]">tabela</span>
            </div>
            <button
              onClick={() => {
                persistColOrder(
                  canViewEventBudget
                    ? DEFAULT_COL_ORDER
                    : DEFAULT_COL_ORDER.filter((k) => {
                        if (k === 'budget' && !canViewEventBudget) return false;
                        if (k === 'status' && !canViewEventStatus) return false;
                        if (k === 'actions' && !canViewEventStatus) return false;
                        return true;
                      }),
                );
                // szerokości też:
                setColWidths(DEFAULT_EVENTS_COL_WIDTHS);
                setModulePrefs?.('events', {
                  table: {
                    ...(modulePrefs?.table ?? {}),
                    colOrder: canViewEventBudget
                      ? DEFAULT_COL_ORDER
                      : DEFAULT_COL_ORDER.filter((k) => {
                          if (k === 'budget' && !canViewEventBudget) return false;
                          if (k === 'status' && !canViewEventStatus) return false;
                          if (k === 'actions' && !canViewEventStatus) return false;
                          return true;
                        }),
                    colWidths: DEFAULT_EVENTS_COL_WIDTHS,
                  },
                });
              }}
              className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-3 py-1.5 text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10"
            >
              Reset układu
            </button>
          </div>
        </div>
      ) : (
        <div
          className={
            viewMode === 'grid'
              ? 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'
              : 'grid gap-4'
          }
        >
          {filteredEvents.map((event, index) => {
            const eventDate = new Date(event.event_end_date || event.event_date);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            eventDate.setHours(0, 0, 0, 0);
            const isPast = eventDate < today;
            const urgency = getPastUrgency(event);

            const clientLabel = getOrgLabel(event.organizations, event.contacts);
            const isContactClient = !event.organizations && !!getContactLabel(event.contacts);

            if (viewMode === 'grid') {
              return (
                <div
                  key={`${event.id}-grid-${index}`}
                  onClick={() => handleOpenEvent(event)}
                  className={`relative flex cursor-pointer flex-col rounded-xl border bg-[#1c1f33] p-4 transition-all hover:border-[#d3bb73]/30 md:p-6 ${
                    urgency === 'red'
                      ? 'border-red-500/60 ring-1 ring-red-500/30'
                      : urgency === 'orange'
                        ? 'border-orange-500/40'
                        : isPast
                          ? 'border-[#e5e4e2]/5 opacity-70'
                          : 'border-[#d3bb73]/10'
                  }`}
                >
                  {urgency && (
                    <div className="absolute right-3 top-3">
                      <AlertCircle
                        className={`h-5 w-5 ${urgency === 'red' ? 'text-red-500' : 'text-orange-500'}`}
                        aria-label={urgency === 'red' ? 'Nierozliczony >7 dni' : 'Nierozliczony'}
                      />
                    </div>
                  )}
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <h3 className="line-clamp-2 flex-1 text-base font-medium text-[#e5e4e2]">
                      {event.name}
                    </h3>

                    <div className="flex items-center gap-2">
                      <div className="hidden md:block" onClick={stop}>
                        {(canAddNewEvent || canViewEventStatus || canDeleteEvents) && (
                          <ResponsiveActionBar
                            disabledBackground
                            mobileBreakpoint={2000}
                            actions={[
                              ...(canAddNewEvent
                                ? [
                                    {
                                      label: 'Duplikuj',
                                      onClick: () => handleDuplicateClick(null, event),
                                      icon: <Copy className="h-4 w-4" />,
                                      variant: 'default' as const,
                                    },
                                  ]
                                : []),

                              ...(canViewEventStatus
                                ? [
                                    {
                                      label: 'Zmień status',
                                      onClick: () => handleStatusClick(null, event),
                                      icon: <PencilLine className="h-4 w-4" />,
                                      variant: 'default' as const,
                                    },
                                  ]
                                : []),

                              ...(canDeleteEvents
                                ? [
                                    {
                                      label: 'Usuń',
                                      onClick: () => handleDeleteClick(null, event),
                                      icon: <Trash2 className="h-4 w-4" />,
                                      variant: 'danger' as const,
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        )}
                      </div>

                      <div className="md:hidden" onClick={stop}>
                        {(canAddNewEvent || canViewEventStatus || canDeleteEvents) && (
                          <ResponsiveActionBar
                            actions={[
                              ...(canAddNewEvent
                                ? [
                                    {
                                      label: 'Duplikuj',
                                      onClick: () => handleDuplicateClick(null, event),
                                      icon: <Copy className="h-4 w-4" />,
                                      variant: 'default' as const,
                                    },
                                  ]
                                : []),

                              ...(canViewEventStatus
                                ? [
                                    {
                                      label: 'Zmień status',
                                      onClick: () => handleStatusClick(null, event),
                                      icon: <PencilLine className="h-4 w-4" />,
                                      variant: 'default' as const,
                                    },
                                  ]
                                : []),

                              ...(canDeleteEvents
                                ? [
                                    {
                                      label: 'Usuń',
                                      onClick: () => handleDeleteClick(null, event),
                                      icon: <Trash2 className="h-4 w-4" />,
                                      variant: 'danger' as const,
                                    },
                                  ]
                                : []),
                            ]}
                            disabledBackground
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 text-sm text-[#e5e4e2]/70">
                    <div className="flex items-center gap-2">
                      {isContactClient ? (
                        <User className="h-4 w-4 flex-shrink-0" />
                      ) : (
                        <Building2 className="h-4 w-4 flex-shrink-0" />
                      )}
                      <span className="truncate">{clientLabel}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate">
                        {new Date(event.event_date).toLocaleDateString('pl-PL')}
                        {isPast && (
                          <span className="ml-2 text-xs text-[#e5e4e2]/40">(przeszły)</span>
                        )}
                      </span>
                    </div>

                    <div className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <span className="line-clamp-2">
                        {getLocationLabel(event.locations, event.location)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {canViewEventStatus && (
                      <div>
                        <EventStatusBadge status={event.status} />
                      </div>
                    )}

                    {event.event_categories && (
                      <div className="rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-2 py-1 text-xs text-[#d3bb73]">
                        {event.event_categories.name}
                      </div>
                    )}
                  </div>

                  {canViewCommercials && (
                    <div className="mt-3 text-sm text-[#e5e4e2]/70">
                      Budżet:{' '}
                      <span className="font-medium text-[#d3bb73]">
                        {event.expected_revenue ? event.expected_revenue.toLocaleString() : '0'} zł
                      </span>
                    </div>
                  )}

                  <div className="mt-3 hidden md:block">
                    {canViewEventStatus && (
                      <div>
                        <EventStatusBadge status={event.status} />
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            // LIST VIEW
            return (
              <div
                key={`${event.id}-list-${index}`}
                className={`relative cursor-pointer rounded-xl border bg-[#1c1f33] p-2 transition-all hover:border-[#d3bb73]/30 sm:p-4 md:p-6 ${
                  urgency === 'red'
                    ? 'border-red-500/60 ring-1 ring-red-500/30'
                    : urgency === 'orange'
                      ? 'border-orange-500/40'
                      : isPast
                        ? 'border-[#e5e4e2]/5 opacity-70'
                        : 'border-[#d3bb73]/10'
                }`}
                onClick={() => handleOpenEvent(event)}
              >
                {urgency && (
                  <div className="absolute right-3 top-3 md:right-4 md:top-4">
                    <AlertCircle
                      className={`h-5 w-5 ${urgency === 'red' ? 'text-red-500' : 'text-orange-500'}`}
                      aria-label={urgency === 'red' ? 'Nierozliczony >7 dni' : 'Nierozliczony'}
                    />
                  </div>
                )}
                {/* TWÓJ OBECNY LIST CONTENT 1:1 */}
                <div className="flex items-start justify-between gap-1 sm:gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="max-w-[240px] truncate text-base font-medium text-[#e5e4e2] md:text-lg">
                        {event.name}
                      </h3>
                      {isPast && (
                        <span className="hidden rounded bg-[#e5e4e2]/10 px-2 py-0.5 text-xs text-[#e5e4e2]/50 md:inline">
                          Przeszły
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex flex-col gap-1 text-sm text-[#e5e4e2]/70 md:flex-row md:flex-wrap md:gap-4">
                      <div className="flex items-center gap-2">
                        {isContactClient ? (
                          <User className="h-4 w-4 flex-shrink-0" />
                        ) : (
                          <Building2 className="h-4 w-4 flex-shrink-0" />
                        )}
                        <span className="max-w-[250px] truncate">{clientLabel}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">
                          {new Date(event.event_date).toLocaleDateString('pl-PL')}
                        </span>
                      </div>

                      <div className="flex min-w-0 items-center gap-2">
                        <MapPin className="h-4 w-4 flex-shrink-0" />

                        <div className="min-w-0 flex-1 truncate">
                          <a
                            href={getMapsHref(event.locations, event.location) ?? undefined}
                            target="_blank"
                            rel="noreferrer"
                            onClick={stop}
                            className="block min-w-0 cursor-pointer truncate text-[#e5e4e2]/70 hover:text-[#d3bb73]"
                            title="Otwórz w mapach"
                          >
                            <span className="block max-w-[calc(100vw-140px)] truncate whitespace-nowrap sm:hidden">
                              {getLocationLabelMobile(event.locations, event.location)}
                            </span>

                            <span className="hidden sm:inline">
                              {getLocationLabelDesktop(event.locations, event.location)}
                            </span>
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="hidden items-center gap-2 md:flex">
                      {canViewEventStatus && (
                        <div>
                          <EventStatusBadge status={event.status} />
                        </div>
                      )}
                      {event.event_categories && (
                        <div className="flex items-center gap-1 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-3 py-1 text-xs text-[#d3bb73]">
                          <Tag className="h-3 w-3" />
                          {event.event_categories.name}
                        </div>
                      )}
                    </div>

                    <div className="hidden md:block">
                      {canViewCommercials && (
                        <button
                          onClick={(e) => {
                            stop(e);
                            handleDeleteClick(e, event);
                          }}
                          className="rounded-lg bg-red-500/10 p-2 text-red-500 transition-colors hover:bg-red-500/20"
                          title="Usuń event"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    <div className="md:hidden" onClick={stop}>
                      {(canAddNewEvent || canViewEventStatus || canDeleteEvents) && (
                        <ResponsiveActionBar
                          actions={[
                            ...(canAddNewEvent
                              ? [
                                  {
                                    label: 'Duplikuj',
                                    onClick: () => handleDuplicateClick(null, event),
                                    icon: <Copy className="h-4 w-4" />,
                                    variant: 'default' as const,
                                  },
                                ]
                              : []),

                            ...(canViewEventStatus
                              ? [
                                  {
                                    label: 'Zmień status',
                                    onClick: () => handleStatusClick(null, event),
                                    icon: <PencilLine className="h-4 w-4" />,
                                    variant: 'default' as const,
                                  },
                                ]
                              : []),

                            ...(canDeleteEvents
                              ? [
                                  {
                                    label: 'Usuń',
                                    onClick: () => handleDeleteClick(null, event),
                                    icon: <Trash2 className="h-4 w-4" />,
                                    variant: 'danger' as const,
                                  },
                                ]
                              : []),
                          ]}
                          disabledBackground
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 md:hidden">
                  {canViewEventStatus && (
                    <div
                      className={`rounded-full border px-2 py-1 text-xs ${statusColors[event.status]}`}
                    >
                      <EventStatusBadge status={event.status} />
                    </div>
                  )}
                  {event.event_categories && (
                    <div className="rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-2 py-1 text-xs text-[#d3bb73]">
                      {event.event_categories.name}
                    </div>
                  )}
                  {isPast && (
                    <span className="rounded bg-[#e5e4e2]/10 px-2 py-0.5 text-xs text-[#e5e4e2]/50">
                      Przeszły
                    </span>
                  )}
                </div>

                {canViewCommercials && (
                  <div className="mt-4 flex items-center justify-between border-t border-[#d3bb73]/10 pt-4">
                    <div className="text-sm text-[#e5e4e2]/70">
                      Budżet:{' '}
                      <span className="font-medium text-[#d3bb73]">
                        {event.expected_revenue ? event.expected_revenue.toLocaleString() : '0'} zł
                      </span>
                    </div>

                    <div className="text-xs text-[#e5e4e2]/40 md:hidden">Szczegóły →</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <FullScreenLoader
        show={openingEvent}
        title="Wczytuję event"
        description={
          openingEventName
            ? `Pobieram dane wydarzenia: ${openingEventName}`
            : 'Pobieram dane wydarzenia...'
        }
      />

      <EventWizard
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={fetchEvents}
      />

      <Modal
        open={duplicateModalOpen}
        onClose={() => {
          if (duplicatingEvent) return;

          setDuplicateModalOpen(false);
          setEventToDuplicate(null);
          resetDuplicateOptions();
        }}
        title="Duplikuj wydarzenie"
      >
        <div className="space-y-6">
          {/* INFORMACJA O WYDARZENIU */}
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-[#d3bb73]/10 p-3">
              <Copy className="h-6 w-6 text-[#d3bb73]" />
            </div>

            <div className="min-w-0 flex-1">
              <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">Duplikowanie wydarzenia</h3>

              <p className="text-sm text-[#e5e4e2]/70">
                Event: <strong className="text-[#d3bb73]">{eventToDuplicate?.name || '—'}</strong>
              </p>

              <p className="mt-2 text-sm leading-relaxed text-[#e5e4e2]/50">
                Domyślnie zostaną zachowane termin, miejsce i klient oryginalnego wydarzenia.
                Zaznacz wybrane opcje, aby je zmienić.
              </p>
            </div>
          </div>

          {/* OPCJE DUPLIKOWANIA */}
          <div className="space-y-4">
            {/* ZMIANA DATY */}
            <div className="rounded-xl border border-[#d3bb73]/15 bg-[#0f1117] p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={changeDuplicateDate}
                  onChange={(e) => setChangeDuplicateDate(e.target.checked)}
                  disabled={duplicatingEvent}
                  className="mt-1 h-4 w-4 flex-shrink-0 accent-[#d3bb73]"
                />

                <div>
                  <div className="font-medium text-[#e5e4e2]">Zmień termin wydarzenia</div>

                  <div className="text-xs text-[#e5e4e2]/50">
                    Ustaw nową datę rozpoczęcia i zakończenia.
                  </div>
                </div>
              </label>

              {changeDuplicateDate && (
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data rozpoczęcia</label>

                    <input
                      type="datetime-local"
                      value={duplicateStartDate}
                      onChange={(e) => {
                        const nextStartDate = e.target.value;

                        setDuplicateStartDate(nextStartDate);

                        if (
                          !duplicateEndDate ||
                          new Date(duplicateEndDate).getTime() < new Date(nextStartDate).getTime()
                        ) {
                          setDuplicateEndDate(nextStartDate);
                        }
                      }}
                      disabled={duplicatingEvent}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data zakończenia</label>

                    <input
                      type="datetime-local"
                      value={duplicateEndDate}
                      min={duplicateStartDate || undefined}
                      onChange={(e) => setDuplicateEndDate(e.target.value)}
                      disabled={duplicatingEvent}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* ZMIANA MIEJSCA */}
            <div className="rounded-xl border border-[#d3bb73]/15 bg-[#0f1117] p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={changeDuplicateLocation}
                  onChange={(e) => setChangeDuplicateLocation(e.target.checked)}
                  disabled={duplicatingEvent}
                  className="mt-1 h-4 w-4 flex-shrink-0 accent-[#d3bb73]"
                />

                <div>
                  <div className="font-medium text-[#e5e4e2]">Zmień miejsce wydarzenia</div>

                  <div className="text-xs text-[#e5e4e2]/50">
                    Wybierz inne miejsce zapisane w bazie.
                  </div>
                </div>
              </label>

              {changeDuplicateLocation && (
                <div className="mt-4">
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nowe miejsce</label>

                  <select
                    value={duplicateLocationId}
                    onChange={(e) => setDuplicateLocationId(e.target.value)}
                    disabled={duplicatingEvent || loadingDuplicateOptions}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">
                      {loadingDuplicateOptions ? 'Pobieranie miejsc...' : 'Wybierz miejsce'}
                    </option>

                    {duplicateLocations.map((location) => {
                      const address =
                        location.formatted_address || location.address || location.city;

                      return (
                        <option key={location.id} value={location.id}>
                          {location.name}
                          {address ? ` — ${address}` : ''}
                        </option>
                      );
                    })}
                  </select>

                  {!loadingDuplicateOptions && duplicateLocations.length === 0 && (
                    <p className="mt-2 text-xs text-orange-400">
                      Nie znaleziono miejsc zapisanych w bazie.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* ZMIANA KLIENTA */}
            <div className="rounded-xl border border-[#d3bb73]/15 bg-[#0f1117] p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={changeDuplicateClient}
                  onChange={(e) => setChangeDuplicateClient(e.target.checked)}
                  disabled={duplicatingEvent}
                  className="mt-1 h-4 w-4 flex-shrink-0 accent-[#d3bb73]"
                />

                <div>
                  <div className="font-medium text-[#e5e4e2]">Zmień klienta</div>

                  <div className="text-xs text-[#e5e4e2]/50">
                    Wybierz firmę albo klienta indywidualnego.
                  </div>
                </div>
              </label>

              {changeDuplicateClient && (
                <div className="mt-4">
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nowy klient</label>

                  <select
                    value={duplicateClient ? `${duplicateClient.type}:${duplicateClient.id}` : ''}
                    onChange={(e) => {
                      const value = e.target.value;

                      if (!value) {
                        setDuplicateClient(null);
                        return;
                      }

                      const separatorIndex = value.indexOf(':');

                      if (separatorIndex === -1) {
                        setDuplicateClient(null);
                        return;
                      }

                      const type = value.slice(0, separatorIndex);
                      const id = value.slice(separatorIndex + 1);

                      if (!id) {
                        setDuplicateClient(null);
                        return;
                      }

                      if (type === 'business') {
                        setDuplicateClient({
                          type: 'business',
                          id,
                        });
                        return;
                      }

                      if (type === 'individual') {
                        setDuplicateClient({
                          type: 'individual',
                          id,
                        });
                        return;
                      }

                      setDuplicateClient(null);
                    }}
                    disabled={duplicatingEvent || loadingDuplicateOptions}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">
                      {loadingDuplicateOptions ? 'Pobieranie klientów...' : 'Wybierz klienta'}
                    </option>

                    {duplicateOrganizations.length > 0 && (
                      <optgroup label="Firmy i organizacje">
                        {duplicateOrganizations.map((organization) => (
                          <option
                            key={`business-${organization.id}`}
                            value={`business:${organization.id}`}
                          >
                            {organization.alias || organization.name}
                          </option>
                        ))}
                      </optgroup>
                    )}

                    {duplicateContacts.length > 0 && (
                      <optgroup label="Klienci indywidualni">
                        {duplicateContacts.map((contact) => {
                          const name =
                            `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim();

                          return (
                            <option
                              key={`individual-${contact.id}`}
                              value={`individual:${contact.id}`}
                            >
                              {name || contact.email || 'Klient bez nazwy'}
                              {contact.email && name ? ` — ${contact.email}` : ''}
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                  </select>

                  {!loadingDuplicateOptions &&
                    duplicateOrganizations.length === 0 &&
                    duplicateContacts.length === 0 && (
                      <p className="mt-2 text-xs text-orange-400">
                        Nie znaleziono klientów zapisanych w bazie.
                      </p>
                    )}
                </div>
              )}
            </div>
          </div>

          {/* INFORMACJA O KOPIOWANYCH DANYCH */}
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#d3bb73]/5 p-4">
            <p className="text-sm leading-relaxed text-[#e5e4e2]/60">
              Skopiowane zostaną dane wydarzenia oraz aktywne źródło finansowe: zaakceptowana
              kalkulacja albo, gdy jej nie ma, zaakceptowana oferta.
            </p>

            <p className="mt-2 text-sm leading-relaxed text-[#e5e4e2]/50">
              Nie zostaną skopiowane pliki, dokumenty, zadania, faktury, płatności ani cały
              przypisany zespół.
            </p>
          </div>

          {/* PRZYCISKI */}
          <div className="flex flex-col-reverse gap-3 border-t border-[#d3bb73]/20 pt-4 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={() => {
                if (duplicatingEvent) return;

                setDuplicateModalOpen(false);
                setEventToDuplicate(null);
                resetDuplicateOptions();
              }}
              disabled={duplicatingEvent}
              className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Anuluj
            </button>

            <button
              type="button"
              onClick={handleDuplicateConfirm}
              disabled={
                duplicatingEvent ||
                loadingDuplicateOptions ||
                (changeDuplicateDate && !duplicateStartDate) ||
                (changeDuplicateLocation && !duplicateLocationId) ||
                (changeDuplicateClient && !duplicateClient)
              }
              className="flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {duplicatingEvent ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Duplikowanie...
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Duplikuj wydarzenie
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={statusModalOpen}
        onClose={() => {
          if (savingStatus) return;
          setStatusModalOpen(false);
          setEventToChangeStatus(null);
        }}
        title="Zmień status wydarzenia"
      >
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-sm text-[#e5e4e2]/70">
              Event: <strong className="text-[#d3bb73]">{eventToChangeStatus?.name || '—'}</strong>
            </p>

            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nowy status</label>

            <select
              value={draftStatus}
              onChange={(e) => setDraftStatus(e.target.value)}
              disabled={savingStatus}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
            >
              {Object.entries(eventStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label as string}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 pt-4">
            <button
              onClick={() => {
                setStatusModalOpen(false);
                setEventToChangeStatus(null);
              }}
              disabled={savingStatus}
              className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] hover:bg-[#d3bb73]/5 disabled:opacity-50"
            >
              Anuluj
            </button>

            <button
              onClick={handleStatusConfirm}
              disabled={savingStatus || draftStatus === eventToChangeStatus?.status}
              className="rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              {savingStatus ? 'Zapisywanie...' : 'Zapisz status'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Usuń event">
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-red-500/10 p-3">
              <AlertTriangle className="h-6 w-6 text-red-500" />
            </div>
            <div>
              <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">
                Czy na pewno chcesz usunąć ten event?
              </h3>
              <p className="mb-2 text-[#e5e4e2]/70">
                Event: <strong className="text-[#d3bb73]">{eventToDelete?.name}</strong>
              </p>
              <p className="text-sm text-[#e5e4e2]/60">
                Ta operacja jest nieodwracalna. Wszystkie powiązane dane (oferty, zadania, pliki)
                również zostaną usunięte.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 pt-4">
            <button
              onClick={() => setDeleteModalOpen(false)}
              className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/5"
            >
              Anuluj
            </button>
            <button
              onClick={handleDeleteConfirm}
              className="rounded-lg bg-red-500 px-4 py-2 text-white transition-colors hover:bg-red-600"
            >
              Usuń event
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
