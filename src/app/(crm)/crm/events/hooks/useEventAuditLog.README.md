# useEventAuditLog - Hook do historii zmian wydarzeń

Hook do obsługi historii zmian (audit log) wydarzeń w systemie CRM. Zapewnia pełną funkcjonalność przeglądania, filtrowania i grupowania zmian wraz z informacjami o autorach zmian.

## Funkcjonalności

### ✅ Typy akcji
Hook rozpoznaje i kategoryzuje następujące typy akcji:
- **Utworzenie** (`create`, `created`)
- **Aktualizacja** (`update`, `updated`)
- **Usunięcie** (`delete`, `deleted`)
- **Zmiana statusu** (`status_changed`)
- **Operacje na pojazdach** (`vehicle_assigned`, `vehicle_pickup`, `vehicle_return`)
- **Operacje na sprzęcie** (`equipment_added`, `equipment_updated`, `equipment_removed`)
- **Operacje na pracownikach** (`employee_added`, `employee_removed`)
- **Operacje na ofertach** (`offer_created`, `offer_updated`)
- **Operacje na fazach** (`phase_created`, `phase_updated`, `phase_deleted`)
- **Operacje na plikach** (`file_uploaded`, `file_deleted`)
- **Generowanie umów** (`contract_generated`)

### ✅ Przetwarzanie danych
- Automatyczna normalizacja typów akcji (różne formaty → standardowy typ)
- Wyświetlanie czytelnych nazw użytkowników (imię, nazwisko, nickname)
- Formatowanie opisów zmian z wartościami "przed → po"
- Obliczanie czasu relatywnego ("5 min temu", "wczoraj", itp.)
- Kolorowanie i ikony dla różnych typów akcji

### ✅ Grupowanie
- **Po dacie** - wpisy pogrupowane według dni (np. "15 stycznia 2025")
- **Po użytkowniku** - wpisy pogrupowane według osoby która je wykonała
- **Po typie akcji** - wpisy pogrupowane według typu operacji

### ✅ Filtrowanie
- Filtrowanie po typie akcji
- Filtrowanie po użytkowniku
- Filtrowanie po zakresie dat
- Filtrowanie po typie encji

### ✅ Statystyki
- Całkowita liczba wpisów
- Liczba unikalnych użytkowników
- Liczba akcji każdego typu
- Najaktywniejszy użytkownik
- Ostatnia zmiana

## Użycie

### Podstawowe użycie

```tsx
import { useEventAuditLog } from '@/app/(crm)/crm/events/hooks/useEventAuditLog';

function EventHistoryTab({ eventId }: { eventId: string }) {
  const { auditLog, isLoading, stats } = useEventAuditLog(eventId);

  if (isLoading) return <div>Ładowanie historii...</div>;

  return (
    <div>
      <h3>Historia zmian ({stats.totalEntries})</h3>

      {auditLog.map((entry) => (
        <div key={entry.id} className="border-l-4 border-blue-500 p-3">
          {/* Akcja i użytkownik */}
          <div className="flex items-center justify-between">
            <span className={`text-${entry.actionColor}-500 font-medium`}>
              {entry.actionLabel}
            </span>
            <span className="text-sm text-gray-500">
              {entry.displayUser}
            </span>
          </div>

          {/* Opis */}
          <p className="mt-1 text-sm">{entry.displayDescription}</p>

          {/* Data */}
          <p className="mt-1 text-xs text-gray-400">
            {entry.timeAgo} • {entry.formattedDate}
          </p>

          {/* Wartości zmian */}
          {entry.hasChanges && (
            <div className="mt-2 rounded bg-gray-50 p-2 text-xs">
              <div className="text-red-600">Przed: {JSON.stringify(entry.old_value)}</div>
              <div className="text-green-600">Po: {JSON.stringify(entry.new_value)}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

### Grupowanie po dacie

```tsx
import { useEventAuditLog } from '@/app/(crm)/crm/events/hooks/useEventAuditLog';

