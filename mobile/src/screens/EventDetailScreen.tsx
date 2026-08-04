import React, { useState, useEffect, useCallback } from 'react';
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
import { EventFile, FilesTab } from '@/components/Events/EventDetailScreen/FilesTab';
import { AgendaData, AgendaTab } from '@/components/Events/EventDetailScreen/AgendaTab';
import { DetailsTab, EventDetail } from '@/components/Events/EventDetailScreen/DetailsTab';

type TabKey = 'details' | 'agenda' | 'checklist' | 'files';

interface Props {
  eventId: string;
  onBack: () => void;
}

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

  const fetchMyAssignment = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
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

    return assignment
      ? { id: assignment.id, status: assignment.status, role: assignment.role }
      : null;
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
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const { data: emp } = await supabase
          .from('employees')
          .select('name, surname')
          .eq('user_id', user?.id ?? '')
          .maybeSingle();

        const empName = emp ? `${emp.name} ${emp.surname}` : 'Pracownik';
        const title =
          newStatus === 'accepted' ? 'Akceptacja zaproszenia' : 'Odrzucenie zaproszenia';
        const message =
          newStatus === 'accepted'
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

  const fetchEvent = useCallback(async () => {
    const { data, error } = await supabase
      .from('events')
      .select(
        `
        id, name, description, event_date, event_end_date, status, notes,
        expected_revenue, budget, equipment_checklist_pdf_path, loading_locked,
        event_categories(name, color),
        locations(name, formatted_address, address, city),
        organizations(name, alias),
        contacts(first_name, last_name, phone, email),
        creator:employees!created_by(name, surname)
      `,
      )
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
    const creatorData = (data as any).creator;
    const creatorName = creatorData
      ? [creatorData.name, creatorData.surname].filter(Boolean).join(' ')
      : null;

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
      location_address:
        loc?.formatted_address || loc?.address || (loc?.city ? `${loc.city}` : null),
      organization_name: org?.alias || org?.name || null,
      contact_name: contact
        ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim()
        : null,
      contact_phone: contact?.phone ?? null,
      contact_email: contact?.email ?? null,
      creator_name: creatorName,
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

  const fetchFiles = useCallback(async () => {
    const { data } = await supabase
      .from('event_files')
      .select(
        '*, uploaded_by_employee:employees!uploaded_by(name, surname), folder:event_folders!folder_id(name)',
      )
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
        setLoadedEquipmentIds(
          new Set(
            ch.equipment
              .filter((e: EventEquipmentItem) => e.is_loaded)
              .map((e: EventEquipmentItem) => e.id),
          ),
        );
        setFiles(fi);
        setMyAssignment(assignment);
      } catch (err) {
        console.error('Error loading event detail:', err);
      } finally {
        setIsLoading(false);
        setRefreshing(false);
      }
    },
    [fetchEvent, fetchAgenda, fetchChecklist, fetchFiles, fetchMyAssignment],
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

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

  const toggleEquipmentLoaded = async (item: EventEquipmentItem) => {
    // If loading is locked, prevent unchecking
    if ((event as any)?.loading_locked && loadedEquipmentIds.has(item.id)) {
      return;
    }

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
        loaded_by: newLoaded ? (employee?.id ?? null) : null,
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
    {
      key: 'checklist',
      label: 'Checklista',
      icon: 'check-square',
      count: checklist.length + logistics.length,
    },
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
        {activeTab === 'details' && <DetailsTab event={event} employee={employee as Employee} />}
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
            event={event}
            employee={employee}
            onRefreshEvent={fetchEvent}
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
