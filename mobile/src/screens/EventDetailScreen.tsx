import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Alert,
  Image,
  Modal,
  Pressable,
  Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { supabase, supabaseUrl } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { canView } from '../lib/permissions';

type TabKey = 'details' | 'agenda' | 'checklist' | 'files';

interface EventEquipmentItem {
  id: string;
  equipment_name: string;
  quantity: number;
  status: string | null;
  kit_name: string | null;
  category_name: string | null;
  thumbnail_url: string | null;
  is_loaded: boolean;
}

interface Props {
  eventId: string;
  onBack: () => void;
}

interface EventDetail {
  id: string;
  name: string;
  description: string | null;
  event_date: string;
  event_end_date: string | null;
  status: string;
  notes: string | null;
  expected_revenue: number | null;
  budget: number | null;
  category_name: string | null;
  category_color: string | null;
  location_name: string | null;
  location_address: string | null;
  organization_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  employees: { id: string; name: string; surname: string; role: string | null }[];
}

interface AgendaItem {
  id: string;
  time: string | null;
  title: string;
  description: string | null;
  order_index: number;
}

interface AgendaNote {
  id: string;
  content: string;
  order_index: number;
  level: number;
  parent_id: string | null;
}

interface AgendaData {
  id: string;
  event_name: string;
  start_time: string | null;
  end_time: string | null;
  client_contact: string | null;
  generated_pdf_path: string | null;
  items: AgendaItem[];
  notes: AgendaNote[];
}

interface ChecklistItem {
  id: string;
  item_name: string;
  quantity: number | null;
  loaded: boolean;
  unloaded: boolean;
  priority: string | null;
  vehicle_name: string | null;
  notes: string | null;
  sort_order: number;
}

interface LogisticsItem {
  id: string;
  title: string;
  description: string | null;
  activity_type: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  responsible_employee: { name: string; surname: string } | null;
  sort_order: number;
}

interface EventFile {
  id: string;
  name: string;
  original_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  folder_id: string | null;
  folder?: { name: string } | null;
  created_at: string;
  uploaded_by_employee: { name: string; surname: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  inquiry: 'Zapytanie',
  negotiation: 'Negocjacje',
  confirmed: 'Potwierdzone',
  in_preparation: 'W przygotowaniu',
  ready: 'Gotowe',
  in_progress: 'W trakcie',
  completed: 'Zakończone',
  cancelled: 'Anulowane',
  settled: 'Rozliczone',
};

const STATUS_COLORS: Record<string, string> = {
  inquiry: '#a78bfa',
  negotiation: '#fbbf24',
  confirmed: '#34d399',
  in_preparation: '#60a5fa',
  ready: '#22c55e',
  in_progress: '#3b82f6',
  completed: '#6b7280',
  cancelled: '#ef4444',
  settled: '#10b981',
};

interface MyAssignment {
  id: string;
  status: string;
  role: string | null;
}

export default function EventDetailScreen({ eventId, onBack }: Props) {
  const { employee } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('details');
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [agenda, setAgenda] = useState<AgendaData | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [eventEquipment, setEventEquipment] = useState<EventEquipmentItem[]>([]);
  const [logistics, setLogistics] = useState<LogisticsItem[]>([]);
  const [files, setFiles] = useState<EventFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checklistPdfPath, setChecklistPdfPath] = useState<string | null>(null);
  const [myAssignment, setMyAssignment] = useState<MyAssignment | null>(null);
  const [respondingInvitation, setRespondingInvitation] = useState(false);

  const canViewFinances = canView(employee, 'invoices') || canView(employee, 'finances');

