/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import EventNavigation, { type EventNavigationItem } from '@/components/crm/events/EventNavigation';
import { getOfferPricingTotals, roundMoney } from '@/lib/CRM/Offers/offerTotals';
import EventStepsPanel from '@/components/crm/events/steps/EventStepsPanel';
import EventKeyFactsCard from '@/components/crm/events/EventKeyFactsCard';
import { RealizationPanel } from '@/components/crm/events/RealizationPanel';
import WarehouseHandoffPanel from '@/components/crm/events/WarehouseHandoffPanel';
import {
  EVENT_TAB_LABELS,
  canViewEventArea,
  eventAccessSummary,
  normalizeEventTabId,
  visibleEventTabs,
  type EventAccess,
  type EventTabId,
} from '@/lib/events/access/eventAccess';
import { legacyEventAccess } from '@/lib/CRM/events/eventAccessFallback';
import { eventMoney, fetchEventFinancials, type EventFinancialField, type EventFinancials } from '@/lib/CRM/events/eventFinancials';
import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ComponentType,
} from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  Building2,
  DollarSign,
  CreditCard as Edit,
  Trash2,
  Plus,
  Package,
  Users,
  FileText,
  CheckSquare,
  Clock,
  X,
  User,
  Tag,
  Mail,
  CreditCard as EditIcon,
  AlertCircle,
  History,
  UserCheck,
  Truck,
  Activity,
  Calendar as CalendarIcon,
  List,
  RefreshCw,
  Copy,
  HeartHandshake,
  MonitorPlay,
  Printer,
  Info,
  LayoutDashboard,
  FolderOpen,
  Calculator,
  ScrollText,
  Wallet,
  ShieldAlert,
} from 'lucide-react';
import * as Icons from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

import { ContactRow, OrganizationRow } from '@/app/(crm)/crm/contacts/types';

import EventTasksBoard from '@/app/(crm)/crm/events/[id]/components/tabs/EventTasksBoard';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import EventFilesExplorer from '@/app/(crm)/crm/events/[id]/components/tabs/EventFilesExplorer';
import EventSubcontractorsPanel from '@/app/(crm)/crm/events/[id]/components/tabs/EventSubcontractorsPanel';
import EventLogisticsPanel from '@/app/(crm)/crm/events/[id]/components/tabs/EventLogisticsPanel';
import OfferWizard from '@/app/(crm)/crm/offers/[id]/components/OfferWizzard/OfferWizard';
import EventFinancesTab from '@/app/(crm)/crm/events/[id]/components/tabs/EventFinancesTab';
import EventAgendaTab from '@/app/(crm)/crm/events/[id]/components/tabs/EventAgendaTab';
import EventWeddingCardTab from '@/app/(crm)/crm/events/[id]/components/tabs/EventWeddingCardTab';
import EventMavinciLiveTab, {
  type MavinciLiveModuleRequirement,
} from '@/app/(crm)/crm/events/[id]/components/tabs/EventMavinciLiveTab';
import EventCalculationsTab from '@/components/crm/events/calculations/EventCalculationsTab';
import { EventPhasesTimeline } from '@/app/(crm)/crm/events/[id]/components/tabs/EventPhasesTimeline';

import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';

import EditEventModalNew from '@/components/crm/EditEventModalNew';
import SendOfferEmailModal from '@/components/crm/SendOfferEmailModal';
import EventTabOffer from './components/tabs/EventTabOffer';
import { EventsDetailsTab } from './components/tabs/EventsDetailsTab/EventsDetailsTab';
import { AddChecklistModal } from './components/Modals/AddChecklistModal';
import { TeamMembersList } from './components/AddMembersList';
import { EventEquipmentTab } from './components/tabs/EventEquipmentTab';
import {
  eventsApi,
  useGetEventByIdQuery,
  useGetEventOffersQuery,
  useUpdateEventMutation,
  useCreateEventMutation,
  useDeleteEventOfferMutation,
} from '../store/api/eventsApi';
import { useEventEquipment, useEventOffers, useEventTeam } from '../hooks';
import { useLocations } from '../../locations/useLocations';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';
import { useEvent } from '../hooks/useEvent';
import EventStatusSelectModal from '@/components/crm/EventStatusEditor';
import { EventStatus } from '@/components/crm/Calendar/types';
import EventDetailsAction from './components/tabs/EventsDetailsTab/EventDetailsAction';
import { useDispatch } from 'react-redux';
import { IEvent, IOffer } from '../type';
import { UnknownAction } from '@reduxjs/toolkit';
import { AddEventEmployeeModal } from './components/Modals/AddEventEmployeeModal';
import { useEventAuditLog } from '@/app/(crm)/crm/events/hooks/useEventAuditLog';
import { IEmployee } from '../../employees/type';
import { hasScope } from './helpers/hasScope';
import { EventCategoryRow } from '@/lib/CRM/events/eventsData.server';
import EventPartnerArrangement from '@/components/crm/events/contract/EventPartnerArrangement';
import { EventContractTab } from '@/components/crm/events/contract/EventContractTab';
import { deleteEventSafely } from '@/lib/CRM/events/deleteEventSafely';
import EventPreflightPanel from '@/components/crm/events/EventPreflightPanel';
import { useEventWorkspace } from '@/components/crm/events/EventWorkspaceProvider';
import { EVENT_STATUS_BADGE_CLASSES } from '@/components/crm/events/eventStatusPalette';
import EventSellerCorrespondence from '@/components/seller/EventSellerCorrespondence';

type EventDetailTab = EventTabId;

/** Ikony zakładek (etykiety i grupy: EVENT_TAB_LABELS / EVENT_TAB_GROUPS we wspólnym eventAccess.ts). */
const EVENT_TAB_ICONS: Record<EventTabId, ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard,
  details: Info,
  equipment: Package,
  logistics: Truck,
  team: Users,
  phases: Clock,
  agenda: ClipboardList,
  subcontractors: UserCheck,
  files: FolderOpen,
  tasks: CheckSquare,
  'mavinci-live': MonitorPlay,
  offer: DollarSign,
  calculations: Calculator,
  contract: ScrollText,
  'seller-arrangements': Icons.MessageSquare,
  finances: Wallet,
  history: History,
};


interface Equipment {
  kit_id: unknown;
  id: string;
  equipment_id: string;
  quantity: number;
  notes: string;
  auto_added: boolean;
  equipment: {
    model: any;
    cable_specs: any;
    brand: any;
    thumbnail_url: any;
    name: string;
    category: string;
  };
  kit?: any;
}
interface Checklist {
  id: string;
  title: string;
  items: ChecklistItem[];
}

interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  assigned_to?: string;
  due_date?: string;
  notes?: string;
}

const statusColors: Record<string, string> = { ...EVENT_STATUS_BADGE_CLASSES };

export const statusLabels: Record<EventStatus, string> = {
  ready_for_live: 'Gotowy do realizacji',
  offer_sent: 'Oferta wysłana',
  offer_accepted: 'Oferta zaakceptowana',
  in_preparation: 'W przygotowaniu',
  in_progress: 'W trakcie',
  completed: 'Zakończony',
  cancelled: 'Anulowany',
  invoiced: 'Rozliczony',
  inquiry: 'Zapytanie',
  offer_to_send: 'Oferta do wysłania',
  settled: 'Rozliczony',
};

export interface ISimpleLocation {
  id: string;
  name: string;
  formatted_address?: string;
  address?: string;
  city?: string;
  postal_code?: string;
  google_maps_url?: string;
}

export interface ISimpleContact {
  organization_name: any;
  contact_type: string;
  business_phone?: string;
  id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  phone?: string;
}

