import { useMemo } from 'react';
import { useGetEventAuditLogQuery } from '@/app/(crm)/crm/events/store/api/eventsApi';

// Typy dla historii zmian
export type AuditActionType =
  | 'create' | 'created'
  | 'update' | 'updated'
  | 'delete' | 'deleted'
  | 'status_changed'
  | 'vehicle_assigned' | 'vehicle_pickup' | 'vehicle_return'
  | 'equipment_added' | 'equipment_updated' | 'equipment_removed'
  | 'employee_added' | 'employee_removed'
  | 'offer_created' | 'offer_updated'
  | 'phase_created' | 'phase_updated' | 'phase_deleted'
  | 'file_uploaded' | 'file_deleted'
  | 'contract_generated'
  | 'other';

export interface AuditLogEmployee {
  id: string;
  name: string;
  surname: string;
  nickname?: string;
  avatar_url?: string;
  avatar_metadata?: any;
  occupation?: string;
  email?: string;
}

export interface AuditLogEntry {
  id: string;
  event_id: string;
  employee_id: string | null;
  user_id: string | null;
  user_name: string | null;
  action: string;
  field_name: string | null;
  old_value: any;
  new_value: any;
  description: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: any;
  created_at: string;
  employee: AuditLogEmployee | null;
}

export interface ProcessedAuditEntry extends AuditLogEntry {
  actionType: AuditActionType;
  actionLabel: string;
  actionColor: string;
  actionIcon: string;
  entityTypeLabel: string | null;
  displayUser: string;
  displayDescription: string;
  hasChanges: boolean;
  formattedDate: string;
  timeAgo: string;
}

// Funkcja normalizująca typ akcji
function normalizeActionType(action: string): AuditActionType {
  const normalized = action.toLowerCase().trim();

  // Mapowanie różnych formatów na standardowe typy
  if (['create', 'created'].includes(normalized)) return 'create';
  if (['update', 'updated'].includes(normalized)) return 'update';
  if (['delete', 'deleted'].includes(normalized)) return 'delete';
  if (normalized === 'status_changed') return 'status_changed';
  if (normalized.includes('vehicle_assigned')) return 'vehicle_assigned';
  if (normalized.includes('vehicle_pickup')) return 'vehicle_pickup';
  if (normalized.includes('vehicle_return')) return 'vehicle_return';
  if (normalized.includes('equipment_added')) return 'equipment_added';
  if (normalized.includes('equipment_updated')) return 'equipment_updated';
  if (normalized.includes('equipment_removed')) return 'equipment_removed';
  if (normalized.includes('employee_added')) return 'employee_added';
  if (normalized.includes('employee_removed')) return 'employee_removed';
  if (normalized.includes('offer_created')) return 'offer_created';
  if (normalized.includes('offer_updated')) return 'offer_updated';
  if (normalized.includes('phase')) {
    if (normalized.includes('created')) return 'phase_created';
    if (normalized.includes('updated')) return 'phase_updated';
    if (normalized.includes('deleted')) return 'phase_deleted';
  }
  if (normalized.includes('file_uploaded')) return 'file_uploaded';
  if (normalized.includes('file_deleted')) return 'file_deleted';
  if (normalized.includes('contract_generated')) return 'contract_generated';

  return 'other';
}

// Funkcja zwracająca czytelną nazwę dla entity_type
function getEntityTypeLabel(entityType: string | null): string | null {
  if (!entityType) return null;

  const labels: Record<string, string> = {
    events: 'Wydarzenie',
    tasks: 'Zadanie',
    employee_assignments: 'Przypisanie pracownika',
    event_vehicles: 'Pojazd',
    vehicle_handovers: 'Przekazanie pojazdu',
    event_agendas: 'Agenda',
    event_agenda_items: 'Pozycja agendy',
    event_agenda_notes: 'Notatka agendy',
    event_equipment: 'Sprzęt',
    event_files: 'Plik',
    contracts: 'Umowa',
    offers: 'Oferta',
    event_phases: 'Faza wydarzenia',
  };

  return labels[entityType] || entityType;
}