  const fetchMyAssignment = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: emp } = await supabase
      .from('employees')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!emp) return null;

    const { data: assignment } = await supabase
      .from('employee_assignments')
      .select('id, status, role')
      .eq('event_id', eventId)
      .eq('employee_id', emp.id)
      .maybeSingle();

    return assignment ? { id: assignment.id, status: assignment.status, role: assignment.role } : null;
  }, [eventId]);

  const respondToInvitation = async (newStatus: 'accepted' | 'rejected') => {
    if (!myAssignment) return;
    setRespondingInvitation(true);
    try {
      const { error } = await supabase
        .from('employee_assignments')
        .update({ status: newStatus, responded_at: new Date().toISOString() })
        .eq('id', myAssignment.id);

      if (error) {
        Alert.alert('Błąd', 'Nie udało się zaktualizować statusu zaproszenia.');
        return;
      }

      setMyAssignment({ ...myAssignment, status: newStatus });

      // Notify event creator
      if (event) {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: emp } = await supabase
          .from('employees')
          .select('name, surname')
          .eq('user_id', user?.id ?? '')
          .maybeSingle();

        const empName = emp ? `${emp.name} ${emp.surname}` : 'Pracownik';
        const title = newStatus === 'accepted' ? 'Akceptacja zaproszenia' : 'Odrzucenie zaproszenia';
        const message = newStatus === 'accepted'
          ? `${empName} zaakceptował(a) zaproszenie do wydarzenia "${event.name}"`
          : `${empName} odrzucił(a) zaproszenie do wydarzenia "${event.name}"`;

        const { data: eventRow } = await supabase
          .from('events')
          .select('created_by')
          .eq('id', eventId)
          .maybeSingle();

        if (eventRow?.created_by) {
          const { data: notif } = await supabase
            .from('notifications')
            .insert({
              category: 'employee',
              title,
              message,
              type: newStatus === 'accepted' ? 'success' : 'info',
              related_entity_type: 'event',
              related_entity_id: eventId,
              action_url: `/crm/events/${eventId}`,
            })
            .select('id')
            .single();

          if (notif) {
            await supabase.from('notification_recipients').insert({
              notification_id: notif.id,
              user_id: eventRow.created_by,
            });
          }
        }
      }
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
      ]
    );
  };

  const handleReject = () => {
    Alert.alert(
      'Odrzucenie zaproszenia',
      'Czy na pewno chcesz odrzucić zaproszenie do tego wydarzenia?',
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Odrzuć', style: 'destructive', onPress: () => respondToInvitation('rejected') },
      ]
    );
  };

  const fetchEvent = useCallback(async () => {
    const { data, error } = await supabase
      .from('events')
      .select(`
        id, name, description, event_date, event_end_date, status, notes,
        expected_revenue, budget, equipment_checklist_pdf_path,
        event_categories(name, color),
        locations(name, formatted_address, address, city),
        organizations(name, alias),
        contacts(first_name, last_name, phone, email)
      `)
      .eq('id', eventId)
      .maybeSingle();

    if (error || !data) return null;

    setChecklistPdfPath((data as any).equipment_checklist_pdf_path || null);

    const { data: assignments } = await supabase
      .from('employee_event_assignments')
      .select('role, employees(id, name, surname)')
      .eq('event_id', eventId);

    const loc = (data as any).locations;
    const org = (data as any).organizations;
    const contact = (data as any).contacts;
    const cat = (data as any).event_categories;

    return {
      id: data.id,
      name: data.name,
      description: data.description,
      event_date: data.event_date,
      event_end_date: data.event_end_date,
      status: data.status,
      notes: data.notes,
      expected_revenue: data.expected_revenue,
      budget: (data as any).budget ?? null,
      category_name: cat?.name ?? null,
      category_color: cat?.color ?? null,
      location_name: loc?.name ?? null,
      location_address: loc?.formatted_address || loc?.address || (loc?.city ? `${loc.city}` : null),
      organization_name: org?.alias || org?.name || null,
      contact_name: contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : null,
      contact_phone: contact?.phone ?? null,
      contact_email: contact?.email ?? null,
      employees: (assignments || []).map((a: any) => ({
        id: a.employees?.id,
        name: a.employees?.name ?? '',
        surname: a.employees?.surname ?? '',
        role: a.role,
      })),
    } as EventDetail;
  }, [eventId]);

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
        .select('id, quantity, status, is_loaded, equipment_id, kit_id, removed_from_offer, equipment:equipment_items(name, thumbnail_url, category:warehouse_categories(name)), kit:equipment_kits(name, thumbnail_url)')
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

  const fetchFiles = useCallback(async () => {
    const { data } = await supabase
      .from('event_files')
      .select('*, uploaded_by_employee:employees!uploaded_by(name, surname), folder:event_folders!folder_id(name)')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });
    return (data || []) as EventFile[];
  }, [eventId]);

  const loadAll = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setIsLoading(true);

      try {
        const [ev, ag, ch, fi, assignment] = await Promise.all([
          fetchEvent(),
          fetchAgenda(),
          fetchChecklist(),
          fetchFiles(),
          fetchMyAssignment(),
        ]);
        if (ev) setEvent(ev);
        setAgenda(ag);
        setChecklist(ch.checklist);
        setLogistics(ch.logistics);
        setEventEquipment(ch.equipment);
        setLoadedEquipmentIds(new Set(ch.equipment.filter((e: EventEquipmentItem) => e.is_loaded).map((e: EventEquipmentItem) => e.id)));
        setFiles(fi);
        setMyAssignment(assignment);
      } catch (err) {
        console.error('Error loading event detail:', err);
      } finally {
        setIsLoading(false);
        setRefreshing(false);
      }
    },
    [fetchEvent, fetchAgenda, fetchChecklist, fetchFiles, fetchMyAssignment]
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const toggleLoadedItem = async (item: ChecklistItem) => {
    const newVal = !item.loaded;
    setChecklist((prev) =>
      prev.map((c) => (c.id === item.id ? { ...c, loaded: newVal } : c))
    );
    await supabase
      .from('event_loading_checklist')
      .update({ loaded: newVal })
      .eq('id', item.id);
  };

  const [loadedEquipmentIds, setLoadedEquipmentIds] = useState<Set<string>>(new Set());

  const toggleEquipmentLoaded = async (item: EventEquipmentItem) => {
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
    await supabase
      .from('event_equipment')
      .update({
        is_loaded: newLoaded,
        loaded_at: newLoaded ? new Date().toISOString() : null,
        loaded_by: newLoaded ? employee?.id ?? null : null,
      })
      .eq('id', item.id);
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary.gold} />
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.centered}>
        <Feather name="alert-circle" size={48} color={colors.text.tertiary} />
        <Text style={styles.errorText}>Nie znaleziono wydarzenia</Text>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>Wróć</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const tabs: { key: TabKey; label: string; icon: string; count?: number }[] = [
    { key: 'details', label: 'Szczegóły', icon: 'info' },
    { key: 'agenda', label: 'Agenda', icon: 'clock', count: agenda?.items.length || 0 },
    { key: 'checklist', label: 'Checklista', icon: 'check-square', count: checklist.length + logistics.length },
    { key: 'files', label: 'Pliki', icon: 'file', count: files.length },
  ];

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
            {event.category_color && (
              <View style={[styles.headerDot, { backgroundColor: event.category_color }]} />
            )}
            {event.category_name && (
              <Text style={styles.headerCategory}>{event.category_name}</Text>
            )}
          </View>
        </View>
        <View
          style={[
            styles.headerStatus,
            { backgroundColor: (STATUS_COLORS[event.status] || '#6b7280') + '20' },
          ]}
        >
          <Text
            style={[styles.headerStatusText, { color: STATUS_COLORS[event.status] || '#6b7280' }]}
          >
            {STATUS_LABELS[event.status] || event.status}
          </Text>
        </View>
      </View>

      {/* Invitation Banner */}
      {myAssignment?.status === 'pending' && (
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
      {myAssignment?.status === 'accepted' && (
        <View style={styles.invitationAcceptedBanner}>
          <Feather name="check-circle" size={16} color="#22c55e" />
          <Text style={styles.invitationAcceptedText}>Zaproszenie zaakceptowane</Text>
        </View>
      )}
      {myAssignment?.status === 'rejected' && (
        <View style={styles.invitationRejectedBanner}>
          <Feather name="x-circle" size={16} color="#ef4444" />
          <Text style={styles.invitationRejectedText}>Zaproszenie odrzucone</Text>
        </View>
      )}

      {/* Tabs */}
      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
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
      </View>

      {/* Tab content */}
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadAll(true)}
            tintColor={colors.primary.gold}
          />
        }
      >
        {activeTab === 'details' && <DetailsTab event={event} canViewFinances={canViewFinances} />}
        {activeTab === 'agenda' && <AgendaTab agenda={agenda} />}
        {activeTab === 'checklist' && (
          <ChecklistTab
            checklist={checklist}
            equipment={eventEquipment}
            loadedEquipmentIds={loadedEquipmentIds}
            logistics={logistics}
            pdfPath={checklistPdfPath}
            onToggle={toggleLoadedItem}
            onToggleEquipment={toggleEquipmentLoaded}
          />
        )}
        {activeTab === 'files' && <FilesTab files={files} />}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

