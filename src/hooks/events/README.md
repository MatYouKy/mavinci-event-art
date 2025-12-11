# Event Hooks Documentation

System hooków do zarządzania wydarzeniami w aplikacji CRM. Każdy hook jest odpowiedzialny za konkretny aspekt wydarzenia.

## Główny Hook: `useEvent`

Hook do zarządzania podstawowymi operacjami na wydarzeniu.

### Użycie:

```typescript
import { useEvent } from '@/hooks/useEvent';

function EventComponent({ eventId }: { eventId: string }) {
  const {
    event,
    isLoading,
    error,
    refetch,
    updateEvent,
    deleteEvent,
    logChange,
    isUpdating,
    isDeleting,
  } = useEvent(eventId);

  const handleUpdate = async () => {
    const success = await updateEvent({
      name: 'Nowa nazwa',
      description: 'Nowy opis',
    });
    if (success) {
      await logChange('event_updated', 'Zaktualizowano nazwę i opis');
    }
  };

  if (isLoading) return <div>Ładowanie...</div>;
  if (error) return <div>Błąd: {error}</div>;

  return (
    <div>
      <h1>{event.name}</h1>
      <button onClick={handleUpdate} disabled={isUpdating}>
        Aktualizuj
      </button>
    </div>
  );
}
```

## Pod-hooki dla zakładek

### `useEventEquipment` - Zarządzanie sprzętem

```typescript
import { useEventEquipment } from '@/hooks/events';

function EventEquipmentTab({ eventId }: { eventId: string }) {
  const {
    equipment,
    isLoading,
    addEquipment,
    updateEquipment,
    removeEquipment,
    isAdding,
    isUpdating,
    isRemoving,
  } = useEventEquipment(eventId);

  const handleAdd = async () => {
    await addEquipment({
      equipment_item_id: 'some-id',
      quantity: 5,
      status: 'confirmed',
    });
  };

  const handleUpdate = async (id: string) => {
    await updateEquipment(id, { quantity: 10 });
  };

  const handleRemove = async (id: string) => {
    await removeEquipment(id);
  };

  return (
    <div>
      {equipment.map((item) => (
        <div key={item.id}>
          <span>{item.item?.name}</span>
          <button onClick={() => handleUpdate(item.id)}>Edytuj</button>
          <button onClick={() => handleRemove(item.id)}>Usuń</button>
        </div>
      ))}
      <button onClick={handleAdd} disabled={isAdding}>
        Dodaj sprzęt
      </button>
    </div>
  );
}
```

### `useEventTeam` - Zarządzanie zespołem

```typescript
import { useEventTeam } from '@/hooks/events';

function EventTeamTab({ eventId }: { eventId: string }) {
  const {
    employees,
    isLoading,
    addEmployee,
    removeEmployee,
    isAdding,
    isRemoving
  } = useEventTeam(eventId);

  const handleAddEmployee = async (employeeId: string, role?: string) => {
    await addEmployee(employeeId, role);
  };

  const handleRemoveEmployee = async (employeeId: string) => {
    await removeEmployee(employeeId);
  };

  return (
    <div>
      {employees.map((assignment) => (
        <div key={assignment.id}>
          <span>{assignment.employee.name} {assignment.employee.surname}</span>
          <span>{assignment.role}</span>
          <button onClick={() => handleRemoveEmployee(assignment.employee_id)}>
            Usuń
          </button>
        </div>
      ))}
    </div>
  );
}
```

### `useEventOffers` - Pobieranie ofert

```typescript
import { useEventOffers } from '@/hooks/events';

function EventOffersTab({ eventId }: { eventId: string }) {
  const { offers, isLoading, refetch } = useEventOffers(eventId);

  return (
    <div>
      {offers.map((offer) => (
        <div key={offer.id}>
          <h3>{offer.offer_number}</h3>
          <p>Status: {offer.status}</p>
          <p>Wartość: {offer.total_price} zł</p>
        </div>
      ))}
      <button onClick={refetch}>Odśwież oferty</button>
    </div>
  );
}
```

