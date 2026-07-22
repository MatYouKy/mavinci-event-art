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
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { supabase } from '../lib/supabase';

type TabKey = 'details' | 'agenda' | 'checklist' | 'files';

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
  title: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  responsible_person: string | null;
  sort_order: number;
}

interface ChecklistItem {
  id: string;
  title: string;
  is_completed: boolean;
  sort_order: number;
  responsible_employee: { name: string; surname: string } | null;
}

interface EventFile {
  id: string;
  file_name: string;
  file_url: string;
  file_size: number | null;
  file_type: string | null;
  folder: string | null;
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

export default function EventDetailScreen({ eventId, onBack }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('details');
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [agenda, setAgenda] = useState<AgendaItem[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [files, setFiles] = useState<EventFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEvent = useCallback(async () => {
    const { data, error } = await supabase
      .from('events')
      .select(`
        id, name, description, event_date, event_end_date, status, notes,
        expected_revenue, budget,
        event_categories(name, color),
        locations(name, formatted_address, address, city),
        organizations(name, alias),
        contacts(first_name, last_name, phone, email)
      `)
      .eq('id', eventId)
      .maybeSingle();

    if (error || !data) return null;

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

  const fetchAgenda = useCallback(async () => {
    const { data } = await supabase
      .from('event_agendas')
      .select('*')
      .eq('event_id', eventId)
      .order('start_time', { ascending: true });
    return (data || []) as AgendaItem[];
  }, [eventId]);

  const fetchChecklist = useCallback(async () => {
    const { data } = await supabase
      .from('event_logistics_timeline')
      .select('*, responsible_employee:employees(name, surname)')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });
    return (data || []).map((item: any) => ({
      id: item.id,
      title: item.title || item.description || 'Bez tytułu',
      is_completed: item.is_completed ?? false,
      sort_order: item.sort_order ?? 0,
      responsible_employee: item.responsible_employee,
    }));
  }, [eventId]);

  const fetchFiles = useCallback(async () => {
    const { data } = await supabase
      .from('event_files')
      .select('*, uploaded_by_employee:employees!uploaded_by(name, surname)')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });
    return (data || []) as EventFile[];
  }, [eventId]);

  const loadAll = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setIsLoading(true);