/* ============ DETAILS TAB ============ */
function DetailsTab({ event, canViewFinances }: { event: EventDetail; canViewFinances: boolean }) {
  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('pl-PL', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });

  const formatCurrency = (val: number) =>
    `${val.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł`;

  return (
    <View>
      {/* Date & location */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data i miejsce</Text>
        <View style={styles.infoGrid}>
          <InfoRow icon="calendar" label="Data" value={formatDate(event.event_date)} />
          {event.event_end_date && (
            <InfoRow icon="calendar" label="Data zakończenia" value={formatDate(event.event_end_date)} />
          )}
          {event.location_name && (
            <InfoRow icon="map-pin" label="Lokalizacja" value={event.location_name} />
          )}
          {event.location_address && (
            <InfoRow icon="navigation" label="Adres" value={event.location_address} />
          )}
        </View>
      </View>

      {/* Client */}
      {(event.organization_name || event.contact_name) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Klient</Text>
          <View style={styles.infoGrid}>
            {event.organization_name && (
              <InfoRow icon="briefcase" label="Firma" value={event.organization_name} />
            )}
            {event.contact_name && (
              <InfoRow icon="user" label="Osoba kontaktowa" value={event.contact_name} />
            )}
            {event.contact_phone && (
              <TouchableOpacity onPress={() => Linking.openURL(`tel:${event.contact_phone}`)}>
                <InfoRow icon="phone" label="Telefon" value={event.contact_phone} highlight />
              </TouchableOpacity>
            )}
            {event.contact_email && (
              <TouchableOpacity onPress={() => Linking.openURL(`mailto:${event.contact_email}`)}>
                <InfoRow icon="mail" label="Email" value={event.contact_email} highlight />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Financial - only for authorized employees */}
      {canViewFinances && (event.expected_revenue || event.budget) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Finanse</Text>
          <View style={styles.infoGrid}>
            {event.expected_revenue && (
              <InfoRow icon="trending-up" label="Przychód" value={formatCurrency(event.expected_revenue)} />
            )}
            {event.budget && (
              <InfoRow icon="dollar-sign" label="Budżet" value={formatCurrency(event.budget)} />
            )}
          </View>
        </View>
      )}

      {/* Team */}
      {event.employees.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Zespół ({event.employees.length})</Text>
          {event.employees.map((emp) => (
            <View key={emp.id} style={styles.teamRow}>
              <View style={styles.teamAvatar}>
                <Feather name="user" size={12} color={colors.primary.gold} />
              </View>
              <Text style={styles.teamName}>
                {emp.name} {emp.surname}
              </Text>
              {emp.role && <Text style={styles.teamRole}>{emp.role}</Text>}
            </View>
          ))}
        </View>
      )}

      {/* Description */}
      {event.description && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Opis</Text>
          <Text style={styles.descriptionText}>{event.description}</Text>
        </View>
      )}

      {/* Notes */}
      {event.notes && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notatki</Text>
          <Text style={styles.descriptionText}>{event.notes}</Text>
        </View>
      )}
    </View>
  );
}