### `useEventAuditLog` - Historia zmian

```typescript
import { useEventAuditLog } from '@/hooks/events';

function EventHistoryTab({ eventId }: { eventId: string }) {
  const { auditLog, isLoading } = useEventAuditLog(eventId);

  return (
    <div>
      {auditLog.map((log) => (
        <div key={log.id}>
          <span>{log.user?.name} {log.user?.surname}</span>
          <span>{log.action}</span>
          <span>{log.description}</span>
          <span>{new Date(log.created_at).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
```

### `useEventTasks` - Zadania

```typescript
import { useEventTasks } from '@/hooks/events';

function EventTasksTab({ eventId }: { eventId: string }) {
  const { tasks, isLoading, refetch } = useEventTasks(eventId);

  return (
    <div>
      {tasks.map((task) => (
        <div key={task.id}>
          <h3>{task.title}</h3>
          <p>Status: {task.status}</p>
          <p>Priorytet: {task.priority}</p>
        </div>
      ))}
    </div>
  );
}
```

### `useEventFiles` - Pliki

```typescript
import { useEventFiles } from '@/hooks/events';

function EventFilesTab({ eventId }: { eventId: string }) {
  const { files, isLoading } = useEventFiles(eventId);

  return (
    <div>
      {files.map((file) => (
        <div key={file.id}>
          <a href={file.file_url} target="_blank">
            {file.file_name}
          </a>
          <span>{file.uploaded_by_employee?.name}</span>
        </div>
      ))}
    </div>
  );
}
```

### `useEventVehicles` - Pojazdy

```typescript
import { useEventVehicles } from '@/hooks/events';

function EventLogisticsTab({ eventId }: { eventId: string }) {
  const { vehicles, isLoading } = useEventVehicles(eventId);

  return (
    <div>
      {vehicles.map((assignment) => (
        <div key={assignment.id}>
          <span>{assignment.vehicle?.registration_number}</span>
          <span>{assignment.driver?.name} {assignment.driver?.surname}</span>
          <span>Status: {assignment.status}</span>
        </div>
      ))}
    </div>
  );
}
```

### `useEventSubcontractors` - Podwykonawcy

```typescript
import { useEventSubcontractors } from '@/hooks/events';

function EventSubcontractorsTab({ eventId }: { eventId: string }) {
  const { subcontractors, isLoading } = useEventSubcontractors(eventId);

  return (
    <div>
      {subcontractors.map((assignment) => (
        <div key={assignment.id}>
          <h3>{assignment.subcontractor?.name}</h3>
          <p>Zakres: {assignment.scope}</p>
          <p>Koszt: {assignment.cost} zł</p>
        </div>
      ))}
    </div>
  );
}
```

### `useEventAgenda` - Agenda

```typescript
import { useEventAgenda } from '@/hooks/events';

function EventAgendaTab({ eventId }: { eventId: string }) {
  const {
    agendaItems,
    isLoading,
    addItem,
    updateItem,
    deleteItem,
    isAdding,
    isUpdating,
    isDeleting,
  } = useEventAgenda(eventId);

  const handleAdd = async () => {
    await addItem({
      title: 'Nowa pozycja',
      start_time: '10:00',
      end_time: '11:00',
      description: 'Opis',
    });
  };

  const handleUpdate = async (id: string) => {
    await updateItem(id, {
      title: 'Zaktualizowana pozycja',
    });
  };

  const handleDelete = async (id: string) => {
    await deleteItem(id);
  };

  return (
    <div>
      {agendaItems.map((item) => (
        <div key={item.id}>
          <h3>{item.title}</h3>
          <p>{item.start_time} - {item.end_time}</p>
          <button onClick={() => handleUpdate(item.id)}>Edytuj</button>
          <button onClick={() => handleDelete(item.id)}>Usuń</button>
        </div>
      ))}
      <button onClick={handleAdd} disabled={isAdding}>
        Dodaj pozycję
      </button>
    </div>
  );
}
```