// Funkcja formatująca wartości w timeline
function formatAuditValue(value: any): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Tak' : 'Nie';

  if (typeof value === 'object') {
    // Wyciągnij tylko sensowne wartości z obiektu
    if (value.content) return value.content;
    if (value.title) return value.title;
    if (value.name) return value.name;
    if (value.text) return value.text;

    // Formatuj daty
    if (value.event_date || value.event_end_date) {
      const start = value.event_date
        ? new Date(value.event_date).toLocaleDateString('pl-PL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          })
        : '';
      const startTime = value.event_date
        ? new Date(value.event_date).toLocaleTimeString('pl-PL', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
      const endTime = value.event_end_date
        ? new Date(value.event_end_date).toLocaleTimeString('pl-PL', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';

      if (startTime && endTime) {
        return `${start} godz. ${startTime} - ${endTime}`;
      }
      return start;
    }

    // Dla innych obiektów zwróć myślnik (ukryj szczegóły)
    return '-';
  }

  return String(value);
}

export default function EventDetailPageClient({
  canPrintCard = false,
  categories,
  initialData,
  initialLocation,
  initialContact,
  initialOffers,
}: {
  /** Dostęp do pulpitu realizacji (kierownik realizacji / prowadzenie realizacji) — Karta imprezy do druku. */
  canPrintCard?: boolean;
  categories: EventCategoryRow[];
  initialData: IEvent;
  initialLocation: ISimpleLocation;
  initialContact: ISimpleContact;
  initialOffers: IOffer[];
}) {
  const { organization, creator, currentEmployee, permissionContext, employees } = initialData;

  const {
    canManageTeam: canManageTeamFromContext,
    userAssignmentStatus,
    hasLimitedAccess,
    isAdmin,
    isCreator,
    currentUserId,
    canManageEvent,
  } = permissionContext;

  // Obszary danych z bazy (get_event_access) — jedno źródło decyzji, które zakładki i sekcje widać.
  // Serwer zawsze przekazuje obszary; awaryjnie (starsza wersja danych) — dotychczasowe reguły bez rozliczeń.
  const access = useMemo<EventAccess>(
    () =>
      permissionContext.access ??
      legacyEventAccess({
        eventId: initialData.id ?? null,
        isAdmin,
        isCreator,
        role: currentEmployee?.role ?? null,
        accessLevel: (currentEmployee as { access_level?: string | null } | undefined)?.access_level ?? null,
        permissions: (currentEmployee?.permissions as string[] | undefined) ?? [],
        billing: false,
      }),
    [permissionContext.access, initialData.id, isAdmin, isCreator, currentEmployee],
  );
  // Zawężenie zakładek z ustawień pracownika (null = bez zawężenia; administrator i prowadzący bez zawężenia).
  const employeeEventTabs = permissionContext.employeeEventTabs ?? null;
  const canViewClient = canViewEventArea(access, 'client');
  const canViewOnsiteContact = canViewEventArea(access, 'onsite_contact');
  const canViewValues = canViewEventArea(access, 'values');
  const canViewCommercialDocs = canViewEventArea(access, 'commercial_docs');
  const canViewBilling = canViewEventArea(access, 'billing');
  const canViewOperations = canViewEventArea(access, 'operations');
  // Kroki realizacji niewdrożone w bazie (get_event_steps) → dawne panele magazynu i kierownika realizacji.
  const [stepsUnavailable, setStepsUnavailable] = useState(false);
  const handleStepsUnavailable = useCallback(() => setStepsUnavailable(true), []);
  // Oferty: zakładka Oferta (dokumenty handlowe) i planowany przychód w karcie Budżet (kwoty). RLS ofert decyduje ostatecznie.
  const canLoadOffers = canViewCommercialDocs || canViewValues;

  // Jedna decyzja z bazy (current_employee_can_manage_event); starsza baza: dotychczasowa reguła.
  const canEventManage =
    canManageEvent ?? Boolean(isCreator || isAdmin || currentEmployee?.permissions?.includes('events_manage'));
  const canManageTeam = canManageTeamFromContext || isCreator || isAdmin;

  const router = useRouter();
  const params = useParams();
  const dispatch = useDispatch();
  const searchParams = useSearchParams();
  const eventId = params.id as string;
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const { equipment } = useEventEquipment(eventId);
  const { employees: teamEmployees, refetch: refetchTeam } = useEventTeam(eventId);
  const { refresh: refreshWorkspace } = useEventWorkspace();

  const { event: eventData, updateEvent } = useEvent(initialData);
  const [signedContractEventId, setSignedContractEventId] = useState<string | null>(null);
  const [showStatusModal, setShowStatusModal] = useState(false);

  // ✅ uprawnienia do OFERT / FAKTUR / FINANSÓW (dopasuj nazwy scope do swoich)
  // Wartości finansowe wydarzenia (budżet, płatnicy, zakładka Finanse): ta sama reguła co baza i aplikacja
  // mobilna — public.can_view_event_commercials (poziom finansów w działalności wydarzenia, finances_view /
  // finances_manage przy widocznym wydarzeniu albo sprzedawca tego wydarzenia z poziomem „Własna sprzedaż”).
  const [financeValuesAccess, setFinanceValuesAccess] = useState<{ eventId: string; allowed: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    void supabase.rpc('can_view_event_commercials', { p_event_id: eventId }).then(({ data, error }) => {
      if (active) setFinanceValuesAccess({ eventId, allowed: !error && data === true });
    });
    return () => { active = false; };
  }, [eventId, currentEmployee?.id]);
  const canViewFinanceValues = financeValuesAccess?.eventId === eventId && financeValuesAccess.allowed;

  // Dotychczasowa reguła akcji handlowych (status, oferty) — teraz dodatkowo wymaga obszaru commercial_docs.
  const canViewCommercials =
    isCreator ||
    currentEmployee?.role === 'admin' ||
    hasScope('finances_manage', currentEmployee as IEmployee) ||
    hasScope('finances_view', currentEmployee as IEmployee) ||
    hasScope('offers_manage', currentEmployee as IEmployee) ||
    hasScope('offers_view', currentEmployee as IEmployee) ||
    canViewFinanceValues;

  // Offer correspondence is commercial history, not a general team chat.
  // The RPC additionally enforces event access and the seller's brand scope.
  const canViewSellerCorrespondence = canViewCommercialDocs && (
    isCreator || isAdmin || ['offers_view', 'offers_manage', 'finances_view', 'finances_manage']
      .some((scope) => hasScope(scope, currentEmployee as IEmployee))
  );
  // Status i akcje sprzedażowe (Szczegóły): jak dotąd, a dodatkowo tylko z obszarem „oferta, umowa i formalności”.
  const showDetailsAction = canViewCommercials && canViewCommercialDocs;

  const [event, setEvent] = useState<IEvent>(initialData);
  const [deletingEvent, setDeletingEvent] = useState(false);

  // Kwoty z event_financials (tylko z obszarem „kwoty”). Kolumny kwot w `events` są po migracji puste.
  const [financials, setFinancials] = useState<EventFinancials | null>(initialData.financials ?? null);
  const money = useCallback(
    (field: EventFinancialField) => eventMoney(event, financials, field),
    [event, financials],
  );
  const reloadFinancials = useCallback(async () => {
    if (!canViewValues) return;
    const next = await fetchEventFinancials(supabase, eventId);
    if (next) setFinancials(next);
  }, [canViewValues, eventId]);

  useEffect(() => {
    if (!eventData || eventData.id !== eventId) return;
    // Nagłówek i zakładki mają ten sam stan po aktualizacji statusu przez bazę.
    setEvent((previous) => previous.id === eventData.id
      ? { ...previous, ...eventData }
      : eventData);
  }, [eventData, eventId]);

  const isWeddingEvent = useMemo(() => {
    const categoryName =
      event?.category?.name || categories.find((category) => category.id === event?.category_id)?.name;
    return categoryName?.trim().toLocaleLowerCase('pl-PL').startsWith('wesel') ?? false;
  }, [categories, event?.category?.name, event?.category_id]);

  const [updateEventMutation] = useUpdateEventMutation();
  const [deleteOfferMutation] = useDeleteEventOfferMutation();

  useEffect(() => {
    const success = searchParams.get('success');
    const error = searchParams.get('error');
    const info = searchParams.get('info');
    const eventName = searchParams.get('event');

    if (success === 'invitation_accepted') {
      showSnackbar(`Zaproszenie do wydarzenia "${eventName}" zostało zaakceptowane`, 'success');
      router.replace(`/crm/events/${eventId}`);
    } else if (error === 'invalid_token') {
      showSnackbar('Nieprawidłowy lub nieważny token zaproszenia', 'error');
      router.replace(`/crm/events/${eventId}`);
    } else if (error === 'token_expired') {
      showSnackbar(
        'Token zaproszenia wygasł. Zaloguj się do systemu aby potwierdzić udział.',
        'error',
      );
      router.replace(`/crm/events/${eventId}`);
    } else if (info === 'already_responded') {
      showSnackbar('Już odpowiedziałeś na to zaproszenie', 'info');
      router.replace(`/crm/events/${eventId}`);
    } else if (error === 'update_failed') {
      showSnackbar('Nie udało się zaktualizować statusu zaproszenia', 'error');
      router.replace(`/crm/events/${eventId}`);
    }
  }, [searchParams, eventId, router, showSnackbar]);

  const { getById } = useLocations();

  const [location, setLocation] = useState<ISimpleLocation | null>(initialLocation || null);
  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false);

  useEffect(() => {
    let alive = true;
    const fetchLocations = async () => {
      if (event?.location_id && event?.location_id !== null) {
        const location = await getById(event.location_id);
        setLocation(location as ISimpleLocation);
      } else {
        setLocation(initialLocation || null);
      }
    };
    fetchLocations();
    return () => {
      alive = false;
    };
  }, [event?.location_id, initialLocation]);

  const [isConfirmed, setIsConfirmed] = useState(false);
  // Domyślnie Przegląd; starsze adresy zakładek (np. z powiadomień) mapuje normalizeEventTabId.
  const [activeTab, setActiveTab] = useState<EventDetailTab>(
    () => normalizeEventTabId(searchParams.get('tab')) ?? 'overview',
  );

  const navigateToTab = useCallback(
    (requested: string) => {
      const tab = normalizeEventTabId(requested) ?? 'overview';
      setActiveTab(tab);
      const nextSearchParams = new URLSearchParams(searchParams.toString());
      nextSearchParams.set('tab', tab);
      router.replace(`/crm/events/${eventId}?${nextSearchParams.toString()}`, { scroll: false });
    },
    [eventId, router, searchParams],
  );


  useEffect(() => {
    const nextTab = normalizeEventTabId(searchParams.get('tab')) ?? 'overview';
    setActiveTab((currentTab) => (currentTab === nextTab ? currentTab : nextTab));
  }, [searchParams]);

  const [showAddChecklistModal, setShowAddChecklistModal] = useState(false);
  const [showEditEventModal, setShowEditEventModal] = useState(false);
  const [showCreateOfferModal, setShowCreateOfferModal] = useState(false);

  const [hoveredEmployee, setHoveredEmployee] = useState<string | null>(null);

  const {
    auditLog,
    stats,
    groupedByDate,
    filterByAction,
    isLoading: isLoadingAuditLog,
    getActionIcon,
    refetch: refetchAuditLog,
  } = useEventAuditLog(eventId as string, { skip: !canViewCommercialDocs });
  const [auditViewMode, setAuditViewMode] = useState<'timeline' | 'byDate'>('timeline');
  const [auditActionFilter, setAuditActionFilter] = useState<any>('all');
  const [contact, setContact] = useState<ISimpleContact | null>(initialContact || null);

  // useEffect(() => {
  //   if (eventId) {
  //     checkTeamManagementPermission();
  //   }
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [eventId]);

  // ✅ jeśli masz RTK Query do ofert (polecam) – pobieraj tylko dla osób uprawnionych
  const {
    currentData: offersData,
    isFetching: offersFetching,
    refetch: refetchOffers,
  } = useGetEventOffersQuery(eventId, {
    skip: !canLoadOffers,
    refetchOnMountOrArgChange: true,
  });

  useEffect(() => {
    if (!canLoadOffers) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      timer = setTimeout(() => { void refetchOffers(); }, 200);
    };
    const channel = supabase.channel(`event-budget-offers:${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'offers', filter: `event_id=eq.${eventId}` }, refresh)
      .subscribe();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      void supabase.removeChannel(channel);
    };
  }, [eventId, canLoadOffers, refetchOffers]);

  useEffect(() => {
    if (activeTab === 'offer' && canLoadOffers) {
      void refetchOffers();
    }
  }, [activeTab, canLoadOffers, refetchOffers]);

  const [requiredMavinciLiveModules, setRequiredMavinciLiveModules] = useState<
    MavinciLiveModuleRequirement[]
  >([]);

  const loadRequiredMavinciLiveModules = useCallback(async () => {
    if (!canViewOperations) {
      setRequiredMavinciLiveModules([]);
      return;
    }
    const { data, error } = await supabase.rpc('get_event_required_mavinci_live_modules', {
      p_event_id: eventId,
    });

    if (error) {
      if (!/does not exist|schema cache|PGRST202|42883/i.test(error.message)) {
        console.error('Error loading required Mavinci LIVE modules:', error);
      }
      setRequiredMavinciLiveModules([]);
      return;
    }

    setRequiredMavinciLiveModules((data || []) as MavinciLiveModuleRequirement[]);
  }, [eventId, canViewOperations]);

  useEffect(() => {
    void loadRequiredMavinciLiveModules();
  }, [loadRequiredMavinciLiveModules, offersData]);

  // Zakładki: obszar z bazy + zawężenie z ustawień pracownika + warunki modułów (eventTabAllowed / visibleEventTabs).
  const extraTabAllowed = useCallback(
    (tab: EventTabId) => {
      // Osoba z oczekującym / odrzuconym zaproszeniem widzi tylko Przegląd.
      if (hasLimitedAccess && !isCreator && !isAdmin) return tab === 'overview';
      if (tab === 'finances') return canViewFinanceValues;
      if (tab === 'seller-arrangements') return canViewSellerCorrespondence;
      if (tab === 'mavinci-live') return requiredMavinciLiveModules.length > 0;
      return true;
    },
    [hasLimitedAccess, isCreator, isAdmin, canViewFinanceValues, canViewSellerCorrespondence, requiredMavinciLiveModules.length],
  );
  // Jeden pasek w stałej kolejności (EVENT_TAB_IDS).
  const visibleTabs = useMemo(
    () => visibleEventTabs(access, employeeEventTabs, extraTabAllowed),
    [access, employeeEventTabs, extraTabAllowed],
  );
  const visibleTabIds = useMemo(() => new Set<EventTabId>(visibleTabs), [visibleTabs]);
  const canOpenTab = useCallback((tab: string) => visibleTabIds.has(tab as EventTabId), [visibleTabIds]);
  // Niedostępna (albo jeszcze wczytywana, np. Finanse / Mavinci LIVE) zakładka z adresu → Przegląd
  // (albo pierwsza dostępna), bez zmiany adresu.
  const effectiveTab: EventDetailTab | null = visibleTabIds.has(activeTab)
    ? activeTab
    : visibleTabIds.has('overview')
      ? 'overview'
      : visibleTabs[0] ?? null;
  const navigationTabs = useMemo<EventNavigationItem[]>(
    () =>
      visibleTabs.map(tab => ({
        id: tab,
        label: tab === 'agenda' && isWeddingEvent ? 'Karta weselna' : EVENT_TAB_LABELS[tab],
        icon: tab === 'agenda' && isWeddingEvent ? HeartHandshake : EVENT_TAB_ICONS[tab],
      })),
    [visibleTabs, isWeddingEvent],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleDeleteEvent = async () => {
    if (!event || deletingEvent) return;

    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć to wydarzenie?',
      `Wydarzenie "${event.name}" zostanie trwale usunięte wraz z całą historią, przypisaniami i plikami. Tej operacji nie można cofnąć.`,
    );

    if (!confirmed) return;

    setDeletingEvent(true);
    try {
      await deleteEventSafely(eventId);

      showSnackbar('Wydarzenie zostało usunięte', 'success');
      router.push('/crm/events');
    } catch (err: any) {
      console.error('Error:', err);
      showSnackbar(err.message || 'Wystąpił błąd podczas usuwania', 'error');
    } finally {
      setDeletingEvent(false);
    }
  };

  const [createEvent] = useCreateEventMutation();

  const handleDuplicateEvent = async () => {
    if (!event) return;

    const confirmed = await showConfirm(
      'Duplikuj wydarzenie',
      `Czy chcesz zduplikować wydarzenie "${event.name}"? Zostaną skopiowane wszystkie dane podstawowe, ale NIE zostaną skopiowane: przypisani ludzie, pliki i dokumenty.`,
    );

    if (!confirmed) return;

    try {
      if (!currentEmployee?.id) {
        throw new Error('Nie można ustalić autora kopii wydarzenia. Odśwież stronę i spróbuj ponownie.');
      }
      const duplicatedEvent: Record<string, unknown> = {
        created_by: currentEmployee.id,
        name: `${event.name} (kopia)`,
        description: event.description || null,
        event_date: event.event_date,
        event_end_date: event.event_end_date || null,
        location_id: event.location_id || null,
        status: 'draft',
        notes: event.notes || null,
        category_id: event.category_id || null,
        organization_id: event.organization_id || null,
        contact_person_id: event.contact_person_id || null,
        my_company_id: event.my_company_id || null,
        client_type: event.client_type || 'business',
        // Kwoty z event_financials, tylko z obszarem „kwoty” (zapis do events przenosi je wyzwalacz do kopii).
        expected_revenue: canViewValues ? money('expected_revenue') || null : null,
        estimated_costs: canViewValues ? money('estimated_costs') || null : null,
      };

      const result = await createEvent(duplicatedEvent as Partial<IEvent>).unwrap();

      showSnackbar('Wydarzenie zostało zduplikowane', 'success');
      router.push(`/crm/events/${result.id}`);
    } catch (err) {
      console.error('Error duplicating event:', err);
      showSnackbar('Wystąpił błąd podczas duplikowania', 'error');
    }
  };

  // const handleAddEmployee = async (
  //   employeeId: string,
  //   role: string,
  //   responsibilities: string,
  //   accessLevelId: string,
  //   permissions: any,
  // ) => {
  //   try {
  //     const {
  //       data: { session },
  //     } = await supabase.auth.getSession();

  //     const { error } = await supabase.from('employee_assignments').insert([
  //       {
  //         event_id: eventId,
  //         employee_id: employeeId,
  //         role: role,
  //         responsibilities: responsibilities || null,
  //         invited_by: session?.user?.id || null,
  //         status: 'pending',
  //         access_level_id: accessLevelId || null,
  //         can_edit_event: permissions.can_edit_event || false,
  //         can_edit_agenda: permissions.can_edit_agenda || false,
  //         can_edit_tasks: permissions.can_edit_tasks || false,
  //         can_edit_files: permissions.can_edit_files || false,
  //         can_edit_equipment: permissions.can_edit_equipment || false,
  //         can_invite_members: permissions.can_invite_members || false,
  //         can_view_budget: permissions.can_view_budget || false,
  //         granted_by: session?.user?.id || null,
  //         permissions_updated_at: new Date().toISOString(),
  //       },
  //     ]);

  //     if (error) {
  //       console.error('Error adding employee:', error);
  //       alert('Błąd podczas dodawania pracownika');
  //       return;
  //     }

  //     setShowAddEmployeeModal(false);

  //     // await logChange(
  //     //   'employee_added',
  //     //   `Dodano pracownika do zespołu (ID: ${employeeId}, rola: ${role})`,
  //     // );
  //   } catch (err) {
  //     console.error('Error:', err);
  //     alert('Wystąpił błąd');
  //   }
  // };

  const handleRemoveEmployee = async (assignmentId: string) => {
    const ok = await showConfirm('Czy na pewno chcesz usunąć tego pracownika z eventu?');
    if (!ok) return;

    try {
      const { error } = await supabase.from('employee_assignments').delete().eq('id', assignmentId);

      if (error) {
        console.error('Error removing employee:', error);
        showSnackbar('Błąd podczas usuwania pracownika', 'error');
        return;
      }

      await refetchTeam();
      refreshWorkspace('employee_assignments');
      showSnackbar('Pracownik został usunięty z eventu', 'success');
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd', 'error');
    }
  };

  const handleAddChecklist = async (task: string, priority: string) => {
    setShowAddChecklistModal(false);
  };

  const handleDeleteOffer = useCallback(
    async (offerId: string) => {
      const offer = offersData?.find((o: any) => o.id === offerId);

      if (!offer || !['draft', 'sent', 'rejected'].includes(offer.status)) {
        showSnackbar('Nie można usunąć tej oferty w tym statusie.', 'error');
        return;
      }

      setIsConfirmed(true);
      const confirmed = await showConfirm(
        'Czy na pewno chcesz usunąć tę ofertę?',
        'Tej operacji nie można cofnąć.',
      );

      if (!confirmed) {
        setIsConfirmed(false);
        return;
      }

      try {
        const result = await deleteOfferMutation({ eventId, offerId }).unwrap();
        showSnackbar('Oferta została usunięta', 'success');
      } catch (error: any) {
        console.error('Error deleting offer FULL:', error);

        const errorMessage =
          error?.data?.message || error?.error || error?.message || 'Błąd podczas usuwania oferty';

        if (errorMessage.includes('policy') || errorMessage.includes('uprawnienia')) {
          showSnackbar('Nie masz uprawnień do usunięcia tej oferty', 'error');
        } else if (
          errorMessage.includes('status') ||
          errorMessage.includes('draft/sent') ||
          errorMessage.includes('tylko draft') ||
          errorMessage.includes('Nie można usunąć tej oferty')
        ) {
          showSnackbar(
            'Nie można usunąć tej oferty. Usuwać można tylko oferty w statusie draft lub sent.',
            'error',
          );
        } else {
          showSnackbar(errorMessage, 'error');
        }
      } finally {
        setIsConfirmed(false);
      }
    },
    [eventId, offersData, deleteOfferMutation, showConfirm, showSnackbar],
  );

  const [showSendOfferModal, setShowSendOfferModal] = useState(false);
  const [selectedOfferToSend, setSelectedOfferToSend] = useState<any>(null);

  const handleSendOffer = useCallback(async () => {
    const latestOffer = offersData?.find((o) => o.status === 'draft');
    if (!latestOffer) {
      showSnackbar('Brak oferty do wysłania', 'error');
      return;
    }
    setSelectedOfferToSend(latestOffer);
    setShowSendOfferModal(true);
  }, [offersData, showSnackbar]);

  const handleOfferSent = useCallback(async () => {
    try {
      await updateEventMutation({
        id: eventId,
        data: { status: 'offer_sent' as any },
      }).unwrap();
      showSnackbar('Oferta została wysłana', 'success');
      setShowSendOfferModal(false);
      setSelectedOfferToSend(null);
    } catch (err) {
      console.error('Error updating event status:', err);
    }
  }, [eventId, updateEventMutation, showSnackbar]);

  const actions = useMemo<Action[]>(() => {
    return [
      {
        label: 'Karta imprezy',
        onClick: () => window.open(`/bridge/events/${eventId}/card`, '_blank', 'noopener'),
        icon: <Printer className="h-4 w-4" />,
        variant: 'default',
        show: canPrintCard,
      },
      {
        label: 'Edytuj',
        onClick: () => setShowEditEventModal(true),
        icon: <Edit className="h-4 w-4" />,
        variant: 'primary',
        show: canEventManage,
      },
      {
        label: 'Duplikuj',
        onClick: handleDuplicateEvent,
        icon: <Copy className="h-4 w-4" />,
        variant: 'default',
        show: canEventManage,
      },
      {
        label: 'Usuń',
        onClick: handleDeleteEvent,
        icon: <Trash2 className="h-4 w-4" />,
        variant: 'danger',
        show: isAdmin,
      },
    ];
  }, [setShowEditEventModal, handleDeleteEvent, handleDuplicateEvent, isAdmin, canEventManage, canPrintCard, eventId]);

  const latestOffer = useMemo(() => {
    if (event?.financial_source === 'calculation') return null;
    const eligible = (offersData ?? initialOffers ?? [])
      .filter(offer => ['accepted', 'sent', 'draft'].includes(offer.status));
    return eligible.sort((a, b) => {
      const acceptedPriority = Number(b.status === 'accepted') - Number(a.status === 'accepted');
      if (acceptedPriority) return acceptedPriority;
      return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
    })[0] || null;
  }, [offersData, initialOffers, event?.financial_source]);

  const budgetOfferTotals = latestOffer ? getOfferPricingTotals(latestOffer) : null;
  const plannedRevenue = budgetOfferTotals?.gross ?? Number(money('expected_revenue') || 0);
  const offerCostNet = latestOffer?.total_cost == null ? null : Number(latestOffer.total_cost);
  const offerProfitNet = budgetOfferTotals && offerCostNet != null
    ? roundMoney(budgetOfferTotals.net - offerCostNet) : null;

  const actualRevenue = Number(money('actual_revenue') || 0);

  // if (isLoading) {
  //   return (
  //     <div className="flex items-center justify-center p-8">
  //       <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
  //     </div>
  //   );
  // }

  // {
  //   error && <div className="p-4 text-sm text-red-400">{error.message}</div>;
  // }

  // if (!event) {
  //   return (
  //     <div className="flex h-screen flex-col items-center justify-center space-y-4">
  //       <div className="text-lg font-medium text-red-400">
  //         {error.message || 'Event nie został znaleziony'}
  //       </div>
  //       {error.message && (
  //         <div className="max-w-md text-center text-sm text-[#e5e4e2]/60">
  //           Sprawdź konsolę przeglądarki (F12), aby zobaczyć więcej szczegółów.
  //         </div>
  //       )}
  //       <button
  //         onClick={() => router.back()}
  //         className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
  //       >
  //         Wróć
  //       </button>
  //     </div>
  //   );
  // }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="mt-4 flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="rounded-lg p-2 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="mb-2 flex items-center gap-3">
              <h1 className="text-lg font-light text-[#e5e4e2] sm:text-xl md:text-2xl">
                {event.name}
              </h1>
            </div>

            <div className="flex flex-col items-start gap-1 text-sm text-[#e5e4e2]/60 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              {event.client_type === 'business' && canViewClient && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  {organization ? organization.alias || organization.name : 'Brak klienta'}
                </div>
              )}
              {event.client_type === 'individual' && canViewClient && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span>
                    {contact
                      ? `Klient: ${contact.full_name || `${contact.first_name} ${contact.last_name}`}`
                      : 'Brak klienta'}
                  </span>
                </div>
              )}
              {event.client_type === 'business' && contact && canViewClient && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span>
                    Kontakt: {contact.full_name || `${contact.first_name} ${contact.last_name}`}
                  </span>
                </div>
              )}
              {creator && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span>
                    Autor: {creator.name} {creator.surname}
                  </span>
                </div>
              )}

              <EventStatusSelectModal
                isOpen={showStatusModal}
                onClose={() => setShowStatusModal(false)}
                eventId={eventId}
                currentStatus={eventData?.status ?? 'inquiry'}
                onStatusChange={(newStatus: string) => {
                  updateEvent({ status: newStatus as EventStatus });
                }}
                canManage={canEventManage}
              />
            </div>
          </div>
        </div>
        <div className="flex items-start justify-start">
          <ResponsiveActionBar actions={actions} />
        </div>
      </div>

      {event.seller_confirmation_required && canViewSellerCorrespondence && event.status !== 'cancelled' && <section className="mb-5 space-y-3 rounded-xl bg-amber-300/10 p-4">
        <h2 className="text-sm uppercase text-amber-200">Oferta sprzedawcy przyjęta — wydarzenie do przygotowania</h2>
        <p className="text-sm text-white/65">Wydarzenie zostało utworzone przy akceptacji oferty. Uzupełnij harmonogram, zespół, agendę i logistykę, a następnie osobno potwierdź realizację.</p>
        {event.seller_schedule_pending && <p className="text-xs text-amber-200">Godziny są do ustalenia. Godzina 00:00 w kalendarzu jest wyłącznie oznaczeniem daty, nie ustalonym początkiem wydarzenia.</p>}
        <button type="button" onClick={() => navigateToTab('seller-arrangements')} className="rounded-lg bg-[#d3bb73]/15 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/25">Przygotowanie i potwierdzenie realizacji</button>
      </section>}

      {effectiveTab ? (
        <EventNavigation
          tabs={navigationTabs}
          activeTab={effectiveTab}
          onChange={navigateToTab}
          idPrefix="event-detail"
          panelId="event-detail-panel"
        />
      ) : (
        <section role="alert" className="flex items-start gap-3 rounded-xl bg-white/5 p-5 text-sm text-[#e5e4e2]/75">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#d3bb73]" aria-hidden />
          <div>
            <p className="font-medium text-[#e5e4e2]">Brak dostępu do danych tego wydarzenia</p>
            <p className="mt-1 text-[#e5e4e2]/60">Twój zakres nie obejmuje danych tego wydarzenia. Jeśli to pomyłka, poproś administratora o dostęp.</p>
          </div>
        </section>
      )}

      <div
        id="event-detail-panel"
        role={effectiveTab ? 'tabpanel' : undefined}
        aria-labelledby={effectiveTab ? `event-detail-tab-${effectiveTab}` : undefined}
        className="space-y-6"
      >

      {effectiveTab === 'overview' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Banner z zaproszeniem dla użytkowników z ograniczonym dostępem */}
            {hasLimitedAccess && userAssignmentStatus === 'pending' && (
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-6">
                <div className="flex items-start gap-4">
                  <AlertCircle className="mt-0.5 h-6 w-6 flex-shrink-0 text-blue-400" />
                  <div className="flex-1">
                    <h3 className="mb-2 text-lg font-medium text-blue-400">
                      Zaproszenie do zespołu wydarzenia
                    </h3>
                    <p className="mb-4 text-[#e5e4e2]/80">
                      Zostałeś zaproszony do udziału w tym wydarzeniu. Po akceptacji zaproszenia
                      uzyskasz dostęp do pełnych szczegółów wydarzenia, w tym sprzętu, zadań i
                      plików.
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={async () => {
                          const {
                            data: { session },
                          } = await supabase.auth.getSession();
                          if (!session?.user?.id) return;

                          const { data: assignment } = await supabase
                            .from('employee_assignments')
                            .select('id')
                            .eq('event_id', eventId)
                            .eq('employee_id', session.user.id)
                            .maybeSingle();

                          if (assignment) {
                            const { error: responseError } = await supabase
                              .from('employee_assignments')
                              .update({
                                status: 'accepted',
                                responded_at: new Date().toISOString(),
                              })
                              .eq('id', assignment.id)
                              .eq('status', 'pending');

                            if (responseError) { showSnackbar(responseError.message, 'error'); return; }
                            showSnackbar('Status zaproszenia został odświeżony', 'success');
                            window.location.reload();
                          }
                        }}
                        className="rounded-lg border border-green-500/30 bg-green-500/20 px-4 py-2 text-green-400 transition-colors hover:bg-green-500/30"
                      >
                        Akceptuj zaproszenie
                      </button>
                      <button
                        onClick={async () => {
                          const {
                            data: { session },
                          } = await supabase.auth.getSession();
                          if (!session?.user?.id) return;

                          const { data: assignment } = await supabase
                            .from('employee_assignments')
                            .select('id')
                            .eq('event_id', eventId)
                            .eq('employee_id', session.user.id)
                            .maybeSingle();

                          if (assignment) {
                            const { error: responseError } = await supabase
                              .from('employee_assignments')
                              .update({
                                status: 'rejected',
                                responded_at: new Date().toISOString(),
                              })
                              .eq('id', assignment.id)
                              .eq('status', 'pending');

                            if (responseError) { showSnackbar(responseError.message, 'error'); return; }
                            router.push('/crm/events');
                          }
                        }}
                        className="rounded-lg border border-red-500/30 bg-red-500/20 px-4 py-2 text-red-400 transition-colors hover:bg-red-500/30"
                      >
                        Odrzuć zaproszenie
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <EventStepsPanel
              eventId={eventId}
              onNavigate={navigateToTab}
              canOpenTab={canOpenTab}
              onUnavailable={handleStepsUnavailable}
            />
            {/* Przed wdrożeniem kroków realizacji: dotychczasowy panel kierownika realizacji. */}
            {stepsUnavailable && <RealizationPanel eventId={eventId} />}

            {canEventManage && (
              <EventPreflightPanel
                eventId={eventId}
                onNavigate={navigateToTab}
                canOpenTab={canOpenTab}
                hideCommercial={!canViewCommercialDocs}
                defaultCollapsed
              />
            )}
          </div>

          <div className="space-y-6">
            {stepsUnavailable && (
              <WarehouseHandoffPanel eventId={eventId} status={event.status} onAccepted={() => {
                setEvent(current => ({ ...current, status: 'in_preparation' }));
                void refetchTeam();
                router.refresh();
              }} />
            )}
            <EventKeyFactsCard
              eventId={eventId}
              eventDate={event.event_date}
              eventEndDate={event.event_end_date}
              schedulePending={Boolean(event.seller_schedule_pending)}
              locationName={location?.name || (typeof event.location === 'string' ? event.location : null)}
              locationAddress={location?.formatted_address || [location?.address, location?.postal_code, location?.city].filter(Boolean).join(', ') || null}
              mapsUrl={location?.google_maps_url || null}
              equipmentCount={Array.isArray(equipment) ? equipment.length : null}
              access={access}
              onNavigate={navigateToTab}
              canOpenTab={canOpenTab}
            />
          </div>
        </div>
      )}

      {effectiveTab === 'details' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className={`space-y-6 ${showDetailsAction || canViewValues ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
              <EventsDetailsTab
                canViewCommercials={canViewBilling || canViewFinanceValues}
                canViewClient={canViewClient}
                canViewOnsiteContact={canViewOnsiteContact}
                initialEvent={event}
                location={location || null}
                organization={canViewClient ? organization || null : null}
                contact={canViewClient ? contact : null}
                hasLimitedAccess={hasLimitedAccess}
                canManageTeam={canManageTeam}
                isAdmin={isAdmin}
                canEventManage={canEventManage}
                isCreator={isCreator}
              />
            </div>

            {(showDetailsAction || canViewValues) && (
              <div className="space-y-6">
                {showDetailsAction && <EventDetailsAction
                  canEditStatus={Boolean(canEventManage)}
                  event={event}
                  categories={categories}
                  hasOffers={!!offersData && offersData.length > 0}
                  offersCount={offersData?.length || 0}
                  contact={{
                    id: contact?.id || '',
                    full_name: contact?.full_name || '',
                    first_name: contact?.first_name || '',
                    last_name: contact?.last_name || '',
                    email: contact?.email || '',
                    phone: contact?.phone || '',
                  }}
                  organization={{
                    id: organization?.id || '',
                    name: organization?.name || '',
                    alias: organization?.alias || '',
                    email: organization?.email || '',
                  }}
                />}
                {canViewValues && (
                  <>
                    <div className="rounded-xl bg-[#1c1f33] p-6">
                      <div className="mb-4 flex items-center justify-between">
                        <h2 className="text-lg font-light text-[#e5e4e2]">Budżet</h2>

                        {/* opcjonalnie: status źródła */}
                        <div className="text-xs text-[#e5e4e2]/40">
                          {offersFetching
                            ? 'Aktualizuję…'
                            : latestOffer
                              ? 'Źródło: oferta'
                              : event?.financial_source === 'calculation' ? 'Źródło: kalkulacja' : 'Źródło: wydarzenie'}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <p className="text-sm text-[#e5e4e2]/60">Przychód planowany</p>
                          <p className="text-2xl font-light text-[#d3bb73]">
                            {plannedRevenue.toLocaleString('pl-PL')} zł
                          </p>

                          {latestOffer && budgetOfferTotals && (
                            <div className="mt-2 space-y-1 text-xs text-[#e5e4e2]/50">
                              <a href={`/crm/offers/${latestOffer.id}`} target="_blank" rel="noopener noreferrer" className="block text-[#d3bb73] underline">{latestOffer.status === 'accepted' ? 'Zaakceptowana oferta' : 'Wstępny plan z oferty'} {latestOffer.offer_number}</a>
                              {budgetOfferTotals.discountAmount > 0 && <>
                                <div>Przed rabatem netto: {budgetOfferTotals.listNet.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł</div>
                                <div className="text-[#d3bb73]">Rabat: −{budgetOfferTotals.discountAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł</div>
                              </>}
                              <div>Netto{budgetOfferTotals.discountAmount > 0 ? ' po rabacie' : ''}: <span className="text-[#e5e4e2]/70">{budgetOfferTotals.net.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł</span></div>
                              <div>VAT ({budgetOfferTotals.hasMixedVatRates ? 'wg stawek pozycji' : `${budgetOfferTotals.taxPercent}%`}): <span className="text-[#e5e4e2]/70">{budgetOfferTotals.taxAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł</span></div>
                              <div>Brutto: <span className="text-[#e5e4e2]/70">{budgetOfferTotals.gross.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł</span></div>
                              {latestOffer.logistics_enabled && Number(latestOffer.logistics_price_net) > 0 && <div>W cenie przed rabatem: logistyka {Number(latestOffer.logistics_price_net).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł netto.</div>}
                              <div className="pt-3">Koszty zapisane w ofercie: <span className="text-[#e5e4e2]/70">{offerCostNet == null ? 'Nie określono' : `${offerCostNet.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł netto`}</span></div>
                              {offerProfitNet != null && <div>Wynik po zapisanych kosztach: <span className={offerProfitNet < 0 ? 'text-red-300' : 'text-[#d3bb73]'}>{offerProfitNet.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł netto</span></div>}
                              {latestOffer.logistics_cost_net == null && <p className="text-amber-200">Koszt logistyki nie został jeszcze określony — koszty mogą być niepełne.</p>}
                            </div>
                          )}
                        </div>

                        <div>
                          <p className="text-sm text-[#e5e4e2]/60">Przychód faktyczny</p>
                          <p className="text-2xl font-light text-[#e5e4e2]">
                            {actualRevenue.toLocaleString('pl-PL')} zł
                          </p>
                        </div>

                        {plannedRevenue > 0 && actualRevenue > 0 && (
                          <div>
                            <p className="text-sm text-[#e5e4e2]/60">Realizacja</p>
                            <p className="text-xl font-light text-[#e5e4e2]">
                              {((actualRevenue / plannedRevenue) * 100).toFixed(1)}%
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <p className="text-xs text-[#e5e4e2]/40">{eventAccessSummary(access)}</p>
        </div>
      )}

      {effectiveTab === 'equipment' && (
        <EventEquipmentTab
          eventId={event?.id as string}
          contact={contact as ISimpleContact}
          eventDate={event?.event_date as string}
          location={
            `${location?.name}, ${location?.address}, ${location?.postal_code} ${location?.city}  ` as string
          }
          eventEndDate={event?.event_end_date as string}
          initialEvent={event}
        />
      )}

      {effectiveTab === 'team' && (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-light text-[#e5e4e2]">Zespół</h2>
            {canManageTeam && (
              <ResponsiveActionBar
                actions={[
                  {
                    label: 'Dodaj osobę',
                    onClick: () => setShowAddEmployeeModal(true),
                    icon: <Plus className="h-4 w-4" />,
                    variant: 'primary',
                  },
                ]}
                disabledBackground
              />
            )}
          </div>

          {teamEmployees?.length === 0 ? (
            <div className="py-12 text-center">
              <Users className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
              <p className="text-[#e5e4e2]/60">Brak przypisanych pracowników</p>
            </div>
          ) : (
            <TeamMembersList
              eventId={eventId}
              employees={teamEmployees}
              onRemove={handleRemoveEmployee}
              canManageTeam={canManageTeam}
              currentUserId={currentUserId}
              eventCreatorId={event?.created_by}
            />
          )}
        </div>
      )}

      {effectiveTab === 'offer' && (
        <EventTabOffer
          offers={offersData || []}
          isConfirmed={isConfirmed}
          eventStatus={event?.status || 'inquiry'}
          setShowCreateOfferModal={setShowCreateOfferModal}
          handleDeleteOffer={handleDeleteOffer}
          handleSendOffer={handleSendOffer}
        />
      )}

      {effectiveTab === 'files' && <EventFilesExplorer eventId={eventId} canViewCommercialDocs={canViewCommercialDocs} />}

      {effectiveTab === 'logistics' && event && (
        <EventLogisticsPanel
          eventId={event.id}
          eventLocation={event.location?.formatted_address || [event.location?.name, event.location?.address, event.location?.city].filter(Boolean).join(', ')}
          eventDate={event.event_date}
          canManage={canEventManage}
        />
      )}

      {effectiveTab === 'subcontractors' && <EventSubcontractorsPanel eventId={eventId} />}

      {effectiveTab === 'phases' && event && (
        <EventPhasesTimeline
          eventId={event.id}
          eventStartDate={event.event_date}
          eventEndDate={event.event_end_date || event.event_date}
          initialPlannedSetupAt={event.planned_setup_at}
          initialPlannedTeardownAt={event.planned_teardown_at}
          onContractScheduleSaved={(schedule) =>
            setEvent((current) => ({ ...current, ...schedule }))
          }
        />
      )}

      {effectiveTab === 'tasks' && event && (
        <EventTasksBoard eventId={event.id} canManage={canManageTeam} />
      )}

      {effectiveTab === 'finances' && canViewFinanceValues && <EventFinancesTab eventId={eventId} />}

      {effectiveTab === 'contract' && <EventPartnerArrangement key={eventId} eventId={eventId} canManage={!!canEventManage} hideSection={signedContractEventId === eventId}><EventContractTab eventId={eventId} canViewAmounts={canViewValues} onSignedDocumentChange={present => setSignedContractEventId(present ? eventId : null)} /></EventPartnerArrangement>}

      {effectiveTab === 'seller-arrangements' && canViewSellerCorrespondence && (
        <EventSellerCorrespondence key={eventId} eventId={eventId} />
      )}

      {effectiveTab === 'agenda' && isWeddingEvent && (
        <EventWeddingCardTab eventId={eventId} canManage={canEventManage} />
      )}

      {effectiveTab === 'agenda' && !isWeddingEvent && (
        <EventAgendaTab
          contact={contact as ContactRow | ISimpleContact}
          organization={organization as OrganizationRow}
          eventId={eventId}
          eventName={event?.name ?? ''}
          eventDate={event?.event_date ?? ''}
          startTime={event?.event_date ?? ''}
          endTime={event?.event_end_date ?? ''}
          createdById={event?.created_by ?? ''}
          canManage={Boolean(canEventManage)}
        />
      )}

      {effectiveTab === 'calculations' && (
        <EventCalculationsTab eventId={eventId} contactPerson={contact as any} />
      )}

      {effectiveTab === 'mavinci-live' && (
        <EventMavinciLiveTab
          eventId={eventId}
          eventName={event?.name || 'Wydarzenie'}
          canManage={Boolean(canEventManage)}
          employees={employees}
          requiredModules={requiredMavinciLiveModules}
        />
      )}

      {effectiveTab === 'history' && (
        <div className="space-y-6">
          {/* Nagłówek z przyciskami widoku */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-light text-[#e5e4e2]">Historia zmian</h2>
              <p className="text-sm text-[#e5e4e2]/60">
                {stats.totalEntries} zmian • {stats.uniqueUsers} użytkowników
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => refetchAuditLog()}
                className="flex items-center gap-2 rounded-lg bg-[#1c1f33] px-4 py-2 text-sm font-medium text-[#e5e4e2]/70 transition-colors hover:bg-[#1c1f33]/80 hover:text-[#e5e4e2]"
                title="Odśwież historię"
              >
                <RefreshCw className="h-4 w-4" />
                Odśwież
              </button>
              <button
                onClick={() => setAuditViewMode('timeline')}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  auditViewMode === 'timeline'
                    ? 'bg-[#d3bb73] text-[#0f1119]'
                    : 'bg-[#1c1f33] text-[#e5e4e2]/70 hover:bg-[#1c1f33]/80 hover:text-[#e5e4e2]'
                }`}
              >
                <List className="h-4 w-4" />
                Timeline
              </button>
              <button
                onClick={() => setAuditViewMode('byDate')}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  auditViewMode === 'byDate'
                    ? 'bg-[#d3bb73] text-[#0f1119]'
                    : 'bg-[#1c1f33] text-[#e5e4e2]/70 hover:bg-[#1c1f33]/80 hover:text-[#e5e4e2]'
                }`}
              >
                <CalendarIcon className="h-4 w-4" />
                Po dacie
              </button>
            </div>
          </div>

          {/* Filtry akcji */}
          {auditViewMode === 'timeline' && (
            <div className="flex flex-wrap gap-2 rounded-lg bg-[#1c1f33] p-4">
              <button
                onClick={() => setAuditActionFilter('all')}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  auditActionFilter === 'all'
                    ? 'bg-[#d3bb73] text-[#0f1119]'
                    : 'bg-[#0f1119] text-[#e5e4e2]/70 hover:bg-[#0f1119]/80 hover:text-[#e5e4e2]'
                }`}
              >
                Wszystkie ({stats.totalEntries})
              </button>

              {['create', 'update', 'delete', 'status_changed'].map((actionType) => {
                const count = stats.actionCounts[actionType] || 0;
                if (count === 0) return null;

                const labels: Record<string, string> = {
                  create: 'Utworzenia',
                  update: 'Aktualizacje',
                  delete: 'Usunięcia',
                  status_changed: 'Zmiany statusu',
                };

                return (
                  <button
                    key={actionType}
                    onClick={() => setAuditActionFilter(actionType)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                      auditActionFilter === actionType
                        ? 'bg-[#d3bb73] text-[#0f1119]'
                        : 'bg-[#0f1119] text-[#e5e4e2]/70 hover:bg-[#0f1119]/80 hover:text-[#e5e4e2]'
                    }`}
                  >
                    {labels[actionType]} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {isLoadingAuditLog ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <RefreshCw className="mx-auto h-8 w-8 animate-spin text-[#d3bb73]" />
                <p className="mt-2 text-[#e5e4e2]/60">Ładowanie historii zmian...</p>
              </div>
            </div>
          ) : auditLog.length === 0 ? (
            <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-8 text-center">
              <History className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/20" />
              <p className="text-[#e5e4e2]/60">Brak historii zmian</p>
            </div>
          ) : (
            <>
              {/* Widok Timeline */}
              {auditViewMode === 'timeline' &&
                (() => {
                  const displayedLogs =
                    auditActionFilter === 'all' ? auditLog : filterByAction([auditActionFilter]);

                  return (
                    <div className="relative">
                      <div className="absolute bottom-4 left-[27px] top-4 w-0.5 bg-gradient-to-b from-[#d3bb73]/20 via-[#d3bb73]/10 to-transparent"></div>

                      <div className="space-y-6">
                        {displayedLogs.map((entry) => {
                          const IconComponent = (Icons as any)[entry.actionIcon] || Activity;
                          const employee = entry.employee;

                          const colorClasses: Record<
                            string,
                            { bg: string; text: string; border: string }
                          > = {
                            green: {
                              bg: 'bg-green-500/20',
                              text: 'text-green-400',
                              border: 'border-green-500/30',
                            },
                            blue: {
                              bg: 'bg-blue-500/20',
                              text: 'text-blue-400',
                              border: 'border-blue-500/30',
                            },
                            red: {
                              bg: 'bg-red-500/20',
                              text: 'text-red-400',
                              border: 'border-red-500/30',
                            },
                            purple: {
                              bg: 'bg-purple-500/20',
                              text: 'text-purple-400',
                              border: 'border-purple-500/30',
                            },
                            orange: {
                              bg: 'bg-orange-500/20',
                              text: 'text-orange-400',
                              border: 'border-orange-500/30',
                            },
                            cyan: {
                              bg: 'bg-cyan-500/20',
                              text: 'text-cyan-400',
                              border: 'border-cyan-500/30',
                            },
                            teal: {
                              bg: 'bg-teal-500/20',
                              text: 'text-teal-400',
                              border: 'border-teal-500/30',
                            },
                            gray: {
                              bg: 'bg-gray-500/20',
                              text: 'text-gray-400',
                              border: 'border-gray-500/30',
                            },
                          };

                          const colorClass = colorClasses[entry.actionColor] || colorClasses.gray;

                          return (
                            <div key={entry.id} className="relative pl-16">
                              <div className="absolute left-0 top-0">
                                <div className="group relative">
                                  {employee ? (
                                    <button
                                      onClick={() => router.push(`/crm/employees/${employee.id}`)}
                                      onMouseEnter={() => setHoveredEmployee(entry.id)}
                                      onMouseLeave={() => setHoveredEmployee(null)}
                                      className="relative"
                                    >
                                      <EmployeeAvatar
                                        employee={employee as IEmployee}
                                        size={56}
                                        className="cursor-pointer ring-4 ring-[#0f1119] transition-all hover:ring-[#d3bb73]/30"
                                      />
                                      <div
                                        className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-[#0f1119] ${colorClass.bg}`}
                                      >
                                        <IconComponent className={`h-3 w-3 ${colorClass.text}`} />
                                      </div>

                                      {hoveredEmployee === entry.id && (
                                        <div className="animate-in fade-in slide-in-from-left-2 absolute left-full top-0 z-50 ml-4 min-w-[280px] rounded-xl border border-[#d3bb73]/30 bg-[#1c1f33] p-4 shadow-xl">
                                          <div className="flex items-start gap-3">
                                            <EmployeeAvatar
                                              employee={employee as IEmployee}
                                              size={48}
                                            />
                                            <div>
                                              <p className="font-medium text-[#e5e4e2]">
                                                {entry.displayUser}
                                              </p>
                                              {employee.occupation && (
                                                <p className="text-sm text-[#e5e4e2]/60">
                                                  {employee.occupation}
                                                </p>
                                              )}
                                              {employee.email && (
                                                <div className="mt-2 flex items-center gap-1 text-xs text-[#e5e4e2]/50">
                                                  <Mail className="h-3 w-3" />
                                                  <span>{employee.email}</span>
                                                </div>
                                              )}
                                              <div className="mt-3 border-t border-[#d3bb73]/10 pt-3">
                                                <p className="text-xs text-[#d3bb73]">
                                                  Kliknij aby przejść do profilu
                                                </p>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </button>
                                  ) : (
                                    <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#d3bb73]/20 to-[#d3bb73]/5 ring-4 ring-[#0f1119]">
                                      <User className="h-6 w-6 text-[#d3bb73]/60" />
                                      <div
                                        className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-[#0f1119] ${colorClass.bg}`}
                                      >
                                        <IconComponent className={`h-3 w-3 ${colorClass.text}`} />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div
                                className={`rounded-xl border ${colorClass.border} bg-[#1c1f33] p-4 transition-all hover:border-[#d3bb73]/40 hover:shadow-lg`}
                              >
                                <div className="mb-2 flex items-start justify-between gap-4">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className={`font-semibold ${colorClass.text}`}>
                                        {entry.actionLabel}
                                      </span>
                                      {entry.entityTypeLabel && (
                                        <span className="rounded-full bg-[#d3bb73]/10 px-2 py-1 text-xs text-[#d3bb73]">
                                          {entry.entityTypeLabel}
                                        </span>
                                      )}
                                    </div>

                                    <p className="mt-1.5 text-base text-[#e5e4e2]">
                                      {entry.displayDescription}
                                    </p>

                                    <div className="mt-2.5 flex items-center gap-2 text-xs text-[#e5e4e2]/50">
                                      <User className="h-3 w-3" />
                                      <span className="font-medium text-[#d3bb73]">
                                        {entry.displayUser}
                                      </span>
                                      <span>•</span>
                                      <Clock className="h-3 w-3" />
                                      <span>{entry.timeAgo}</span>
                                    </div>
                                  </div>

                                  <div className="flex-shrink-0 text-right">
                                    <div className="text-xs text-[#e5e4e2]/40">
                                      {entry.formattedDate}
                                    </div>
                                  </div>
                                </div>

                                {entry.hasChanges &&
                                  entry.action !== 'created' &&
                                  entry.action !== 'deleted' && (
                                    <div className="mt-3 space-y-2 border-t border-[#d3bb73]/10 pt-3">
                                      {entry.old_value !== null && (
                                        <div className="flex items-start gap-2 text-sm">
                                          <Icons.Minus className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
                                          <div className="flex-1">
                                            <span className="text-[#e5e4e2]/60">Przed: </span>
                                            <span className="text-red-400">
                                              {formatAuditValue(entry.old_value)}
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                      {entry.new_value !== null && (
                                        <div className="flex items-start gap-2 text-sm">
                                          <Icons.Plus className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-400" />
                                          <div className="flex-1">
                                            <span className="text-[#e5e4e2]/60">Po: </span>
                                            <span className="text-green-400">
                                              {formatAuditValue(entry.new_value)}
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

              {/* Widok po dacie */}
              {auditViewMode === 'byDate' && (
                <div className="space-y-6">
                  {Object.entries(groupedByDate).map(([date, entries]) => (
                    <div key={date}>
                      <div className="mb-3 flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-[#e5e4e2]">{date}</h3>
                        <span className="rounded-full bg-[#d3bb73]/20 px-3 py-1 text-xs font-medium text-[#d3bb73]">
                          {entries.length} zmian
                        </span>
                      </div>

                      <div className="space-y-2">
                        {entries.map((entry) => {
                          const IconComponent = (Icons as any)[entry.actionIcon] || Activity;

                          return (
                            <div
                              key={entry.id}
                              className="flex items-start gap-3 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-3 transition-all hover:border-[#d3bb73]/40 hover:shadow-lg"
                            >
                              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/10">
                                <IconComponent className="h-4 w-4 text-[#d3bb73]" />
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium text-[#e5e4e2]">
                                    {entry.actionLabel}
                                  </span>
                                  <span className="flex-shrink-0 text-xs text-[#e5e4e2]/40">
                                    {entry.timeAgo}
                                  </span>
                                </div>

                                <p className="mt-1 text-sm text-[#e5e4e2]/70">
                                  {entry.displayDescription}
                                </p>

                                <p className="mt-1 text-xs text-[#e5e4e2]/50">
                                  {entry.displayUser}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
      </div>

      {showAddEmployeeModal && (
        <AddEventEmployeeModal
          isOpen={showAddEmployeeModal}
          onClose={() => {
            setShowAddEmployeeModal(false);
            void refetchTeam();
            refreshWorkspace('employee_assignments');
          }}
          eventId={eventId}
        />
      )}

      {showAddChecklistModal && (
        <AddChecklistModal
          isOpen={showAddChecklistModal}
          onClose={() => setShowAddChecklistModal(false)}
          onAdd={handleAddChecklist}
        />
      )}

      {showEditEventModal && event && (
        <EditEventModalNew
          contact={contact}
          location={location}
          isOpen={showEditEventModal}
          onClose={() => setShowEditEventModal(false)}
          // Budżet z event_financials; pole budżetu tylko z obszarem „kwoty”.
          event={{ ...event, budget: money('budget') ?? undefined }}
          canEditBudget={canViewValues}
          onSave={async (updatedData) => {
            try {
              const { error } = await supabase.from('events').update(updatedData).eq('id', eventId);

              if (error) {
                console.error('Error updating event:', error);
                showSnackbar('Błąd podczas aktualizacji eventu', 'error');
                return;
              }

              setEvent((prev) => ({
                ...prev,
                ...updatedData,
              }));
              if ('budget' in updatedData) void reloadFinancials();

              if (updatedData.location_id !== event.location_id) {
                const newLocation = await getById(updatedData.location_id);
                setLocation(newLocation as ISimpleLocation);
              }

              // 1) instant UI (cache update)
              dispatch(
                eventsApi.util.updateQueryData('getEventById', eventId, (draft: any) => {
                  Object.assign(draft, updatedData);
                }) as any,
              );

              // 2) pewniak – wymuś prawdziwy refetch
              await dispatch(
                eventsApi.endpoints.getEventById.initiate(eventId, { forceRefetch: true }) as any,
              );

              setShowEditEventModal(false);
              showSnackbar('Wydarzenie zaktualizowane', 'success');
            } catch (err) {
              console.error('Error:', err);
              showSnackbar('Wystąpił błąd', 'error');
            }
          }}
        />
      )}

      {showCreateOfferModal && event && (
        <OfferWizard
          isOpen={showCreateOfferModal}
          onClose={() => {
            setShowCreateOfferModal(false);
          }}
          eventId={eventId}
          organizationId={event.organization_id || ''}
          contactId={event.contact_person_id || ''}
          clientType={event?.client_type || 'business'}
          onSuccess={() => {
            setShowCreateOfferModal(false);
            navigateToTab('offer');
          }}
        />
      )}

      {showSendOfferModal && selectedOfferToSend && event && (
        <SendOfferEmailModal
          offerId={selectedOfferToSend.id}
          offerNumber={selectedOfferToSend.offer_number}
          eventId={eventId}
          clientEmail={event.contact_person?.email || ''}
          clientName={event.contact_person?.full_name || event.organization?.name || ''}
          onClose={() => {
            setShowSendOfferModal(false);
            setSelectedOfferToSend(null);
          }}
          onSent={handleOfferSent}
        />
      )}
    </div>
  );
}