/* ============ AGENDA TAB ============ */
function AgendaTab({ agenda }: { agenda: AgendaData | null }) {
  if (!agenda || agenda.items.length === 0) {
    return (
      <View style={styles.emptyTab}>
        <Feather name="clock" size={40} color={colors.text.tertiary} />
        <Text style={styles.emptyTabText}>Brak pozycji w agendzie</Text>
      </View>
    );
  }

  const formatTime = (time: string | null) => {
    if (!time) return '';
    return time.slice(0, 5);
  };

  const handleOpenPdf = async () => {
    if (!agenda.generated_pdf_path) return;
    try {
      const { data } = await supabase.storage
        .from('event-files')
        .createSignedUrl(agenda.generated_pdf_path, 3600);
      if (data?.signedUrl) {
        Linking.openURL(data.signedUrl);
      }
    } catch (err) {
      Alert.alert('Błąd', 'Nie udało się otworzyć PDF agendy');
    }
  };

  return (
    <View style={styles.agendaContainer}>
      {/* PDF button */}
      {agenda.generated_pdf_path && (
        <TouchableOpacity style={styles.pdfButton} onPress={handleOpenPdf} activeOpacity={0.7}>
          <Feather name="file-text" size={16} color={colors.primary.gold} />
          <Text style={styles.pdfButtonText}>Pokaż PDF agendy</Text>
          <Feather name="external-link" size={14} color={colors.primary.gold} />
        </TouchableOpacity>
      )}

      {/* Agenda header info */}
      {(agenda.start_time || agenda.end_time) && (
        <View style={styles.agendaHeaderInfo}>
          <Feather name="clock" size={12} color={colors.text.tertiary} />
          <Text style={styles.agendaHeaderText}>
            {formatTime(agenda.start_time)}
            {agenda.end_time ? ` - ${formatTime(agenda.end_time)}` : ''}
          </Text>
        </View>
      )}

      {/* Timeline items */}
      {agenda.items.map((item, idx) => (
        <View key={item.id} style={styles.agendaItem}>
          <View style={styles.agendaTimeline}>
            <View style={styles.agendaDot} />
            {idx < agenda.items.length - 1 && <View style={styles.agendaLine} />}
          </View>
          <View style={styles.agendaContent}>
            {item.time && (
              <Text style={styles.agendaTime}>{formatTime(item.time)}</Text>
            )}
            <Text style={styles.agendaTitle}>{item.title}</Text>
            {item.description && (
              <Text style={styles.agendaDesc}>{item.description}</Text>
            )}
          </View>
        </View>
      ))}

      {/* Notes */}
      {agenda.notes.length > 0 && (
        <View style={styles.agendaNotesSection}>
          <Text style={styles.agendaNotesSectionTitle}>Uwagi</Text>
          {agenda.notes
            .filter((n) => !n.parent_id)
            .map((note) => (
              <View key={note.id} style={[styles.agendaNoteRow, { marginLeft: note.level * 16 }]}>
                <View style={styles.agendaNoteBullet} />
                <Text style={styles.agendaNoteText}>{note.content}</Text>
              </View>
            ))}
          {agenda.notes
            .filter((n) => n.parent_id)
            .map((note) => (
              <View key={note.id} style={[styles.agendaNoteRow, { marginLeft: (note.level + 1) * 16 }]}>
                <View style={[styles.agendaNoteBullet, styles.agendaNoteBulletSub]} />
                <Text style={styles.agendaNoteTextSub}>{note.content}</Text>
              </View>
            ))}
        </View>
      )}
    </View>
  );
}

