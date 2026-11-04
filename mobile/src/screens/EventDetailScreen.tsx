import { openInCrmWeb } from '../navigation/navigationRef';
import { isEventOrganizer, showEventInvitation } from '../lib/eventInvitation';
import RealizationActions from '../components/Events/RealizationActions';
import { useOperationalStages } from '../hooks/useOperationalStages';
import { OPERATIONAL_LABELS, usesOperationalStages } from '../lib/operationalStages';
import RealizationWorkspace from '../components/Events/RealizationWorkspace';
import EventCardButton from '../components/Events/EventCardButton';
import { respondToAssignment } from '../services/assignmentResponse';
import WarehouseHandoffPanel from '../components/Events/WarehouseHandoffPanel';
import EventStepsPanel, { type EventStepRowLink } from '../components/Events/EventStepsPanel';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useForegroundEffect } from '../hooks/useForegroundEffect';
import { createRefreshQueue } from '../lib/refreshQueue';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { Employee, supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { STATUS_COLORS, STATUS_LABELS } from './EventsScreen';
import {
  ChecklistItem,
  ChecklistTab,
  EventEquipmentItem,
  LogisticsItem,
} from '@/components/Events/EventDetailScreen/ChecklistTab';
import { EventFile, FilesTab, withEventFolderPaths } from '@/components/Events/EventDetailScreen/FilesTab';
import { AgendaData, AgendaTab } from '@/components/Events/EventDetailScreen/AgendaTab';
import {
  DetailsTab,
  EventBillingContact,
  EventDetail,
} from '@/components/Events/EventDetailScreen/DetailsTab';
import { EventVehicleAssignment, FleetTab } from '@/components/Events/EventDetailScreen/FleetTab';
import { TeamTab } from '@/components/Events/EventDetailScreen/TeamTab';
import {
  WeddingCardData,
  WeddingCardTab,
} from '@/components/Events/EventDetailScreen/WeddingCardTab';
import { mergeEventTeam } from '../lib/eventTeam';
import { isManagerOrAdmin } from '../lib/permissions';
import { fetchEventCommercialsAccess } from '../lib/eventCommercialsAccess';
import {
  type EventAccessResult,
  type EventDetailVisibility,
  type EventOnsiteContact,
  eventDetailVisibility,
  fetchEventAccess,
  fetchEventAmounts,
  fetchEventOnsiteContacts,
  fetchEventSalesOverview,
} from '../lib/eventDetailAccess';
import type { EventSalesOverview } from '../lib/eventAccess';
import { SalesColleagueEventView } from '@/components/Events/EventDetailScreen/SalesColleagueEventView';
import { eventStepDetailLink } from '../lib/eventStepLinks';
import type { EventStep } from '../lib/eventSteps';

type TabKey = 'warehouse' | 'details' | 'agenda' | 'wedding' | 'checklist' | 'team' | 'fleet' | 'files';

interface Props {
  eventId: string;
  onBack: () => void;
  initialTab?: TabKey;
  /** Pulpit realizacji jest dostępny (kierownik realizacji / prowadzenie realizacji) — można wydrukować kartę imprezy. */
  canPrintCard?: boolean;
}

interface MyAssignment {
  id: string;
  status: string;
  role: string | null;
}

function StandardEventDetailScreen({ eventId, onBack, initialTab, canPrintCard }: Props) {
  const { employee, session } = useAuth();
  const canManageEvent = isManagerOrAdmin(employee);
  const isWarehouseWorker = employee?.permissions?.includes('equipment_manage') === true;
  const [warehouseAccess, setWarehouseAccess] = useState<{ eventId: string; employeeId: string; allowed: boolean } | null>(null);
  const showWarehouseTab = isWarehouseWorker && warehouseAccess?.eventId === eventId
    && warehouseAccess?.employeeId === employee?.id && warehouseAccess?.allowed === true;
  // Obszary danych wydarzenia (get_event_access) — te same co w CRM. Przed wdrożeniem migracji (brak RPC) i przy
  // chwilowym błędzie dane rozliczeniowe i kwoty wynikają z can_view_event_commercials — pobieranego razem
  // z obszarami (nie przez zależności hooków, żeby nie przeładowywać ekranu drugi raz).
  const [accessState, setAccessState] = useState<{
    eventId: string;
    result: EventAccessResult;
    commercials: boolean;
  } | null>(null);
  const accessResult = accessState?.eventId === eventId ? accessState.result : null;
  const visibility = eventDetailVisibility(
    accessResult,
    Boolean(accessState && accessState.eventId === eventId && accessState.commercials),
  );
  const [onsiteContacts, setOnsiteContacts] = useState<EventOnsiteContact[] | null>(null);
  // Wydarzenie innego sprzedawcy: tylko podgląd sprzedaży (get_event_sales_overview), bez pozostałych odczytów.
  const [salesOverview, setSalesOverview] = useState<{ eventId: string; data: EventSalesOverview | null } | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab && initialTab !== 'warehouse' ? initialTab : 'details');
  useEffect(() => {
    setActiveTab(initialTab === 'warehouse' && !showWarehouseTab ? 'details' : initialTab ?? 'details');
  }, [eventId, initialTab, showWarehouseTab]);
  const [event, setEvent] = useState<EventDetail | null>(null);
  useEffect(() => {
    let active = true;
    if (!isWarehouseWorker || !employee?.id) return;
    const employeeId = employee.id;
    void supabase.rpc('can_prepare_warehouse_event', { p_event_id: eventId }).then(({ data, error }) => {
      if (active) setWarehouseAccess({ eventId, employeeId, allowed: !error && data === true });
    });
    return () => { active = false; };
  }, [eventId, employee?.id, isWarehouseWorker, event?.status]);

  const operational = usesOperationalStages(employee);
  const {stage: displayStatus} = useOperationalStages(event ? [{id:eventId,status:event.status}] : [],operational);
  const [agenda, setAgenda] = useState<AgendaData | null>(null);
  const [weddingCard, setWeddingCard] = useState<WeddingCardData | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [eventEquipment, setEventEquipment] = useState<EventEquipmentItem[]>([]);
  const [logistics, setLogistics] = useState<LogisticsItem[]>([]);
  const [files, setFiles] = useState<EventFile[]>([]);
  const [fleetAssignments, setFleetAssignments] = useState<EventVehicleAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checklistPdfPath, setChecklistPdfPath] = useState<string | null>(null);
  const [myAssignment, setMyAssignment] = useState<MyAssignment | null>(null);
  const [respondingInvitation, setRespondingInvitation] = useState(false);
  const [showAcceptedFeedback, setShowAcceptedFeedback] = useState(false);
  const [canViewPrivateFiles, setCanViewPrivateFiles] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stepsRefreshKey, setStepsRefreshKey] = useState(0);
  const isWeddingEvent =
    Boolean(weddingCard) ||
    event?.category_name?.trim().toLocaleLowerCase('pl-PL').startsWith('wesel') === true;

  const fetchMyAssignment = useCallback(async () => {
    if (!employee?.id) return null;

    const { data: assignment } = await supabase
      .from('employee_assignments')
      .select('id, status, role')
      .eq('event_id', eventId)
      .eq('employee_id', employee.id)
      .maybeSingle();

    return assignment
      ? { id: assignment.id, status: assignment.status, role: assignment.role }
      : null;
  }, [employee?.id, eventId]);

  const respondToInvitation = async (newStatus: 'accepted' | 'rejected') => {
    if (!myAssignment || !event || !showEventInvitation(event.created_by, employee?.id, session?.user.id, myAssignment.status)) return;
    setRespondingInvitation(true);
    try {
      const current = await respondToAssignment(myAssignment.id, newStatus);
      setMyAssignment(current);
      setShowAcceptedFeedback(current.status === 'accepted');
    } catch (error: any) {
      Alert.alert('Nie udało się zapisać', error.message || 'Spróbuj ponownie.');
    } finally {
      setRespondingInvitation(false);
    }
  };

  const handleAccept = () => {
    Alert.alert(
      'Akceptacja zaproszenia',
      'Czy na pewno chcesz zaakceptować zaproszenie do tego wydarzenia?',
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Akceptuj', onPress: () => respondToInvitation('accepted') },
      ],
    );
  };

  const handleReject = () => {
    Alert.alert(
      'Odrzucenie zaproszenia',
      'Czy na pewno chcesz odrzucić zaproszenie do tego wydarzenia?',
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Odrzuć', style: 'destructive', onPress: () => respondToInvitation('rejected') },
      ],
    );
  };

  const fetchEvent = useCallback(async (access: EventDetailVisibility) => {
    const billingContext = access.billing;
    // Kwoty: przed migracją obszarów z kolumn `events`, potem wyłącznie z `event_financials` (obszar „kwoty”).
    const legacyAmounts = access.mode === 'legacy' && access.values;
    // Nazwa organizacji klienta: dane klienta albo nabywca w rozliczeniu (gdy nie wskazano osobnego płatnika).
    const withClientOrganization = access.client || billingContext;
    const { data, error } = await supabase
      .from('events')
      .select(
        `
        id, name, description, event_date, event_end_date, status, created_by,
        ${billingContext ? 'notes, billing_arrangement, billing_organization_id,' : ''}
        ${legacyAmounts ? 'expected_revenue, budget,' : ''}
        equipment_checklist_pdf_path, equipment_checklist_notes, location,
        loading_confirmed, loading_confirmed_at, loading_confirmed_by, loading_notes,
        loading_locked, loading_unlock_requested, loading_unlock_requested_at,
        loading_unlock_requested_by, loading_unlock_reason,
        event_categories(name, color),
        locations(name, formatted_address, address, city, postal_code, country, latitude, longitude, google_place_id),
        ${withClientOrganization ? 'client_organization:organizations!events_organization_id_fkey(id, name, alias),' : ''}
        ${billingContext ? 'billing_organization:organizations!events_billing_organization_id_fkey(id, name, alias),' : ''}
        ${access.client ? 'client_contact:contacts!events_contact_person_id_fkey(id, first_name, last_name, phone, mobile, email),' : ''}
        creator:employees!created_by(name, surname)
      `,
      )
      .eq('id', eventId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    const amounts = legacyAmounts
      ? { expected_revenue: (data as any).expected_revenue ?? null, budget: (data as any).budget ?? null }
      : access.values
        ? await fetchEventAmounts(eventId)
        : { expected_revenue: null, budget: null };

    setChecklistPdfPath((data as any).equipment_checklist_pdf_path || null);

    const { data: assignments, error: teamError } = await supabase
      .from('employee_assignments')
      .select(
        'role, responsibilities, status, employee:employees!employee_assignments_employee_id_fkey(id, name, surname, nickname, occupation, avatar_url, avatar_metadata, phone_number, email)',
      )
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });

    if (teamError) throw teamError;
    const responsibilityResult = await supabase.rpc('get_event_responsibility_team', { p_event_id: eventId });
    if (responsibilityResult.error) throw responsibilityResult.error;
    const rawLocation = (data as any).locations;
    const loc = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
    const locationAddress =
      loc?.formatted_address?.trim() ||
      [
        loc?.address,
        [loc?.postal_code, loc?.city].filter(Boolean).join(' '),
        loc?.address || loc?.city ? loc?.country : null,
      ]
        .filter(Boolean)
        .join(', ') ||
      null;
    const rawClientOrganization = (data as any).client_organization;
    const rawBillingOrganization = (data as any).billing_organization;
    const rawClientContact = (data as any).client_contact;
    const org = Array.isArray(rawClientOrganization)
      ? rawClientOrganization[0]
      : rawClientOrganization;
    const billingOrg = Array.isArray(rawBillingOrganization)
      ? rawBillingOrganization[0]
      : rawBillingOrganization;
    const contact = Array.isArray(rawClientContact) ? rawClientContact[0] : rawClientContact;
    const cat = (data as any).event_categories;
    const creatorData = (data as any).creator;
    const creatorName = creatorData
      ? [creatorData.name, creatorData.surname].filter(Boolean).join(' ')
      : null;

    let billingContacts: EventBillingContact[] = [];
    if (billingContext && (data as any).billing_organization_id) {
      const { data: billingContactRows, error: billingContactsError } = await supabase
        .from('event_billing_contacts')
        .select(
          'is_primary, contact:contacts!event_billing_contacts_contact_id_fkey(id, first_name, last_name, full_name, phone, mobile, email)',
        )
        .eq('event_id', eventId)
        .order('is_primary', { ascending: false });

      if (billingContactsError) {
        console.warn('Error loading event billing contacts:', billingContactsError);
      } else {
        billingContacts = (billingContactRows || [])
          .map((row: any) => {
            const embeddedContact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
            if (!embeddedContact?.id) return null;
            return {
              id: embeddedContact.id,
              name:
                embeddedContact.full_name ||
                [embeddedContact.first_name, embeddedContact.last_name].filter(Boolean).join(' ') ||
                'Kontakt rozliczeniowy',
              phone: embeddedContact.mobile || embeddedContact.phone || null,
              email: embeddedContact.email || null,
              is_primary: row.is_primary === true,
            } as EventBillingContact;
          })
          .filter((contact): contact is EventBillingContact => Boolean(contact));
      }
    }

    return {
      id: data.id,
      name: data.name,
      description: data.description,
      event_date: data.event_date,
      event_end_date: data.event_end_date,
      status: data.status,
      notes: (data as any).notes ?? null,
      expected_revenue: typeof amounts.expected_revenue === 'number' ? amounts.expected_revenue : null,
      budget: typeof amounts.budget === 'number' ? amounts.budget : null,
      category_name: cat?.name ?? null,
      category_color: cat?.color ?? null,
      location_name: loc?.name || (data as any).location || null,
      location_address: locationAddress,
      location_latitude: loc?.latitude ?? null,
      location_longitude: loc?.longitude ?? null,
      location_google_place_id: loc?.google_place_id ?? null,
      organization_name: org?.alias || org?.name || null,
      organization_id: org?.id ?? null,
      billing_arrangement: (data as any).billing_arrangement || 'direct',
      billing_organization_name: billingOrg?.alias || billingOrg?.name || null,
      billing_organization_id: (data as any).billing_organization_id ?? null,
      billing_contacts: billingContacts,
      contact_name: contact
        ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || null
        : null,
      contact_id: contact?.id ?? null,
      contact_phone: contact?.mobile || contact?.phone || null,
      contact_email: contact?.email ?? null,
      creator_name: creatorName,
      created_by: (data as any).created_by ?? null,
      loading_confirmed: (data as any).loading_confirmed ?? false,
      loading_confirmed_at: (data as any).loading_confirmed_at ?? null,
      loading_confirmed_by: (data as any).loading_confirmed_by ?? null,
      loading_notes: (data as any).loading_notes ?? null,
      equipment_checklist_notes: (data as any).equipment_checklist_notes ?? null,
      loading_locked: (data as any).loading_locked ?? false,
      loading_unlock_requested: (data as any).loading_unlock_requested ?? false,
      loading_unlock_requested_at: (data as any).loading_unlock_requested_at ?? null,
      loading_unlock_requested_by: (data as any).loading_unlock_requested_by ?? null,
      loading_unlock_reason: (data as any).loading_unlock_reason ?? null,
      employees: mergeEventTeam(assignments || [], responsibilityResult.data || []),
    } as EventDetail;
  }, [eventId]);

  /** Obszary osoby na wydarzeniu; zapisuje wynik i zwraca sekcje do pokazania. */
  const resolveAccess = useCallback(async (): Promise<EventDetailVisibility> => {
    const result = await fetchEventAccess(eventId);
    // Dotychczasowa reguła (can_view_event_commercials) tylko bez obszarów z bazy.
    const commercials = result.mode === 'ready' ? false : await fetchEventCommercialsAccess(eventId).catch(() => false);
    setAccessState({ eventId, result, commercials });
    return eventDetailVisibility(result, commercials);
  }, [eventId]);

  /** „Kontakt na miejscu” — tylko gdy osoba nie widzi pełnych danych klienta. */
  const fetchOnsiteContacts = useCallback(
    (access: EventDetailVisibility) =>
      access.onsiteContact && !access.client ? fetchEventOnsiteContacts(eventId) : Promise.resolve(null),
    [eventId],
  );

  const refreshEventState = useCallback(async () => {
    try {
      const access = await resolveAccess();
      if (access.salesColleague) {
        setSalesOverview({ eventId, data: await fetchEventSalesOverview(eventId) });
        return;
      }
      const [nextEvent, nextOnsite] = await Promise.all([fetchEvent(access), fetchOnsiteContacts(access)]);
      if (nextEvent) setEvent(nextEvent);
      setOnsiteContacts(nextOnsite);
    } catch (error) {
      console.error('Error refreshing event:', error);
    }
  }, [eventId, fetchEvent, fetchOnsiteContacts, resolveAccess]);

  const fetchWeddingCard = useCallback(async (): Promise<WeddingCardData | null> => {
    const { data: card, error: cardError } = await supabase
      .from('wedding_cards')
      .select('id,status,progress,updated_at')
      .eq('event_id', eventId)
      .maybeSingle();

    if (cardError) throw cardError;
    if (!card) return null;

    const [
      answersResult,
      peopleResult,
      scheduleResult,
      tracksResult,
      attractionsResult,
      pdfResult,
    ] = await Promise.all([
      supabase
        .from('wedding_card_answers')
        .select('id,section,field_key,value')
        .eq('wedding_card_id', card.id),
      supabase
        .from('wedding_card_people')
        .select(
          'id,side,role,first_name,last_name,phone,email,instagram_handle,instagram_tag_consent,notes',
        )
        .eq('wedding_card_id', card.id)
        .order('side')
        .order('sort_order'),
      supabase
        .from('wedding_schedule_items')
        .select('id,title,scheduled_at,category,location,responsible_person,notes,is_confirmed')
        .eq('wedding_card_id', card.id)
        .order('scheduled_at', { ascending: true, nullsFirst: false })
        .order('sort_order'),
      supabase
        .from('wedding_music_tracks')
        .select('id,list_type,title,artist,notes')
        .eq('wedding_card_id', card.id)
        .order('sort_order'),
      supabase
        .from('wedding_attraction_choices')
        .select('id,attraction_key,attraction_name,choice,notes')
        .eq('wedding_card_id', card.id)
        .order('attraction_name'),
      supabase
        .from('event_files')
        .select('file_path')
        .eq('event_id', eventId)
        .like('file_path', `${eventId}/documents/wedding-card/%`)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const contentError = [
      answersResult,
      peopleResult,
      scheduleResult,
      tracksResult,
      attractionsResult,
    ].find((result) => result.error)?.error;
    if (contentError) throw contentError;

    return {
      id: card.id,
      status: card.status as WeddingCardData['status'],
      progress: Number(card.progress || 0),
      updated_at: card.updated_at || null,
      pdf_path: pdfResult.data?.file_path || null,
      answers: (answersResult.data || []) as WeddingCardData['answers'],
      people: (peopleResult.data || []) as WeddingCardData['people'],
      schedule: (scheduleResult.data || []) as WeddingCardData['schedule'],
      tracks: (tracksResult.data || []) as WeddingCardData['tracks'],
      attractions: (attractionsResult.data || []) as WeddingCardData['attractions'],
    };
  }, [eventId]);

  const refreshWeddingCard = useCallback(async () => {
    try {
      setWeddingCard(await fetchWeddingCard());
    } catch (error) {
      console.error('Error refreshing wedding card:', error);
    }
  }, [fetchWeddingCard]);

  const fetchAgenda = useCallback(async (): Promise<AgendaData | null> => {
    const { data: agendaRow, error: agendaError } = await supabase
      .from('event_agendas')
      .select('*')
      .eq('event_id', eventId)
      .maybeSingle();

    if (agendaError || !agendaRow) return null;

    const { data: items } = await supabase
      .from('event_agenda_items')
      .select('*')
      .eq('agenda_id', agendaRow.id)
      .order('order_index', { ascending: true });

    const { data: notes } = await supabase
      .from('event_agenda_notes')
      .select('*')
      .eq('agenda_id', agendaRow.id)
      .order('order_index', { ascending: true });

    return {
      id: agendaRow.id,
      event_name: agendaRow.event_name,
      start_time: agendaRow.start_time,
      end_time: agendaRow.end_time,
      client_contact: agendaRow.client_contact,
      generated_pdf_path: agendaRow.generated_pdf_path || null,
      items: (items || []).map((item: any) => ({
        id: item.id,
        time: item.time,
        title: item.title,
        description: item.description,
        order_index: item.order_index,
      })),
      notes: (notes || []).map((note: any) => ({
        id: note.id,
        content: note.content,
        order_index: note.order_index,
        level: note.level,
        parent_id: note.parent_id,
      })),
    };
  }, [eventId]);

  const fetchChecklist = useCallback(async () => {
    const [checklistRes, logisticsRes, equipmentRes] = await Promise.all([
      supabase
        .from('event_loading_checklist')
        .select('*, vehicles(name)')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('event_logistics_timeline')
        .select('*, responsible_employee:employees!responsible_employee_id(name, surname)')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('event_equipment')
        .select(
          'id, quantity, status, is_loaded, equipment_id, kit_id, removed_from_offer, equipment:equipment_items(name, thumbnail_url, category:warehouse_categories(name)), kit:equipment_kits(name, thumbnail_url)',
        )
        .eq('event_id', eventId)
        .or('removed_from_offer.is.null,removed_from_offer.eq.false')
        .order('created_at', { ascending: true }),
    ]);

    const mappedChecklist: ChecklistItem[] = (checklistRes.data || []).map((item: any) => ({
      id: item.id,
      item_name: item.item_name,
      quantity: item.quantity,
      loaded: item.loaded ?? false,
      unloaded: item.unloaded ?? false,
      priority: item.priority,
      vehicle_name: item.vehicles?.name ?? null,
      notes: item.notes,
      sort_order: item.sort_order ?? 0,
    }));

    const mappedLogistics: LogisticsItem[] = (logisticsRes.data || []).map((item: any) => ({
      id: item.id,
      title: item.title || item.description || '',
      description: item.description,
      activity_type: item.activity_type,
      start_time: item.start_time,
      end_time: item.end_time,
      status: item.status,
      responsible_employee: item.responsible_employee,
      sort_order: item.sort_order ?? 0,
    }));

    const mappedEquipment: EventEquipmentItem[] = (equipmentRes.data || []).map((item: any) => ({
      id: item.id,
      equipment_name: item.equipment?.name || item.kit?.name || 'Nieznany sprzęt',
      quantity: item.quantity || 1,
      status: item.status,
      kit_name: item.kit?.name ?? null,
      category_name: item.equipment?.category?.name ?? null,
      thumbnail_url: item.equipment?.thumbnail_url || item.kit?.thumbnail_url || null,
      is_loaded: item.is_loaded ?? false,
    }));

    return { checklist: mappedChecklist, logistics: mappedLogistics, equipment: mappedEquipment };
  }, [eventId]);

  const fetchFiles = useCallback(
    async (canViewSubfolders: boolean) => {
      let query = supabase
        .from('event_files')
        .select(
          '*, uploaded_by_employee:employees!uploaded_by(name, surname), folder:event_folders!folder_id(name)',
        )
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (!canViewSubfolders) {
        query = query.is('folder_id', null);
      }

      const { data, error } = await query;
      if (error) {
        console.error('Error loading event files:', error);
        return [];
      }
      const rows = (data || []) as EventFile[];
      if (!rows.some((file) => file.folder_id)) return rows;
      // Ścieżki folderów. Baza zwraca tylko foldery w zakresie osoby (dokumentacja tylko dla obszaru handlowego),
      // więc brakujący folder nadrzędny skraca ścieżkę, a plik bez widocznego folderu trafia do „Pozostałe”.
      const { data: folders, error: foldersError } = await supabase
        .from('event_folders')
        .select('id, name, parent_folder_id')
        .eq('event_id', eventId);
      if (foldersError) {
        console.warn('Error loading event folders:', foldersError);
        return rows;
      }
      return withEventFolderPaths(rows, folders || []);
    },
    [eventId],
  );

  const fetchFleet = useCallback(async (): Promise<EventVehicleAssignment[]> => {
    const { data, error } = await supabase
      .from('event_vehicles')
      .select(
        `
        id, event_id, vehicle_id, driver_id, role, status, is_external,
        external_company_name, departure_location, departure_time, arrival_time,
        return_departure_time, return_arrival_time, notes,
        pickup_odometer, pickup_timestamp, return_odometer, return_timestamp,
        return_notes, is_in_use,
        vehicle:vehicles!event_vehicles_vehicle_id_fkey(
          id, name, brand, model, registration_number, current_mileage
        ),
        driver:employees!event_vehicles_driver_id_fkey(id, name, surname)
      `,
      )
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading event fleet:', error);
      return [];
    }

    const mapped = (data || [])
      .filter((row: any) => row.vehicle_id || row.is_external || row.external_company_name)
      .map((row: any) => ({
        ...row,
        is_external: row.is_external ?? false,
        is_in_use: row.is_in_use ?? false,
        vehicle: Array.isArray(row.vehicle) ? row.vehicle[0] || null : row.vehicle,
        driver: Array.isArray(row.driver) ? row.driver[0] || null : row.driver,
      })) as EventVehicleAssignment[];

    if (canManageEvent) return mapped;
    if (isWarehouseWorker) {
      const permission = await supabase.rpc('can_receive_warehouse_event', { p_event_id: eventId });
      if (!permission.error && permission.data === true) return mapped;
    }
    return mapped.filter((row) => row.driver_id === employee?.id);
  }, [canManageEvent, isWarehouseWorker, employee?.id, eventId]);

  const refreshFleet = useCallback(async () => {
    setFleetAssignments(await fetchFleet());
  }, [fetchFleet]);

  const loadAll = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setIsLoading(true);
      setLoadError(null);

      try {
        const access = await resolveAccess();
        if (access.salesColleague) {
          // Inny sprzedawca: zespół, pliki, flota, agenda i kroki nie należą do jego zakresu (baza by ich nie wydała).
          setSalesOverview({ eventId, data: await fetchEventSalesOverview(eventId) });
          return;
        }
        setSalesOverview(null);
        const [ev, nextWeddingCard, nextOnsite] = await Promise.all([
          fetchEvent(access),
          fetchWeddingCard(),
          fetchOnsiteContacts(access),
        ]);
        const eventUsesWeddingCard =
          Boolean(nextWeddingCard) ||
          ev?.category_name?.trim().toLocaleLowerCase('pl-PL').startsWith('wesel') === true;
        const isEventAuthor = Boolean(employee?.id && ev?.created_by === employee.id);
        const canViewSubfolders =
          employee?.role === 'admin' ||
          employee?.role === 'manager' ||
          employee?.access_level === 'admin' ||
          employee?.access_level === 'manager' ||
          isEventAuthor;
        setCanViewPrivateFiles(canViewSubfolders);

        const [ag, ch, fi, fleet, assignment] = await Promise.all([
          eventUsesWeddingCard ? Promise.resolve(null) : fetchAgenda(),
          fetchChecklist(),
          // Po migracji obszarów pliki w folderach operacyjnych widzi cała ekipa, a dokumentację — tylko obszar
          // handlowy; decyduje RLS (jak w CRM). Wcześniej ekipa widziała wyłącznie pliki bez folderu.
          fetchFiles(canViewSubfolders || access.mode === 'ready'),
          fetchFleet(),
          fetchMyAssignment(),
        ]);
        if (ev) setEvent(ev);
        setOnsiteContacts(nextOnsite);
        setWeddingCard(nextWeddingCard);
        setAgenda(ag);
        setChecklist(ch.checklist);
        setLogistics(ch.logistics);
        setEventEquipment(ch.equipment);
        setLoadedEquipmentIds(
          new Set(
            ch.equipment
              .filter((e: EventEquipmentItem) => e.is_loaded)
              .map((e: EventEquipmentItem) => e.id),
          ),
        );
        setFiles(fi);
        setFleetAssignments(fleet);
        setMyAssignment(assignment);
      } catch (err) {
        console.error('Error loading event detail:', err);
        setLoadError('Nie udało się pobrać aktualnych danych wydarzenia.');
      } finally {
        setIsLoading(false);
        setRefreshing(false);
      }
    },
    [
      employee?.access_level,
      employee?.id,
      employee?.role,
      eventId,
      resolveAccess,
      fetchOnsiteContacts,
      fetchEvent,
      fetchWeddingCard,
      fetchAgenda,
      fetchChecklist,
      fetchFiles,
      fetchFleet,
      fetchMyAssignment,
    ],
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!showAcceptedFeedback) return;

    const timeout = setTimeout(() => setShowAcceptedFeedback(false), 3000);
    return () => clearTimeout(timeout);
  }, [showAcceptedFeedback]);

  useForegroundEffect(
    (signal, resumed) => {
      const queue = createRefreshQueue(signal, () => refreshFleet());
      if (resumed) void queue.refresh();
      const assignmentIds = new Set(fleetAssignments.map((item) => item.id));
      const channel = supabase
        .channel(`mobile-event-fleet-${eventId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'event_vehicles',
            filter: `event_id=eq.${eventId}`,
          },
          () => {
            queue.schedule();
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'vehicle_handovers' },
          (payload) => {
            const row = (payload.new || payload.old) as { event_vehicle_id?: string };
            if (row?.event_vehicle_id && assignmentIds.has(row.event_vehicle_id)) {
              queue.schedule();
            }
          },
        )
        .subscribe();

      return () => {
        return supabase.removeChannel(channel);
      };
    },
    [eventId, fleetAssignments, refreshFleet],
  );

  useForegroundEffect(
    (signal, resumed) => {
      const queue = createRefreshQueue(signal, () => refreshEventState());
      if (resumed) void queue.refresh();
      const channel = supabase
        .channel(`mobile-event-data-${eventId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'events',
            filter: `id=eq.${eventId}`,
          },
          queue.schedule,
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'employee_assignments',
            filter: `event_id=eq.${eventId}`,
          },
          () => {
            queue.schedule();
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'event_billing_contacts',
            filter: `event_id=eq.${eventId}`,
          },
          queue.schedule,
        )
        .subscribe();

      return () => {
        return supabase.removeChannel(channel);
      };
    },
    [eventId, refreshEventState],
  );

  useForegroundEffect(
    (signal, resumed) => {
      const queue = createRefreshQueue(signal, () => refreshWeddingCard());
      if (resumed) void queue.refresh();
      const channel = supabase
        .channel(`mobile-wedding-card-${eventId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'wedding_cards',
            filter: `event_id=eq.${eventId}`,
          },
          queue.schedule,
        )
        .subscribe();

      return () => {
        return supabase.removeChannel(channel);
      };
    },
    [eventId, refreshWeddingCard],
  );

  useForegroundEffect(
    (signal) => {
      if (!weddingCard?.id) return;
      const queue = createRefreshQueue(signal, () => refreshWeddingCard());
      const channel = supabase.channel(`mobile-wedding-card-content-${weddingCard.id}`);
      [
        'wedding_card_answers',
        'wedding_card_people',
        'wedding_schedule_items',
        'wedding_music_tracks',
        'wedding_attraction_choices',
      ].forEach((table) => {
        channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table,
            filter: `wedding_card_id=eq.${weddingCard.id}`,
          },
          queue.schedule,
        );
      });
      channel.subscribe();

      return () => {
        return supabase.removeChannel(channel);
      };
    },
    [refreshWeddingCard, weddingCard?.id],
  );

  useEffect(() => {
    if (isWeddingEvent && activeTab === 'agenda') {
      setActiveTab('wedding');
    }
    if (!isWeddingEvent && activeTab === 'wedding') {
      setActiveTab('agenda');
    }
    if (!isLoading && activeTab === 'fleet' && !showWarehouseTab && fleetAssignments.length === 0) {
      setActiveTab('details');
    }
    if (!isLoading && activeTab === 'files' && !showWarehouseTab && !canViewPrivateFiles && files.length === 0) {
      setActiveTab('details');
    }
  }, [
    activeTab,
    showWarehouseTab,
    canViewPrivateFiles,
    files.length,
    fleetAssignments.length,
    isLoading,
    isWeddingEvent,
  ]);

  const toggleLoadedItem = async (item: ChecklistItem) => {
    // If loading is locked, prevent unchecking
    if ((event as any)?.loading_locked && item.loaded) {
      return;
    }
    const newVal = !item.loaded;
    setChecklist((prev) => prev.map((c) => (c.id === item.id ? { ...c, loaded: newVal } : c)));
    await supabase.from('event_loading_checklist').update({ loaded: newVal }).eq('id', item.id);
  };

  const [loadedEquipmentIds, setLoadedEquipmentIds] = useState<Set<string>>(new Set());

  const loadingEquipmentWrites = useRef(new Set<string>());
  const contentScrollRef = useRef<ScrollView>(null);

  const toggleEquipmentLoaded = async (item: EventEquipmentItem) => {
    // If loading is locked, prevent unchecking
    if ((event as any)?.loading_locked && loadedEquipmentIds.has(item.id)) {
      return;
    }

    if (loadingEquipmentWrites.current.has(item.id)) return;
    loadingEquipmentWrites.current.add(item.id);
    const newLoaded = !loadedEquipmentIds.has(item.id);
    setLoadedEquipmentIds((prev) => {
      const next = new Set(prev);
      if (newLoaded) {
        next.add(item.id);
      } else {
        next.delete(item.id);
      }
      return next;
    });
    try {
      const { error } = await supabase.rpc('set_event_equipment_loaded', {
        p_equipment_id: item.id,
        p_loaded: newLoaded,
      });
      if (error) throw error;
    } catch (error: any) {
      setLoadedEquipmentIds((previous) => {
        const next = new Set(previous);
        if (newLoaded) next.delete(item.id); else next.add(item.id);
        return next;
      });
      Alert.alert('Nie zapisano załadunku', error?.message || 'Spróbuj ponownie. Zaznaczenie zostało cofnięte.');
    } finally {
      loadingEquipmentWrites.current.delete(item.id);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary.gold} />
      </View>
    );
  }

  if (visibility.salesColleague) {
    return (
      <SalesColleagueEventView
        overview={salesOverview?.eventId === eventId ? salesOverview.data : null}
        access={accessResult?.access ?? null}
        refreshing={refreshing}
        onRefresh={() => void loadAll(true)}
        onBack={onBack}
      />
    );
  }

  if (!event) {
    return (
      <View style={styles.centered}>
        <Feather name="alert-circle" size={48} color={colors.text.tertiary} />
        <Text style={styles.errorText}>{loadError || 'Nie znaleziono wydarzenia'}</Text>
        <View style={styles.errorActions}>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void loadAll(true)}>
            <Feather name="refresh-cw" size={15} color={colors.background.primary} />
            <Text style={styles.retryBtnText}>Spróbuj ponownie</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <Text style={styles.backBtnText}>Wróć</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const tabs: { key: TabKey; label: string; icon: string; count?: number }[] = [
    { key: 'details', label: 'Szczegóły', icon: 'info' },
    ...(isWeddingEvent
      ? ([
          {
            key: 'wedding',
            label: 'Karta weselna',
            icon: 'heart',
            count: weddingCard?.schedule.length || 0,
          },
        ] as const)
      : ([
          { key: 'agenda', label: 'Agenda', icon: 'clock', count: agenda?.items.length || 0 },
        ] as const)),
    {
      key: 'checklist',
      label: 'Checklista',
      icon: 'check-square',
      count: checklist.length + logistics.length,
    },
    ...(showWarehouseTab ? [{ key: 'warehouse' as const, label: 'Magazyn', icon: 'package' }] : []),
    { key: 'team', label: 'Zespół', icon: 'users', count: event.employees.length },
    ...(showWarehouseTab || fleetAssignments.length > 0
      ? ([
          {
            key: 'fleet',
            label: 'Flota',
            icon: 'truck',
            count: fleetAssignments.length,
          },
        ] as const)
      : []),
    ...(showWarehouseTab || canViewPrivateFiles || files.length > 0
      ? ([{ key: 'files', label: 'Pliki', icon: 'file', count: files.length }] as const)
      : []),
  ];

  // „Przejdź” przy kroku realizacji: zakładka, w której krok się zamyka (EVENT_STEP_TARGET_TAB, wspólne z CRM).
  // Zakładki aplikacji otwieramy tutaj, umowę i finanse — w CRM w przeglądarce (tylko w zakresie osoby).
  const openTab = (tab: TabKey) => {
    setActiveTab(tab);
    contentScrollRef.current?.scrollTo({ y: 0, animated: false });
  };
  const stepLink = (step: EventStep): EventStepRowLink | null => {
    const target = eventStepDetailLink(eventId, step.key, {
      isWedding: isWeddingEvent,
      hasWarehouse: showWarehouseTab,
      hasFleet: tabs.some((tab) => tab.key === 'fleet'),
      access: accessResult ? accessResult.access : null,
    });
    if (!target) return null;
    if (target.kind === 'crm') {
      return { label: target.label, external: true, onPress: () => openInCrmWeb(target.path) };
    }
    if (target.tab === activeTab || !tabs.some((tab) => tab.key === target.tab)) return null;
    return { label: target.label, external: false, onPress: () => openTab(target.tab) };
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerBackBtn}>
          <Feather name="arrow-left" size={22} color={colors.text.primary} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {event.name}
          </Text>
          <View style={styles.headerMeta}>
            {Boolean(event.category_color) && (
              <View style={[styles.headerDot, { backgroundColor: event.category_color }]} />
            )}
            {Boolean(event.category_name) && (
              <Text style={styles.headerCategory}>{event.category_name}</Text>
            )}
          </View>
        </View>
        <View
          style={[
            styles.headerStatus,
            { backgroundColor: (STATUS_COLORS[displayStatus({id:eventId,status:event.status})] || '#6b7280') + '20' },
          ]}
        >
          <Text
            style={[styles.headerStatusText, { color: STATUS_COLORS[displayStatus({id:eventId,status:event.status})] || '#6b7280' }]}
          >
            {(operational ? OPERATIONAL_LABELS : STATUS_LABELS)[displayStatus({id:eventId,status:event.status})] || 'Nowe wydarzenie'}
          </Text>
        </View>
      </View>

      {/* Invitation Banner */}
      {event && showEventInvitation(event.created_by, employee?.id, session?.user.id, myAssignment?.status) && (
        <View style={styles.invitationBanner}>
          <View style={styles.invitationTextWrap}>
            <Feather name="mail" size={18} color="#f59e0b" />
            <Text style={styles.invitationText}>
              Masz oczekujące zaproszenie do tego wydarzenia
            </Text>
          </View>
          <View style={styles.invitationButtons}>
            <TouchableOpacity
              style={styles.invitationAcceptBtn}
              onPress={handleAccept}
              disabled={respondingInvitation}
            >
              {respondingInvitation ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Feather name="check" size={16} color="#fff" />
                  <Text style={styles.invitationAcceptText}>Akceptuj</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.invitationRejectBtn}
              onPress={handleReject}
              disabled={respondingInvitation}
            >
              <Feather name="x" size={16} color="#ef4444" />
              <Text style={styles.invitationRejectText}>Odrzuć</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {showAcceptedFeedback && !isEventOrganizer(event?.created_by, employee?.id, session?.user.id) && (
        <View style={styles.invitationAcceptedBanner}>
          <Feather name="check-circle" size={16} color="#22c55e" />
          <Text style={styles.invitationAcceptedText}>Zaproszenie zaakceptowane</Text>
        </View>
      )}
      {myAssignment?.status === 'rejected' && !isEventOrganizer(event?.created_by, employee?.id, session?.user.id) && (
        <View style={styles.invitationRejectedBanner}>
          <Feather name="x-circle" size={16} color="#ef4444" />
          <Text style={styles.invitationRejectedText}>Zaproszenie odrzucone</Text>
        </View>
      )}

      {/* Tabs */}
      <View style={styles.tabBar}>
        <ScrollView
          horizontal
          nestedScrollEnabled
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBarContent}
        >
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === tab.key }}
            >
              <Feather
                name={tab.icon as any}
                size={14}
                color={activeTab === tab.key ? colors.primary.gold : colors.text.tertiary}
              />
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                {tab.label}
              </Text>
              {tab.count !== undefined && tab.count > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{tab.count}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Tab content */}
      <ScrollView
        ref={contentScrollRef}
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setStepsRefreshKey((key) => key + 1);
              void loadAll(true);
            }}
            tintColor={colors.primary.gold}
          />
        }
      >
        {activeTab === 'details' && isEventOrganizer(event.created_by, employee?.id, session?.user?.id) && <TouchableOpacity onPress={() => openInCrmWeb('/crm/events/actions')} style={{ margin: 16, padding: 12, borderRadius: 10, backgroundColor: colors.background.secondary }}><Text style={{ color: colors.primary.gold }}>Moje wydarzenia — następne kroki i przypomnienia →</Text></TouchableOpacity>}
        {activeTab === 'details' && canPrintCard && <EventCardButton eventId={eventId} />}
        {activeTab === 'details' && <RealizationActions eventId={eventId} onChanged={() => void loadAll(true)} />}
        {activeTab === 'details' && accessResult?.mode === 'error' && (
          <View style={styles.accessNotice} accessibilityRole="alert">
            <Feather name="shield" size={16} color={colors.primary.gold} />
            <Text style={styles.accessNoticeText}>
              Nie udało się sprawdzić Twojego zakresu danych tego wydarzenia. Dane klienta i kwoty są ukryte — pociągnij ekran w dół, aby odświeżyć.
            </Text>
          </View>
        )}
        {activeTab === 'details' && <EventStepsPanel eventId={eventId} refreshKey={stepsRefreshKey} onChanged={() => void refreshEventState()} stepLink={stepLink} />}
        {activeTab === 'warehouse' && showWarehouseTab && <WarehouseHandoffPanel key={eventId} eventId={eventId} status={event.status} onAccepted={() => { void loadAll(true); }} />}
        {activeTab === 'warehouse' && showWarehouseTab && <EventStepsPanel eventId={eventId} refreshKey={stepsRefreshKey} onChanged={() => void refreshEventState()} stepLink={stepLink} />}
        {activeTab === 'details' && (
          <DetailsTab
            event={event}
            employee={employee as Employee}
            visibility={visibility}
            onsiteContacts={onsiteContacts}
          />
        )}
        {activeTab === 'agenda' && !isWeddingEvent && <AgendaTab agenda={agenda} />}
        {activeTab === 'wedding' && isWeddingEvent && <WeddingCardTab card={weddingCard} />}
        {activeTab === 'checklist' && (
          <ChecklistTab
            checklist={checklist}
            equipment={eventEquipment}
            loadedEquipmentIds={loadedEquipmentIds}
            logistics={logistics}
            pdfPath={checklistPdfPath}
            onToggle={toggleLoadedItem}
            onToggleEquipment={toggleEquipmentLoaded}
            event={event}
            employee={employee}
            onRefreshEvent={refreshEventState}
          />
        )}
        {activeTab === 'team' && (
          <TeamTab employees={event.employees} currentEmployeeId={employee?.id ?? null} />
        )}
        {activeTab === 'fleet' && (
          <FleetTab
            assignments={fleetAssignments}
            currentEmployeeId={employee?.id ?? null}
            onChanged={refreshFleet}
          />
        )}
        {activeTab === 'files' && <FilesTab files={files} />}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

/* ============ DETAILS TAB ============ */

/* ============ STYLES ============ */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.primary,
    gap: spacing.md,
  },
  errorText: { fontSize: 15, color: colors.text.secondary },
  backBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.background.secondary,
    borderRadius: 8,
    marginTop: spacing.sm,
  },
  backBtnText: { color: colors.primary.gold, fontWeight: '600', fontSize: 14 },
  errorActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: colors.primary.gold,
    borderRadius: 8,
    marginTop: spacing.sm,
  },
  retryBtnText: { color: colors.background.primary, fontWeight: '700', fontSize: 14 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.background.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerContent: { flex: 1 },
  headerTitle: {
    fontFamily: 'MBFAtom',
    textTransform: 'uppercase',
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
  },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  headerDot: { width: 8, height: 8, borderRadius: 4 },
  headerCategory: { fontSize: 11, color: colors.text.secondary },
  headerStatus: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  headerStatusText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  // Tabs
  tabBar: {
    backgroundColor: colors.background.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  tabBarContent: {
    minWidth: '100%',
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
  },
  tab: {
    minWidth: 104,
    flexGrow: 1,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: colors.primary.gold },
  tabText: { fontSize: 11, color: colors.text.tertiary, fontWeight: '500' },
  tabTextActive: { color: colors.primary.gold, fontWeight: '700' },
  tabBadge: {
    backgroundColor: colors.primary.gold + '30',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginLeft: 2,
  },
  tabBadgeText: { fontSize: 9, color: colors.primary.gold, fontWeight: '700' },

  scrollView: { flex: 1 },
  accessNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(211, 187, 115, 0.08)',
  },
  accessNoticeText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.text.secondary },

  pdfButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary.gold + '15',
    borderWidth: 1,
    borderColor: colors.primary.gold + '40',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  pdfButtonText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.primary.gold },

  invitationBanner: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
    borderWidth: 1,
    borderRadius: 10,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    gap: 10,
  },
  invitationTextWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  invitationText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400e',
    flex: 1,
  },
  invitationButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  invitationAcceptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#22c55e',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
  },
  invitationAcceptText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  invitationRejectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
  },
  invitationRejectText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },
  invitationAcceptedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#dcfce7',
    borderColor: '#22c55e',
    borderWidth: 1,
    borderRadius: 10,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  invitationAcceptedText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#166534',
  },
  invitationRejectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fee2e2',
    borderColor: '#ef4444',
    borderWidth: 1,
    borderRadius: 10,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  invitationRejectedText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#991b1b',
  },
});

export default function EventDetailScreen(props: Props) {
 const [retry,setRetry]=useState(0);
 const [result,setResult]=useState<{ready:boolean;data:any;error:boolean}>({ready:false,data:null,error:false});
 useEffect(()=>{let live=true;setResult({ready:false,data:null,error:false});void supabase.rpc('get_realization_workspace',{p_event_id:props.eventId}).then(r=>{if(live)setResult({ready:true,data:r.data,error:!!r.error});});return()=>{live=false;};},[props.eventId,retry]);
 if(!result.ready)return <ActivityIndicator color={colors.primary.gold}/>;
 if(result.error)return <View style={{padding:20}}><Text style={{color:colors.text.primary}}>Nie udało się sprawdzić dostępu do realizacji.</Text><TouchableOpacity onPress={()=>setRetry(value=>value+1)}><Text style={{color:colors.primary.gold,paddingVertical:12}}>Spróbuj ponownie</Text></TouchableOpacity><TouchableOpacity onPress={props.onBack}><Text style={{color:colors.primary.gold}}>Wróć</Text></TouchableOpacity></View>;
 if(result.data?.operational_only)return <RealizationWorkspace initialData={result.data} onBack={props.onBack} initialTab={props.initialTab}/>;
 return <StandardEventDetailScreen {...props} canPrintCard={!!result.data}/>;
}
