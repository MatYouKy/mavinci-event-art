# System historii zmian wydarzeń (Event Audit Log)

## 📋 Opis

Hook `useEventAuditLog` zapewnia kompletny system śledzenia historii zmian w wydarzeniach CRM. Każda akcja (utworzenie, edycja, usunięcie) jest logowana wraz z informacją o autorze i szczegółami zmiany.

## ✨ Kluczowe funkcjonalności

### 🔍 Co jest śledzone?
- **Tworzenie** - utworzenie wydarzenia, oferty, fazy, plików
- **Aktualizacja** - modyfikacja pól, zmiany wartości
- **Usuwanie** - usunięcie elementów
- **Zmiany statusu** - przejścia między statusami
- **Operacje na zasobach** - przypisywanie pojazdów, sprzętu, pracowników
- **Logistyka** - odbiór i zwrot pojazdów
- **Dokumenty** - generowanie umów, przesyłanie plików

### 👤 Informacje o autorach
- Pełne imię i nazwisko
- Nickname (jeśli jest)
- Avatar pracownika
- Stanowisko
- Email kontaktowy

### 📊 Możliwości
- **Grupowanie** - po dacie, użytkowniku, typie akcji
- **Filtrowanie** - po typie akcji, użytkowniku, zakresie dat, typie encji
- **Statystyki** - liczba zmian, najaktywniejszy użytkownik, rozkład akcji
- **Timeline** - chronologiczne wyświetlanie z ikonami i kolorami
- **Szczegóły zmian** - wartości "przed → po"

## 🚀 Szybki start

```tsx
import { useEventAuditLog } from '@/app/(crm)/crm/events/hooks/useEventAuditLog';

function EventHistory({ eventId }: { eventId: string }) {
  const { auditLog, stats, isLoading } = useEventAuditLog(eventId);

  if (isLoading) return <div>Ładowanie...</div>;

  return (
    <div>
      <h3>Historia zmian ({stats.totalEntries})</h3>
      {auditLog.map(entry => (
        <div key={entry.id}>
          <strong>{entry.actionLabel}</strong>
          <p>{entry.displayDescription}</p>
          <small>{entry.displayUser} • {entry.timeAgo}</small>
        </div>
      ))}
    </div>
  );
}
```

## 📚 Dokumentacja

- **[useEventAuditLog.README.md](./useEventAuditLog.README.md)** - Pełna dokumentacja API
- **[useEventAuditLog.example.tsx](./useEventAuditLog.example.tsx)** - Kompletny przykład z filtrowaniem i widokami

## 🎨 Typy akcji i kolory

| Akcja | Kolor | Ikona | Przykład |
|-------|-------|-------|----------|
| Utworzenie | 🟢 Zielony | Plus | Utworzono wydarzenie |
| Aktualizacja | 🔵 Niebieski | Edit | Zmieniono datę wydarzenia |
| Usunięcie | 🔴 Czerwony | Trash2 | Usunięto sprzęt |
| Zmiana statusu | 🟣 Fioletowy | RefreshCw | Status: planowanie → potwierdzony |
| Pojazd | 🔵 Cyan | Truck | Przypisano pojazd |
| Sprzęt | 🟢 Zielony | Package | Dodano sprzęt |
| Pracownik | 🟢 Zielony | UserPlus | Dodano pracownika do zespołu |
| Umowa | 🟣 Fioletowy | FileSignature | Wygenerowano umowę |

## 💡 Przykłady użycia

### Widok Timeline z ikonami
```tsx
const { auditLog } = useEventAuditLog(eventId);

return (
  <div className="space-y-4">
    {auditLog.map(entry => {
      const Icon = Icons[entry.actionIcon];
      return (
        <div key={entry.id} className="flex gap-3">
          <Icon className={`text-${entry.actionColor}-500`} />
          <div>
            <strong>{entry.actionLabel}</strong>
            <p>{entry.displayDescription}</p>
            <small>{entry.displayUser} • {entry.timeAgo}</small>
          </div>
        </div>
      );
    })}
  </div>
);
```

### Filtrowanie po typie akcji
```tsx
const { filterByAction } = useEventAuditLog(eventId);

// Tylko utworzenia i usunięcia
const filtered = filterByAction(['create', 'delete']);
```

### Grupowanie po dacie
```tsx
const { groupedByDate } = useEventAuditLog(eventId);

return (
  <div>
    {Object.entries(groupedByDate).map(([date, entries]) => (
      <div key={date}>
        <h4>{date}</h4>
        {entries.map(entry => (
          <div key={entry.id}>{entry.displayDescription}</div>
        ))}
      </div>
    ))}
  </div>
);
```

### Statystyki
```tsx
const { stats } = useEventAuditLog(eventId);

return (
  <div>
    <p>Wszystkich zmian: {stats.totalEntries}</p>
    <p>Użytkowników: {stats.uniqueUsers}</p>
    <p>Najaktywniejszy: {stats.mostActiveUser}</p>
    <p>Utworzeń: {stats.actionCounts.create}</p>
    <p>Aktualizacji: {stats.actionCounts.update}</p>
  </div>
);
```

## 🔧 Konfiguracja

Hook korzysta z RTK Query endpoint `getEventAuditLog` który:
- Pobiera ostatnie 100 wpisów
- Sortuje od najnowszych
- Łączy dane z tabelą `employees` (autor zmiany)
- Cache'uje wyniki
- Automatycznie odświeża przy zmianach

## 🎯 Najlepsze praktyki

1. **Używaj grupowania** - dla lepszej czytelności (po dacie, użytkowniku)
2. **Dodawaj filtry** - gdy jest dużo wpisów
3. **Pokazuj ikony** - wizualne rozróżnienie typów akcji
4. **Wyświetlaj czas relatywny** - "5 min temu" zamiast pełnej daty
5. **Podświetlaj wartości** - "przed → po" w różnych kolorach
6. **Grupuj podobne akcje** - np. wszystkie zmiany statusu razem

## 📊 Struktura danych

### ProcessedAuditEntry
```typescript
{
  // Z bazy danych
  id: string;
  event_id: string;
  employee_id: string | null;
  action: string;
  field_name: string | null;
  old_value: any;
  new_value: any;
  description: string | null;
  created_at: string;
  employee: { name, surname, avatar_url, ... };

  // Przetworzone
  actionType: 'create' | 'update' | 'delete' | ...;
  actionLabel: 'Utworzono' | 'Zaktualizowano' | ...;
  actionColor: 'green' | 'blue' | 'red' | ...;
  actionIcon: 'Plus' | 'Edit' | 'Trash2' | ...;
  displayUser: 'Jan Kowalski (jkowal)';
  displayDescription: 'Zmieniono status: planowanie → potwierdzony';
  hasChanges: boolean;
  formattedDate: '15.01.2025 14:30';
  timeAgo: '5 min temu';
}
```

## 🚨 Uwagi

- Hook pobiera max 100 ostatnich wpisów (można zmienić w API)
- Dane są cache'owane - używaj `refetch()` do wymuszenia odświeżenia
- Kolory są nazwami - trzeba je zmapować na Tailwind classes
- Ikony to stringi - użyj `Icons[entry.actionIcon]` z lucide-react
- Hook jest reactive - odświeża się automatycznie przy zmianach

## 🔗 Powiązane pliki

- `useEventAuditLog.ts` - Główny hook
- `useEventAuditLog.README.md` - Pełna dokumentacja
- `useEventAuditLog.example.tsx` - Przykład implementacji
- `eventsApi.ts` - RTK Query endpoint (getEventAuditLog)
- Tabela: `event_audit_log` w Supabase