/* ============ CHECKLIST TAB ============ */
function ChecklistTab({
  checklist,
  equipment,
  loadedEquipmentIds,
  logistics,
  pdfPath,
  onToggle,
  onToggleEquipment,
}: {
  checklist: ChecklistItem[];
  equipment: EventEquipmentItem[];
  loadedEquipmentIds: Set<string>;
  logistics: LogisticsItem[];
  pdfPath: string | null;
  onToggle: (item: ChecklistItem) => void;
  onToggleEquipment: (item: EventEquipmentItem) => void;
}) {
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const totalItems = checklist.length + equipment.length + logistics.length;
  const loadedCount = checklist.filter((i) => i.loaded).length;
  const equipmentLoadedCount = equipment.filter((i) => loadedEquipmentIds.has(i.id)).length;
  const completedLogistics = logistics.filter((i) => i.status === 'completed').length;
  const totalCompleted = loadedCount + equipmentLoadedCount + completedLogistics;

  const handleOpenPdf = async () => {
    if (!pdfPath) return;
    try {
      const { data } = await supabase.storage
        .from('event-files')
        .createSignedUrl(pdfPath, 3600);
      if (data?.signedUrl) {
        Linking.openURL(data.signedUrl);
      }
    } catch (err) {
      Alert.alert('Błąd', 'Nie udało się otworzyć PDF checklisty');
    }
  };

  if (totalItems === 0) {
    return (
      <View style={styles.emptyTab}>
        <Feather name="check-square" size={40} color={colors.text.tertiary} />
        <Text style={styles.emptyTabText}>Brak pozycji na checkliście</Text>
      </View>
    );
  }

  const groupedEquipment = equipment.reduce((acc, item) => {
    const cat = item.category_name || 'Inne';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, EventEquipmentItem[]>);

  const PRIORITY_COLORS: Record<string, string> = {
    high: colors.status.error,
    medium: colors.status.warning,
    low: colors.status.info,
  };

  const ACTIVITY_LABELS: Record<string, string> = {
    loading: 'Załadunek',
    unloading: 'Rozładunek',
    setup: 'Montaż',
    rehearsal: 'Próba',
    event: 'Wydarzenie',
    breakdown: 'Demontaż',
    packing: 'Pakowanie',
  };

  const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
    pending: { icon: 'circle', color: colors.text.tertiary },
    in_progress: { icon: 'play-circle', color: colors.status.info },
    completed: { icon: 'check-circle', color: colors.status.success },
    delayed: { icon: 'alert-circle', color: colors.status.warning },
    cancelled: { icon: 'x-circle', color: colors.status.error },
  };

  return (
    <View style={styles.checklistContainer}>
      {/* PDF button */}
      {pdfPath && (
        <TouchableOpacity style={styles.pdfButton} onPress={handleOpenPdf} activeOpacity={0.7}>
          <Feather name="file-text" size={16} color={colors.primary.gold} />
          <Text style={styles.pdfButtonText}>Pokaż PDF checklisty</Text>
          <Feather name="external-link" size={14} color={colors.primary.gold} />
        </TouchableOpacity>
      )}

      {/* Progress */}
      {totalItems > 0 && (
        <View style={styles.checklistProgress}>
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${(totalCompleted / totalItems) * 100}%` },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {totalCompleted}/{totalItems} ukończonych
          </Text>
        </View>
      )}

      {/* Equipment list */}
      {equipment.length > 0 && (
        <View style={styles.checklistSection}>
          <Text style={styles.checklistSectionTitle}>
            Sprzęt ({equipmentLoadedCount}/{equipment.length} załadowano)
          </Text>
          {Object.entries(groupedEquipment).map(([category, items]) => (
            <View key={category}>
              <Text style={styles.equipmentCategoryLabel}>{category}</Text>
              {items.map((item) => {
                const isLoaded = loadedEquipmentIds.has(item.id);
                return (
                  <View key={item.id} style={styles.equipmentChecklistRow}>
                    <TouchableOpacity
                      style={styles.equipmentThumbnailWrap}
                      onPress={() => item.thumbnail_url && setPreviewImage(item.thumbnail_url)}
                      activeOpacity={item.thumbnail_url ? 0.7 : 1}
                    >
                      {item.thumbnail_url ? (
                        <Image
                          source={{ uri: item.thumbnail_url }}
                          style={styles.equipmentThumbnail}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.equipmentThumbnailPlaceholder}>
                          <Feather name="package" size={18} color={colors.text.tertiary} />
                        </View>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.equipmentChecklistContent}
                      onPress={() => onToggleEquipment(item)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.equipmentChecklistInfo}>
                        <Text
                          style={[
                            styles.checklistItemTitle,
                            isLoaded && styles.checklistItemTitleDone,
                          ]}
                          numberOfLines={2}
                        >
                          {item.equipment_name}
                        </Text>
                        <View style={styles.checklistItemMeta}>
                          {item.quantity > 1 && (
                            <Text style={styles.checklistMetaText}>x{item.quantity}</Text>
                          )}
                          {item.kit_name && (
                            <View style={[styles.priorityBadge, { backgroundColor: colors.primary.gold + '20' }]}>
                              <Text style={[styles.priorityText, { color: colors.primary.gold }]}>Kit</Text>
                            </View>
                          )}
                          {item.status && (
                            <Text style={styles.checklistMetaText}>{item.status}</Text>
                          )}
                        </View>
                      </View>
                      <View
                        style={[
                          styles.checkbox,
                          isLoaded && styles.checkboxChecked,
                        ]}
                      >
                        {isLoaded && <Feather name="check" size={12} color={colors.white} />}
                      </View>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}

      {/* Image preview modal */}
      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <Pressable style={styles.imagePreviewOverlay} onPress={() => setPreviewImage(null)}>
          <View style={styles.imagePreviewContainer}>
            {previewImage && (
              <Image
                source={{ uri: previewImage }}
                style={styles.imagePreviewFull}
                resizeMode="contain"
              />
            )}
            <TouchableOpacity style={styles.imagePreviewClose} onPress={() => setPreviewImage(null)}>
              <Feather name="x" size={24} color={colors.white} />
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Loading checklist */}
      {checklist.length > 0 && (
        <View style={styles.checklistSection}>
          <Text style={styles.checklistSectionTitle}>Załadunek / Rozładunek</Text>
          {checklist.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.checklistItem}
              onPress={() => onToggle(item)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.checkbox,
                  item.loaded && styles.checkboxChecked,
                ]}
              >
                {item.loaded && <Feather name="check" size={12} color={colors.white} />}
              </View>
              <View style={styles.checklistItemContent}>
                <View style={styles.checklistItemHeader}>
                  <Text
                    style={[
                      styles.checklistItemTitle,
                      item.loaded && styles.checklistItemTitleDone,
                    ]}
                    numberOfLines={1}
                  >
                    {item.item_name}
                  </Text>
                  {item.priority && (
                    <View style={[styles.priorityBadge, { backgroundColor: (PRIORITY_COLORS[item.priority] || colors.text.tertiary) + '20' }]}>
                      <Text style={[styles.priorityText, { color: PRIORITY_COLORS[item.priority] || colors.text.tertiary }]}>
                        {item.priority}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.checklistItemMeta}>
                  {item.quantity && item.quantity > 1 && (
                    <Text style={styles.checklistMetaText}>x{item.quantity}</Text>
                  )}
                  {item.vehicle_name && (
                    <Text style={styles.checklistMetaText}>
                      <Feather name="truck" size={10} color={colors.text.tertiary} /> {item.vehicle_name}
                    </Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Logistics timeline */}
      {logistics.length > 0 && (
        <View style={styles.checklistSection}>
          <Text style={styles.checklistSectionTitle}>Harmonogram logistyczny</Text>
          {logistics.map((item) => {
            const statusInfo = STATUS_ICONS[item.status || 'pending'] || STATUS_ICONS.pending;
            return (
              <View key={item.id} style={styles.logisticsItem}>
                <View style={styles.logisticsIconContainer}>
                  <Feather name={statusInfo.icon as any} size={18} color={statusInfo.color} />
                </View>
                <View style={styles.logisticsContent}>
                  <View style={styles.logisticsHeader}>
                    <Text style={styles.logisticsTitle}>{item.title}</Text>
                    {item.activity_type && (
                      <Text style={styles.logisticsType}>
                        {ACTIVITY_LABELS[item.activity_type] || item.activity_type}
                      </Text>
                    )}
                  </View>
                  {item.description && item.description !== item.title && (
                    <Text style={styles.logisticsDesc}>{item.description}</Text>
                  )}
                  <View style={styles.logisticsMetaRow}>
                    {item.start_time && (
                      <Text style={styles.logisticsTime}>
                        {new Date(item.start_time).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                        {item.end_time && ` - ${new Date(item.end_time).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`}
                      </Text>
                    )}
                    {item.responsible_employee && (
                      <Text style={styles.logisticsPerson}>
                        {item.responsible_employee.name} {item.responsible_employee.surname}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

/* ============ FILES TAB ============ */
function FilesTab({ files }: { files: EventFile[] }) {
  if (files.length === 0) {
    return (
      <View style={styles.emptyTab}>
        <Feather name="file" size={40} color={colors.text.tertiary} />
        <Text style={styles.emptyTabText}>Brak plików</Text>
      </View>
    );
  }

  const getFileIcon = (type: string | null): string => {
    if (!type) return 'file';
    if (type.includes('pdf')) return 'file-text';
    if (type.includes('image')) return 'image';
    if (type.includes('video')) return 'video';
    if (type.includes('audio')) return 'music';
    if (type.includes('spreadsheet') || type.includes('excel')) return 'grid';
    return 'file';
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('pl-PL', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

  const folderNames = [...new Set(files.map((f) => f.folder?.name).filter(Boolean))] as string[];
  const ungrouped = files.filter((f) => !f.folder_id);

  const handleOpenFile = (file: EventFile) => {
    if (file.file_path) {
      const fileUrl = `${supabaseUrl}/storage/v1/object/public/event-files/${file.file_path}`;
      Linking.openURL(fileUrl).catch(() =>
        Alert.alert('Błąd', 'Nie udało się otworzyć pliku')
      );
    }
  };

  const getDisplayFileName = (file: EventFile): string => {
    if (file.name) return file.name;
    if (file.original_name) return file.original_name;
    if (file.file_path) {
      const pathParts = file.file_path.split('/');
      const lastPart = pathParts[pathParts.length - 1];
      return decodeURIComponent(lastPart) || 'Plik bez nazwy';
    }
    return 'Plik bez nazwy';
  };

  const renderFileRow = (file: EventFile) => (
    <TouchableOpacity
      key={file.id}
      style={styles.fileRow}
      onPress={() => handleOpenFile(file)}
      activeOpacity={0.7}
    >
      <View style={styles.fileIconBg}>
        <Feather name={getFileIcon(file.mime_type) as any} size={16} color={colors.primary.gold} />
      </View>
      <View style={styles.fileInfo}>
        <Text style={styles.fileName} numberOfLines={2}>
          {getDisplayFileName(file)}
        </Text>
        <View style={styles.fileMetaRow}>
          {file.file_size && <Text style={styles.fileMeta}>{formatFileSize(file.file_size)}</Text>}
          <Text style={styles.fileMeta}>{formatDate(file.created_at)}</Text>
          {file.uploaded_by_employee && (
            <Text style={styles.fileMeta}>
              {file.uploaded_by_employee.name} {file.uploaded_by_employee.surname}
            </Text>
          )}
        </View>
      </View>
      <Feather name="download" size={16} color={colors.text.tertiary} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.filesContainer}>
      {folderNames.map((folderName) => (
        <View key={folderName}>
          <View style={styles.folderHeader}>
            <Feather name="folder" size={14} color={colors.primary.gold} />
            <Text style={styles.folderName}>{folderName}</Text>
          </View>
          {files.filter((f) => f.folder?.name === folderName).map(renderFileRow)}
        </View>
      ))}
      {ungrouped.length > 0 && (
        <View>
          {folderNames.length > 0 && (
            <View style={styles.folderHeader}>
              <Feather name="file" size={14} color={colors.primary.gold} />
              <Text style={styles.folderName}>Pozostałe</Text>
            </View>
          )}
          {ungrouped.map(renderFileRow)}
        </View>
      )}
    </View>
  );
}

/* ============ SHARED COMPONENTS ============ */
function InfoRow({
  icon,
  label,
  value,
  highlight,
}: {
  icon: string;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <Feather name={icon as any} size={14} color={colors.text.tertiary} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text
        style={[styles.infoValue, highlight && { color: colors.primary.gold }]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

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
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.text.primary },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  headerDot: { width: 8, height: 8, borderRadius: 4 },
  headerCategory: { fontSize: 11, color: colors.text.secondary },
  headerStatus: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  headerStatusText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.background.secondary,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
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

  // Sections (details)
  section: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  infoGrid: { gap: 8 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoLabel: { fontSize: 12, color: colors.text.tertiary, width: 100 },
  infoValue: { flex: 1, fontSize: 13, color: colors.text.primary, fontWeight: '500' },
  descriptionText: { fontSize: 13, color: colors.text.secondary, lineHeight: 20 },

  // Team
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 10,
  },
  teamAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary.gold + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamName: { flex: 1, fontSize: 13, color: colors.text.primary, fontWeight: '500' },
  teamRole: {
    fontSize: 11,
    color: colors.text.tertiary,
    backgroundColor: colors.background.tertiary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },

  // Agenda
  agendaContainer: { padding: spacing.md },
  agendaHeaderInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.background.tertiary,
    borderRadius: 8,
  },
  agendaHeaderText: { fontSize: 12, color: colors.text.secondary },
  agendaItem: { flexDirection: 'row', marginBottom: 0 },
  agendaTimeline: { width: 24, alignItems: 'center' },
  agendaDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary.gold,
    marginTop: 4,
  },
  agendaLine: {
    width: 2,
    flex: 1,
    backgroundColor: colors.primary.gold + '30',
    marginTop: 4,
  },
  agendaContent: {
    flex: 1,
    paddingLeft: 12,
    paddingBottom: 20,
  },
  agendaTime: { fontSize: 11, color: colors.primary.gold, fontWeight: '700', marginBottom: 2 },
  agendaTitle: { fontSize: 14, color: colors.text.primary, fontWeight: '600' },
  agendaDesc: { fontSize: 12, color: colors.text.secondary, marginTop: 2, lineHeight: 18 },
  agendaNotesSection: { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border.default },
  agendaNotesSectionTitle: { fontSize: 12, fontWeight: '700', color: colors.text.secondary, marginBottom: 8, textTransform: 'uppercase' },
  agendaNoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  agendaNoteBullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary.gold, marginTop: 5 },
  agendaNoteBulletSub: { backgroundColor: colors.text.tertiary, width: 4, height: 4, borderRadius: 2 },
  agendaNoteText: { flex: 1, fontSize: 13, color: colors.text.primary, lineHeight: 18 },
  agendaNoteTextSub: { flex: 1, fontSize: 12, color: colors.text.secondary, lineHeight: 17 },
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

  // Checklist
  checklistContainer: { padding: spacing.md },
  checklistSection: { marginBottom: 20 },
  checklistSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  checklistProgress: { marginBottom: 16 },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.background.tertiary,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.status.success,
  },
  progressText: { fontSize: 11, color: colors.text.tertiary, textAlign: 'right' },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.text.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.status.success,
    borderColor: colors.status.success,
  },
  checklistItemContent: { flex: 1 },
  checklistItemHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checklistItemTitle: { fontSize: 13, color: colors.text.primary, fontWeight: '500', flex: 1 },
  checklistItemTitleDone: {
    textDecorationLine: 'line-through',
    color: colors.text.tertiary,
  },
  checklistItemMeta: { flexDirection: 'row', gap: 10, marginTop: 2 },
  checklistMetaText: { fontSize: 11, color: colors.text.tertiary },
  priorityBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  priorityText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  // Logistics
  logisticsItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    gap: 10,
  },
  logisticsIconContainer: { width: 28, alignItems: 'center', paddingTop: 2 },
  logisticsContent: { flex: 1 },
  logisticsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logisticsTitle: { fontSize: 13, color: colors.text.primary, fontWeight: '600', flex: 1 },
  logisticsType: {
    fontSize: 10,
    color: colors.text.tertiary,
    backgroundColor: colors.background.tertiary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  logisticsDesc: { fontSize: 12, color: colors.text.secondary, marginTop: 2 },
  logisticsMetaRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  logisticsTime: { fontSize: 11, color: colors.primary.gold, fontWeight: '600' },
  logisticsPerson: { fontSize: 11, color: colors.text.tertiary },

  // Files
  filesContainer: { padding: spacing.md },
  folderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    marginTop: 8,
  },
  folderName: { fontSize: 13, fontWeight: '700', color: colors.primary.gold },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    gap: 10,
  },
  fileIconBg: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.primary.gold + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 13, fontWeight: '600', color: colors.text.primary, lineHeight: 18 },
  fileMetaRow: { flexDirection: 'row', gap: 8, marginTop: 3, flexWrap: 'wrap' },
  equipmentCategoryLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 10,
    marginBottom: 4,
    paddingLeft: 4,
  },
  equipmentChecklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 10,
  },
  equipmentThumbnailWrap: {
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: 'hidden',
  },
  equipmentThumbnail: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  equipmentThumbnailPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  equipmentChecklistContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  equipmentChecklistInfo: {
    flex: 1,
    gap: 2,
  },
  imagePreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePreviewContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePreviewFull: {
    width: Dimensions.get('window').width - 32,
    height: Dimensions.get('window').height * 0.7,
  },
  imagePreviewClose: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileMeta: { fontSize: 10, color: colors.text.tertiary },

  // Empty states
  emptyTab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyTabText: { fontSize: 14, color: colors.text.tertiary },

  // Invitation banner
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