// Funkcja zwracająca label dla akcji
function getActionLabel(actionType: AuditActionType, entityType?: string | null): string {
  const labels: Record<AuditActionType, string> = {
    create: 'Utworzono',
    created: 'Utworzono',
    update: 'Zaktualizowano',
    updated: 'Zaktualizowano',
    delete: 'Usunięto',
    deleted: 'Usunięto',
    status_changed: 'Zmieniono status',
    vehicle_assigned: 'Przypisano pojazd',
    vehicle_pickup: 'Odbiór pojazdu',
    vehicle_return: 'Zwrot pojazdu',
    equipment_added: 'Dodano sprzęt',
    equipment_updated: 'Zaktualizowano sprzęt',
    equipment_removed: 'Usunięto sprzęt',
    employee_added: 'Dodano pracownika',
    employee_removed: 'Usunięto pracownika',
    offer_created: 'Utworzono ofertę',
    offer_updated: 'Zaktualizowano ofertę',
    phase_created: 'Utworzono fazę',
    phase_updated: 'Zaktualizowano fazę',
    phase_deleted: 'Usunięto fazę',
    file_uploaded: 'Dodano plik',
    file_deleted: 'Usunięto plik',
    contract_generated: 'Wygenerowano umowę',
    other: 'Inna akcja',
  };

  return labels[actionType] || 'Zmiana';
}

// Funkcja zwracająca kolor dla akcji
function getActionColor(actionType: AuditActionType): string {
  const colors: Record<string, string> = {
    create: 'green',
    update: 'blue',
    delete: 'red',
    status_changed: 'purple',
    vehicle_assigned: 'cyan',
    vehicle_pickup: 'teal',
    vehicle_return: 'teal',
    equipment_added: 'green',
    equipment_updated: 'blue',
    equipment_removed: 'red',
    employee_added: 'green',
    employee_removed: 'orange',
    offer_created: 'green',
    offer_updated: 'blue',
    phase_created: 'green',
    phase_updated: 'blue',
    phase_deleted: 'red',
    file_uploaded: 'green',
    file_deleted: 'red',
    contract_generated: 'purple',
  };

  if (actionType.includes('create') || actionType.includes('added')) return colors.create;
  if (actionType.includes('update')) return colors.update;
  if (actionType.includes('delete') || actionType.includes('removed')) return colors.delete;

  return colors[actionType] || 'gray';
}

// Funkcja zwracająca ikonę dla akcji (nazwa z lucide-react)
function getActionIcon(actionType: AuditActionType): string {
  const icons: Record<string, string> = {
    create: 'Plus',
    update: 'Edit',
    delete: 'Trash2',
    status_changed: 'RefreshCw',
    vehicle_assigned: 'Truck',
    vehicle_pickup: 'ArrowDownFromLine',
    vehicle_return: 'ArrowUpFromLine',
    equipment_added: 'PackagePlus',
    equipment_updated: 'Package',
    equipment_removed: 'PackageMinus',
    employee_added: 'UserPlus',
    employee_removed: 'UserMinus',
    offer_created: 'FileText',
    offer_updated: 'FileEdit',
    phase_created: 'Calendar',
    phase_updated: 'CalendarClock',
    phase_deleted: 'CalendarX',
    file_uploaded: 'Upload',
    file_deleted: 'FileX',
    contract_generated: 'FileSignature',
  };

  if (actionType.includes('create') || actionType.includes('added')) return icons.create;
  if (actionType.includes('update')) return icons.update;
  if (actionType.includes('delete') || actionType.includes('removed')) return icons.delete;

  return icons[actionType] || 'Activity';
}