function EventHistoryByDate({ eventId }: { eventId: string }) {
  const { groupedByDate, isLoading } = useEventAuditLog(eventId);

  if (isLoading) return <div>Ładowanie...</div>;

  return (
    <div>
      {Object.entries(groupedByDate).map(([date, entries]) => (
        <div key={date} className="mb-6">
          <h4 className="mb-3 text-lg font-semibold text-gray-700">{date}</h4>

          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-lg bg-white p-3 shadow">
                <div className="flex items-start gap-3">
                  {/* Ikona akcji */}
                  <div className={`text-${entry.actionColor}-500`}>
                    {/* Użyj entry.actionIcon do wyświetlenia ikony z lucide-react */}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{entry.actionLabel}</span>
                      <span className="text-sm text-gray-500">{entry.timeAgo}</span>
                    </div>

                    <p className="mt-1 text-sm text-gray-600">
                      {entry.displayDescription}
                    </p>

                    <p className="mt-1 text-xs text-gray-400">
                      Autor: {entry.displayUser}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

### Grupowanie po użytkowniku

```tsx
import { useEventAuditLog } from '@/app/(crm)/crm/events/hooks/useEventAuditLog';

function EventHistoryByUser({ eventId }: { eventId: string }) {
  const { groupedByUser, isLoading } = useEventAuditLog(eventId);

  if (isLoading) return <div>Ładowanie...</div>;

  return (
    <div>
      {Object.entries(groupedByUser).map(([userName, entries]) => (
        <div key={userName} className="mb-6">
          <h4 className="mb-3 text-lg font-semibold">
            {userName} <span className="text-sm text-gray-500">({entries.length} zmian)</span>
          </h4>

          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded bg-gray-50 p-2">
                <span className={`text-${entry.actionColor}-600 font-medium text-sm`}>
                  {entry.actionLabel}
                </span>
                <span className="text-xs text-gray-500 ml-2">{entry.timeAgo}</span>
                <p className="mt-1 text-sm">{entry.displayDescription}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

### Filtrowanie

```tsx
import { useEventAuditLog } from '@/app/(crm)/crm/events/hooks/useEventAuditLog';
import { useState } from 'react';

function EventHistoryFiltered({ eventId }: { eventId: string }) {
  const { auditLog, filterByAction, filterByUser, stats } = useEventAuditLog(eventId);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  // Filtrowanie tylko akcji tworzenia i usuwania
  const filteredByAction = selectedAction
    ? filterByAction([selectedAction as any])
    : auditLog;

  return (
    <div>
      {/* Filtry */}
      <div className="mb-4 flex gap-2">
        <button onClick={() => setSelectedAction('create')}>
          Utworzenia ({stats.actionCounts.create || 0})
        </button>
        <button onClick={() => setSelectedAction('update')}>
          Aktualizacje ({stats.actionCounts.update || 0})
        </button>
        <button onClick={() => setSelectedAction('delete')}>
          Usunięcia ({stats.actionCounts.delete || 0})
        </button>
        <button onClick={() => setSelectedAction(null)}>
          Wszystkie ({stats.totalEntries})
        </button>
      </div>

      {/* Lista przefiltrowanych wpisów */}
      <div className="space-y-2">
        {filteredByAction.map((entry) => (
          <div key={entry.id} className="rounded bg-white p-3 shadow">
            <span className={`text-${entry.actionColor}-600 font-medium`}>
              {entry.actionLabel}
            </span>
            <p className="mt-1 text-sm">{entry.displayDescription}</p>
            <p className="mt-1 text-xs text-gray-400">
              {entry.displayUser} • {entry.timeAgo}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Statystyki

```tsx
import { useEventAuditLog } from '@/app/(crm)/crm/events/hooks/useEventAuditLog';

function EventHistoryStats({ eventId }: { eventId: string }) {
  const { stats, isLoading } = useEventAuditLog(eventId);

  if (isLoading) return <div>Ładowanie...</div>;

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="rounded-lg bg-blue-50 p-4">
        <div className="text-2xl font-bold text-blue-600">{stats.totalEntries}</div>
        <div className="text-sm text-blue-600">Wszystkich zmian</div>
      </div>

      <div className="rounded-lg bg-green-50 p-4">
        <div className="text-2xl font-bold text-green-600">{stats.uniqueUsers}</div>
        <div className="text-sm text-green-600">Unikalnych użytkowników</div>
      </div>

      {stats.mostActiveUser && (
        <div className="col-span-2 rounded-lg bg-purple-50 p-4">
          <div className="text-lg font-semibold text-purple-600">{stats.mostActiveUser}</div>
          <div className="text-sm text-purple-600">Najaktywniejszy użytkownik</div>
        </div>
      )}

      {stats.lastChange && (
        <div className="col-span-2 rounded-lg bg-orange-50 p-4">
          <div className="text-sm font-medium text-orange-600">
            {stats.lastChange.actionLabel}: {stats.lastChange.displayDescription}
          </div>
          <div className="text-xs text-orange-600">
            {stats.lastChange.displayUser} • {stats.lastChange.timeAgo}
          </div>
        </div>
      )}

      <div className="col-span-2 space-y-1">
        <h4 className="font-semibold">Rozkład akcji:</h4>
        {Object.entries(stats.actionCounts).map(([action, count]) => (
          <div key={action} className="flex justify-between text-sm">
            <span>{action}</span>
            <span className="font-medium">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Timeline z ikonami (z lucide-react)

```tsx
import { useEventAuditLog } from '@/app/(crm)/crm/events/hooks/useEventAuditLog';
import * as Icons from 'lucide-react';

function EventHistoryTimeline({ eventId }: { eventId: string }) {
  const { auditLog, isLoading } = useEventAuditLog(eventId);

  if (isLoading) return <div>Ładowanie...</div>;

  return (
    <div className="relative space-y-4">
      {/* Pionowa linia */}
      <div className="absolute left-4 top-0 h-full w-0.5 bg-gray-200" />

      {auditLog.map((entry, index) => {
        // Dynamiczne pobieranie ikony z lucide-react
        const IconComponent = (Icons as any)[entry.actionIcon] || Icons.Activity;

        return (
          <div key={entry.id} className="relative flex items-start gap-4 pl-12">
            {/* Ikona akcji */}
            <div
              className={`absolute left-0 flex h-8 w-8 items-center justify-center rounded-full bg-${entry.actionColor}-100`}
            >
              <IconComponent className={`h-4 w-4 text-${entry.actionColor}-600`} />
            </div>

            {/* Zawartość */}
            <div className="flex-1 rounded-lg bg-white p-4 shadow">
              <div className="flex items-start justify-between">
                <div>
                  <span className={`font-semibold text-${entry.actionColor}-600`}>
                    {entry.actionLabel}
                  </span>
                  <p className="mt-1 text-sm text-gray-700">
                    {entry.displayDescription}
                  </p>
                </div>

                <span className="text-xs text-gray-400">{entry.timeAgo}</span>
              </div>

              <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                <span>{entry.displayUser}</span>
                <span>•</span>
                <span>{entry.formattedDate}</span>
              </div>

              {/* Szczegóły zmian */}
              {entry.hasChanges && (
                <div className="mt-3 space-y-1 border-t pt-2">
                  {entry.old_value !== null && (
                    <div className="text-xs">
                      <span className="text-gray-500">Przed:</span>
                      <span className="ml-2 font-mono text-red-600">
                        {JSON.stringify(entry.old_value)}
                      </span>
                    </div>
                  )}
                  {entry.new_value !== null && (
                    <div className="text-xs">
                      <span className="text-gray-500">Po:</span>
                      <span className="ml-2 font-mono text-green-600">
                        {JSON.stringify(entry.new_value)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

## API

### Zwracane wartości

```typescript
{
  // Dane przetworzone
  auditLog: ProcessedAuditEntry[];          // Wpisy z dodatkowymi polami
  rawAuditLog: AuditLogEntry[];             // Surowe dane z bazy

  // Grupowanie
  groupedByDate: Record<string, ProcessedAuditEntry[]>;
  groupedByUser: Record<string, ProcessedAuditEntry[]>;
  groupedByAction: Record<AuditActionType, ProcessedAuditEntry[]>;

  // Statystyki
  stats: {
    totalEntries: number;
    uniqueUsers: number;
    actionCounts: Record<string, number>;
    mostActiveUser: string | null;
    lastChange: ProcessedAuditEntry | null;
  };

  // Funkcje filtrowania
  filterByAction: (actionTypes: AuditActionType[]) => ProcessedAuditEntry[];
  filterByUser: (userId: string) => ProcessedAuditEntry[];
  filterByDateRange: (startDate: Date, endDate: Date) => ProcessedAuditEntry[];
  filterByEntityType: (entityType: string) => ProcessedAuditEntry[];

  // Status
  isLoading: boolean;
  error: any;
  refetch: () => void;

  // Funkcje pomocnicze
  formatValue: (value: any) => string;
  getActionLabel: (actionType: AuditActionType, entityType?: string | null) => string;
  getActionColor: (actionType: AuditActionType) => string;
  getActionIcon: (actionType: AuditActionType) => string;
}
```

### Interfejsy

```typescript
interface ProcessedAuditEntry {
  // Pola z bazy danych
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

  // Pola dodane przez hook
  actionType: AuditActionType;          // Znormalizowany typ akcji
  actionLabel: string;                  // Polski label (np. "Utworzono")
  actionColor: string;                  // Kolor (np. "green", "blue", "red")
  actionIcon: string;                   // Nazwa ikony z lucide-react
  displayUser: string;                  // Sformatowana nazwa użytkownika
  displayDescription: string;           // Czytelny opis zmiany
  hasChanges: boolean;                  // Czy wpis ma wartości przed/po
  formattedDate: string;                // Data w formacie "DD.MM.YYYY HH:MM"
  timeAgo: string;                      // Czas relatywny (np. "5 min temu")
}
```

## Kolory akcji

- **Zielony** (green) - tworzenie, dodawanie
- **Niebieski** (blue) - aktualizacje, modyfikacje
- **Czerwony** (red) - usuwanie
- **Fioletowy** (purple) - zmiany statusu, generowanie
- **Pomarańczowy** (orange) - usuwanie pracowników
- **Cyan/Teal** - operacje na pojazdach

## Uwagi

- Hook automatycznie pobiera dane przy zmianie `eventId`
- Dane są cache'owane przez RTK Query
- Maksymalnie 100 ostatnich wpisów (można zmienić w API)
- Wpisy sortowane od najnowszych do najstarszych
- Hook jest reactive - odświeża się automatycznie przy zmianach