### `useEventContracts` - Umowy

```typescript
import { useEventContracts } from '@/hooks/events';

function EventContractTab({ eventId }: { eventId: string }) {
  const { contracts, isLoading } = useEventContracts(eventId);

  return (
    <div>
      {contracts.map((contract) => (
        <div key={contract.id}>
          <h3>{contract.contract_number}</h3>
          <p>Status: {contract.status}</p>
          <p>Utworzył: {contract.creator?.name} {contract.creator?.surname}</p>
        </div>
      ))}
    </div>
  );
}
```

## Pełny przykład - Kompletny komponent wydarzenia

```typescript
import { useEvent } from '@/hooks/useEvent';
import {
  useEventEquipment,
  useEventTeam,
  useEventOffers,
  useEventTasks,
  useEventAuditLog,
} from '@/hooks/events';

function EventDetailPage({ eventId }: { eventId: string }) {
  const { event, isLoading, updateEvent, deleteEvent, logChange } = useEvent(eventId);
  const { equipment } = useEventEquipment(eventId);
  const { employees } = useEventTeam(eventId);
  const { offers } = useEventOffers(eventId);
  const { tasks } = useEventTasks(eventId);
  const { auditLog } = useEventAuditLog(eventId);

  const handleStatusChange = async (newStatus: string) => {
    const oldStatus = event?.status;
    const success = await updateEvent({ status: newStatus });

    if (success) {
      await logChange(
        'status_changed',
        `Zmieniono status z ${oldStatus} na ${newStatus}`,
        'status',
        oldStatus,
        newStatus
      );
    }
  };

  if (isLoading) return <div>Ładowanie...</div>;

  return (
    <div>
      <h1>{event?.name}</h1>

      <div>
        <h2>Sprzęt ({equipment.length})</h2>
        {/* Komponent sprzętu */}
      </div>

      <div>
        <h2>Zespół ({employees.length})</h2>
        {/* Komponent zespołu */}
      </div>

      <div>
        <h2>Oferty ({offers.length})</h2>
        {/* Komponent ofert */}
      </div>

      <div>
        <h2>Zadania ({tasks.length})</h2>
        {/* Komponent zadań */}
      </div>

      <div>
        <h2>Historia zmian</h2>
        {/* Komponent historii */}
      </div>
    </div>
  );
}
```

## Zalety tego podejścia

1. **Separacja odpowiedzialności** - każdy hook zarządza konkretnym aspektem wydarzenia
2. **Automatyczne cache'owanie** - RTK Query automatycznie cache'uje dane
3. **Automatyczne odświeżanie** - zmiany w jednym miejscu automatycznie aktualizują wszystkie komponenty
4. **Mniejsze komponenty** - logika biznesowa jest w hookach, nie w komponentach
5. **Łatwiejsze testowanie** - hooki można testować niezależnie
6. **TypeScript support** - pełne wsparcie typów
7. **Optymistyczne aktualizacje** - możliwość dodania optimistic updates
8. **Mniej kodu** - nie trzeba pisać useState, useEffect dla każdego stanu

## Migracja z istniejącego kodu

Zamiast:
```typescript
const [equipment, setEquipment] = useState([]);
useEffect(() => {
  fetchEquipment();
}, [eventId]);
```

Używaj:
```typescript
const { equipment } = useEventEquipment(eventId);
```

## Uwagi

- Wszystkie hooki automatycznie odświeżają dane po mutacjach
- Nie trzeba ręcznie wywoływać `refetch()` po dodaniu/aktualizacji/usunięciu
- Hooki automatycznie pokazują snackbar z informacją o sukcesie/błędzie
- Każdy hook zwraca flagi `isLoading`, `isAdding`, `isUpdating`, `isDeleting` do zarządzania stanem UI