// Funkcja formatująca czas relatywny
function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'przed chwilą';
  if (diffMin < 60) return `${diffMin} min temu`;
  if (diffHour < 24) return `${diffHour} godz. temu`;
  if (diffDay === 1) return 'wczoraj';
  if (diffDay < 7) return `${diffDay} dni temu`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)} tyg. temu`;
  if (diffDay < 365) return `${Math.floor(diffDay / 30)} mies. temu`;
  return `${Math.floor(diffDay / 365)} lat temu`;
}

// Funkcja formatująca wartość zmiany
function formatValue(value: any): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Tak' : 'Nie';
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

// Hook do obsługi historii zmian wydarzenia
export function useEventAuditLog(eventId: string) {
  const {
    data: auditLog = [],
    isLoading,
    error,
    refetch,
  } = useGetEventAuditLogQuery(eventId, {
    skip: !eventId,
  });

  // Przetwarzanie wpisów historii
  const processedAuditLog = useMemo((): ProcessedAuditEntry[] => {
    return auditLog.map((entry: AuditLogEntry) => {
      const actionType = normalizeActionType(entry.action);
      const actionLabel = getActionLabel(actionType, entry.entity_type);
      const actionColor = getActionColor(actionType);
      const actionIcon = getActionIcon(actionType);
      const entityTypeLabel = getEntityTypeLabel(entry.entity_type);

      // Wyświetlana nazwa użytkownika
      const displayUser = entry.employee
        ? `${entry.employee.name} ${entry.employee.surname}${entry.employee.nickname ? ` (${entry.employee.nickname})` : ''}`
        : entry.user_name || 'System';

      // Opis zmiany
      let displayDescription = entry.description || '';

      if (!displayDescription && entry.field_name) {
        const fieldNames: Record<string, string> = {
          name: 'Nazwa',
          title: 'Tytuł',
          description: 'Opis',
          event_date: 'Data wydarzenia',
          location: 'Lokalizacja',
          status: 'Status',
          budget: 'Budżet',
          notes: 'Notatki',
          client_type: 'Typ klienta',
          requires_subcontractors: 'Wymaga podwykonawców',
        };

        const fieldLabel = fieldNames[entry.field_name] || entry.field_name;
        displayDescription = `Zmieniono ${fieldLabel}`;

        if (entry.old_value !== null && entry.new_value !== null) {
          displayDescription += `: ${formatValue(entry.old_value)} → ${formatValue(entry.new_value)}`;
        }
      }

      const hasChanges = entry.old_value !== null || entry.new_value !== null;
      const formattedDate = new Date(entry.created_at).toLocaleString('pl-PL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const timeAgo = getTimeAgo(entry.created_at);

      return {
        ...entry,
        actionType,
        actionLabel,
        actionColor,
        actionIcon,
        entityTypeLabel,
        displayUser,
        displayDescription,
        hasChanges,
        formattedDate,
        timeAgo,
      };
    });
  }, [auditLog]);

  // Grupowanie wpisów po dacie
  const groupedByDate = useMemo(() => {
    const groups: Record<string, ProcessedAuditEntry[]> = {};

    processedAuditLog.forEach((entry) => {
      const date = new Date(entry.created_at).toLocaleDateString('pl-PL', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(entry);
    });

    return groups;
  }, [processedAuditLog]);

  // Grupowanie wpisów po użytkowniku
  const groupedByUser = useMemo(() => {
    const groups: Record<string, ProcessedAuditEntry[]> = {};

    processedAuditLog.forEach((entry) => {
      const userName = entry.displayUser;

      if (!groups[userName]) {
        groups[userName] = [];
      }
      groups[userName].push(entry);
    });

    return groups;
  }, [processedAuditLog]);

  // Grupowanie wpisów po typie akcji
  const groupedByAction = useMemo(() => {
    const groups: Record<AuditActionType, ProcessedAuditEntry[]> = {} as any;

    processedAuditLog.forEach((entry) => {
      const actionType = entry.actionType;

      if (!groups[actionType]) {
        groups[actionType] = [];
      }
      groups[actionType].push(entry);
    });

    return groups;
  }, [processedAuditLog]);

  // Statystyki
  const stats = useMemo(() => {
    const totalEntries = processedAuditLog.length;
    const uniqueUsers = new Set(processedAuditLog.map(e => e.employee_id || e.user_id)).size;
    const actionCounts: Record<string, number> = {};

    processedAuditLog.forEach((entry) => {
      actionCounts[entry.actionType] = (actionCounts[entry.actionType] || 0) + 1;
    });

    return {
      totalEntries,
      uniqueUsers,
      actionCounts,
      mostActiveUser: Object.entries(groupedByUser)
        .sort((a, b) => b[1].length - a[1].length)[0]?.[0] || null,
      lastChange: processedAuditLog[0] || null,
    };
  }, [processedAuditLog, groupedByUser]);

  // Funkcja filtrowania wpisów
  const filterByAction = (actionTypes: AuditActionType[]) => {
    return processedAuditLog.filter(entry => actionTypes.includes(entry.actionType));
  };

  const filterByUser = (userId: string) => {
    return processedAuditLog.filter(entry =>
      entry.employee_id === userId || entry.user_id === userId
    );
  };

  const filterByDateRange = (startDate: Date, endDate: Date) => {
    return processedAuditLog.filter(entry => {
      const entryDate = new Date(entry.created_at);
      return entryDate >= startDate && entryDate <= endDate;
    });
  };

  const filterByEntityType = (entityType: string) => {
    return processedAuditLog.filter(entry => entry.entity_type === entityType);
  };

  return {
    // Dane surowe
    auditLog: processedAuditLog,
    rawAuditLog: auditLog,

    // Grupowanie
    groupedByDate,
    groupedByUser,
    groupedByAction,

    // Statystyki
    stats,

    // Funkcje filtrowania
    filterByAction,
    filterByUser,
    filterByDateRange,
    filterByEntityType,

    // Status
    isLoading,
    error,
    refetch,

    // Dodatkowe funkcje pomocnicze
    formatValue,
    getActionLabel,
    getActionColor,
    getActionIcon,
  };
}