      try {
        const [ev, ag, ch, fi] = await Promise.all([
          fetchEvent(),
          fetchAgenda(),
          fetchChecklist(),
          fetchFiles(),
        ]);
        if (ev) setEvent(ev);
        setAgenda(ag);
        setChecklist(ch);
        setFiles(fi);
      } catch (err) {
        console.error('Error loading event detail:', err);
      } finally {
        setIsLoading(false);
        setRefreshing(false);
      }
    },
    [fetchEvent, fetchAgenda, fetchChecklist, fetchFiles]
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const toggleChecklistItem = async (item: ChecklistItem) => {
    const newVal = !item.is_completed;
    setChecklist((prev) =>
      prev.map((c) => (c.id === item.id ? { ...c, is_completed: newVal } : c))
    );
    await supabase
      .from('event_logistics_timeline')
      .update({ is_completed: newVal })
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
    { key: 'agenda', label: 'Agenda', icon: 'clock', count: agenda.length },
    { key: 'checklist', label: 'Checklista', icon: 'check-square', count: checklist.length },
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
        {activeTab === 'details' && <DetailsTab event={event} />}
        {activeTab === 'agenda' && <AgendaTab items={agenda} />}
        {activeTab === 'checklist' && (
          <ChecklistTab items={checklist} onToggle={toggleChecklistItem} />
        )}
        {activeTab === 'files' && <FilesTab files={files} />}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

/* ============ DETAILS TAB ============ */
function DetailsTab({ event }: { event: EventDetail }) {
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

      {/* Financial */}
      {(event.expected_revenue || event.budget) && (
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
function AgendaTab({ items }: { items: AgendaItem[] }) {
  if (items.length === 0) {
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

  return (
    <View style={styles.agendaContainer}>
      {items.map((item, idx) => (
        <View key={item.id} style={styles.agendaItem}>
          {/* Timeline line */}
          <View style={styles.agendaTimeline}>
            <View style={styles.agendaDot} />
            {idx < items.length - 1 && <View style={styles.agendaLine} />}
          </View>
          {/* Content */}
          <View style={styles.agendaContent}>
            <View style={styles.agendaTimeRow}>
              {item.start_time && (
                <Text style={styles.agendaTime}>
                  {formatTime(item.start_time)}
                  {item.end_time ? ` - ${formatTime(item.end_time)}` : ''}
                </Text>
              )}
            </View>
            <Text style={styles.agendaTitle}>{item.title}</Text>
            {item.description && (
              <Text style={styles.agendaDesc}>{item.description}</Text>
            )}
            {item.responsible_person && (
              <View style={styles.agendaResponsible}>
                <Feather name="user" size={10} color={colors.text.tertiary} />
                <Text style={styles.agendaResponsibleText}>{item.responsible_person}</Text>
              </View>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

/* ============ CHECKLIST TAB ============ */
function ChecklistTab({
  items,
  onToggle,
}: {
  items: ChecklistItem[];
  onToggle: (item: ChecklistItem) => void;
}) {
  const completedCount = items.filter((i) => i.is_completed).length;

  if (items.length === 0) {
    return (
      <View style={styles.emptyTab}>
        <Feather name="check-square" size={40} color={colors.text.tertiary} />
        <Text style={styles.emptyTabText}>Brak pozycji na checkliście</Text>
      </View>
    );
  }

  return (
    <View style={styles.checklistContainer}>
      {/* Progress */}
      <View style={styles.checklistProgress}>
        <View style={styles.progressBarBg}>
          <View
            style={[
              styles.progressBarFill,
              { width: `${(completedCount / items.length) * 100}%` },
            ]}
          />
        </View>
        <Text style={styles.progressText}>
          {completedCount}/{items.length} ukończonych
        </Text>
      </View>

      {/* Items */}
      {items.map((item) => (
        <TouchableOpacity
          key={item.id}
          style={styles.checklistItem}
          onPress={() => onToggle(item)}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.checkbox,
              item.is_completed && styles.checkboxChecked,
            ]}
          >
            {item.is_completed && <Feather name="check" size={12} color={colors.white} />}
          </View>
          <View style={styles.checklistItemContent}>
            <Text
              style={[
                styles.checklistItemTitle,
                item.is_completed && styles.checklistItemTitleDone,
              ]}
            >
              {item.title}
            </Text>
            {item.responsible_employee && (
              <Text style={styles.checklistItemPerson}>
                {item.responsible_employee.name} {item.responsible_employee.surname}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      ))}
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

  const folders = [...new Set(files.map((f) => f.folder).filter(Boolean))] as string[];
  const ungrouped = files.filter((f) => !f.folder);

  const handleOpenFile = (file: EventFile) => {
    if (file.file_url) {
      Linking.openURL(file.file_url).catch(() =>
        Alert.alert('Błąd', 'Nie udało się otworzyć pliku')
      );
    }
  };

  const renderFileRow = (file: EventFile) => (
    <TouchableOpacity
      key={file.id}
      style={styles.fileRow}
      onPress={() => handleOpenFile(file)}
      activeOpacity={0.7}
    >
      <View style={styles.fileIconBg}>
        <Feather name={getFileIcon(file.file_type) as any} size={16} color={colors.primary.gold} />
      </View>
      <View style={styles.fileInfo}>
        <Text style={styles.fileName} numberOfLines={1}>
          {file.file_name}
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
      {folders.map((folder) => (
        <View key={folder}>
          <View style={styles.folderHeader}>
            <Feather name="folder" size={14} color={colors.primary.gold} />
            <Text style={styles.folderName}>{folder}</Text>
          </View>
          {files.filter((f) => f.folder === folder).map(renderFileRow)}
        </View>
      ))}
      {ungrouped.length > 0 && (
        <View>
          {folders.length > 0 && (
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
  agendaTimeRow: { marginBottom: 2 },
  agendaTime: { fontSize: 11, color: colors.primary.gold, fontWeight: '700' },
  agendaTitle: { fontSize: 14, color: colors.text.primary, fontWeight: '600' },
  agendaDesc: { fontSize: 12, color: colors.text.secondary, marginTop: 2, lineHeight: 18 },
  agendaResponsible: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  agendaResponsibleText: { fontSize: 11, color: colors.text.tertiary },

  // Checklist
  checklistContainer: { padding: spacing.md },
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
  checklistItemTitle: { fontSize: 13, color: colors.text.primary, fontWeight: '500' },
  checklistItemTitleDone: {
    textDecorationLine: 'line-through',
    color: colors.text.tertiary,
  },
  checklistItemPerson: { fontSize: 11, color: colors.text.tertiary, marginTop: 2 },

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
  fileName: { fontSize: 13, fontWeight: '500', color: colors.text.primary },
  fileMetaRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  fileMeta: { fontSize: 10, color: colors.text.tertiary },

  // Empty states
  emptyTab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyTabText: { fontSize: 14, color: colors.text.tertiary },
});
