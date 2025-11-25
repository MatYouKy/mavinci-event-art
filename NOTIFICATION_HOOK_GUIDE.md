# 📬 Hook useNotifications - Przewodnik

Hook do **super prostego** zarządzania notyfikacjami w systemie CRM.

**Lokalizacja:** `/src/hooks/useNotifications.ts`

## 🚀 Szybki start

```typescript
import { useNotifications } from '@/hooks/useNotifications';

function MyComponent() {
  const { sendToAll, sendToPermission, sendToUsers } = useNotifications();

  // Gotowe do użycia!
}
```

---

## 📋 3 Główne funkcje

### 1️⃣ `sendToAll(data)`

Wysyła notyfikację do **wszystkich aktywnych pracowników**.

**Przykład:**
```typescript
const result = await sendToAll({
  title: 'Spotkanie firmowe',
  message: 'Jutro o 10:00 w sali konferencyjnej',
  category: 'global',
  type: 'info',
  actionUrl: '/crm/calendar',
});

// Result: { success: true, notificationId: 'uuid', recipientsCount: 15 }
```

**Kiedy używać:**
- Ogłoszenia firmowe
- Awarie systemowe
- Ważne komunikaty dla wszystkich

---

### 2️⃣ `sendToPermission(permission, data)`

Wysyła notyfikację do pracowników z **konkretnym uprawnieniem**.

**Przykład:**
```typescript
const result = await sendToPermission('events_manage', {
  title: 'Nowe wydarzenie wymaga uwagi',
  message: 'Konferencja XYZ - przypisz sprzęt',
  category: 'event',
  type: 'warning',
  relatedEntityType: 'event',
  relatedEntityId: 'event-uuid-123',
  actionUrl: '/crm/events/event-uuid-123',
});

// Result: { success: true, notificationId: 'uuid', recipientsCount: 5 }
```

**Dostępne uprawnienia:**
```typescript
'admin'
'events_manage'
'events_view'
'clients_manage'
'equipment_manage'
'offers_manage'
'messages_manage'
'fleet_manage'
'tasks_manage'
'contracts_manage'
```

**Kiedy używać:**
- Zadania dla konkretnego działu
- Akcje wymagające określonych uprawnień
- Alerty dla specjalistów

---

### 3️⃣ `sendToUsers(userIds, data)`

Wysyła notyfikację do **konkretnych użytkowników**.

Przyjmuje:
- **String** - pojedynczy UUID: `'user-uuid-123'`
- **Array** - wiele UUID: `['uuid-1', 'uuid-2', 'uuid-3']`

**Przykład 1: Jeden użytkownik**
```typescript
const result = await sendToUsers('user-uuid-123', {
  title: 'Przypisano Cię do zadania',
  message: 'Nowe zadanie: Przygotowanie sceny',
  category: 'tasks',
  type: 'info',
  relatedEntityType: 'task',
  relatedEntityId: 'task-uuid-456',
  actionUrl: '/crm/tasks/task-uuid-456',
});
```

**Przykład 2: Wielu użytkowników**
```typescript
const teamMembers = ['uuid-1', 'uuid-2', 'uuid-3'];

const result = await sendToUsers(teamMembers, {
  title: 'Zmiana w harmonogramie',
  message: 'Wydarzenie przesunięte na 15:00',
  category: 'event_update',
  type: 'warning',
  actionUrl: '/crm/events/event-uuid-789',
});

// Result: { success: true, notificationId: 'uuid', recipientsCount: 3 }
```

**Kiedy używać:**
- Przypisanie zadania konkretnej osobie
- Komunikacja w zespole projektowym
- Personalizowane powiadomienia

---

## 📊 Parametry NotificationData

```typescript
interface NotificationData {
  // ✅ WYMAGANE
  title: string;              // Tytuł powiadomienia
  message: string;            // Treść wiadomości
  category: string;           // Kategoria (patrz poniżej)

  // ⚙️ OPCJONALNE
  type?: string;              // 'info' | 'success' | 'warning' | 'error'
  relatedEntityType?: string; // Typ powiązanej encji
  relatedEntityId?: string;   // UUID powiązanej encji
  actionUrl?: string;         // Link do akcji/strony
}
```

### Kategorie (`category`)

```typescript
'client'            // Klienci
'event'             // Wydarzenia
'offer'             // Oferty
'employee'          // Pracownicy
'system'            // System
'global'            // Ogłoszenia globalne
'contact_form'      // Formularze kontaktowe
'tasks'             // Zadania
'event_assignment'  // Przypisania do wydarzeń
'event_update'      // Aktualizacje wydarzeń
'message_assignment'// Przypisania wiadomości
```

### Typy (`type`)

```typescript
'info'     // Domyślny - informacja (niebieski)
'success'  // Sukces (zielony)
'warning'  // Ostrzeżenie (żółty)
'error'    // Błąd (czerwony)
```

### Typy encji (`relatedEntityType`)

```typescript
'client'
'event'
'offer'
'employee'
'equipment'
'contact_messages'
'task'
'vehicle'
'maintenance_record'
'insurance_policy'
'fuel_entry'
```

---

## 💡 Przykłady użycia w praktyce

### 1. Nowe zapytanie z formularza
```typescript
const handleNewContactForm = async (formData) => {
  await sendToPermission('messages_manage', {
    title: 'Nowe zapytanie z formularza',
    message: `${formData.name} wysłał zapytanie`,
    category: 'contact_form',
    type: 'info',
    relatedEntityType: 'contact_messages',
    relatedEntityId: messageId,
    actionUrl: '/crm/messages',
  });
};
```

### 2. Przypisanie do wydarzenia
```typescript
const handleAssignToEvent = async (eventId, userId, userName) => {
  await sendToUsers(userId, {
    title: 'Przypisano Cię do wydarzenia',
    message: `Zostałeś przypisany do: ${eventName}`,
    category: 'event_assignment',
    type: 'info',
    relatedEntityType: 'event',
    relatedEntityId: eventId,
    actionUrl: `/crm/events/${eventId}`,
  });
};
```

### 3. Zmiana statusu oferty
```typescript
const handleOfferAccepted = async (offerId, salesPersonId) => {
  await sendToUsers(salesPersonId, {
    title: 'Oferta zaakceptowana! 🎉',
    message: `Klient zaakceptował ofertę ${offerNumber}`,
    category: 'offer',
    type: 'success',
    relatedEntityType: 'offer',
    relatedEntityId: offerId,
    actionUrl: `/crm/offers/${offerId}`,
  });
};
```

### 4. Błąd w systemie
```typescript
const handleSystemError = async (errorMessage) => {
  await sendToPermission('admin', {
    title: 'Błąd systemu',
    message: errorMessage,
    category: 'system',
    type: 'error',
    actionUrl: '/crm/settings',
  });
};
```

### 5. Przypomnienie o zadaniu
```typescript
const handleTaskReminder = async (taskId, assignedUsers) => {
  await sendToUsers(assignedUsers, {
    title: 'Przypomnienie o zadaniu',
    message: 'Zadanie kończy się za 2 godziny',
    category: 'tasks',
    type: 'warning',
    relatedEntityType: 'task',
    relatedEntityId: taskId,
    actionUrl: `/crm/tasks/${taskId}`,
  });
};
```

### 6. Ogłoszenie dla całej firmy
```typescript
const handleCompanyAnnouncement = async () => {
  await sendToAll({
    title: 'Świąteczne spotkanie firmowe',
    message: 'Zapraszamy na świąteczną imprezę 20.12 o 18:00',
    category: 'global',
    type: 'info',
    actionUrl: '/crm/calendar',
  });
};
```

---

## 🔄 Obsługa odpowiedzi

Wszystkie funkcje zwracają `Promise` z obiektem:

### Sukces
```typescript
{
  success: true,
  notificationId: 'uuid-powiadomienia',
  recipientsCount: 5
}
```

### Błąd
```typescript
{
  success: false,
  error: Error
}
```

### Ostrzeżenie (brak odbiorców)
```typescript
{
  success: true,
  notificationId: 'uuid',
  recipientsCount: 0,
  warning: 'No active employees found with permission: xyz'
}
```

**Przykład obsługi:**
```typescript
const result = await sendToPermission('events_manage', notificationData);

if (result.success) {
  if (result.recipientsCount === 0) {
    console.warn('Brak odbiorców:', result.warning);
  } else {
    console.log(`Wysłano do ${result.recipientsCount} użytkowników`);
  }
} else {
  console.error('Błąd:', result.error);
}
```

---

## 🎯 Best Practices

### ✅ DO
- Używaj opisowych tytułów i wiadomości
- Zawsze dodawaj `actionUrl` aby użytkownik mógł od razu przejść do akcji
- Wybieraj odpowiedni `type` (info/success/warning/error)
- Przypisuj `relatedEntityType` i `relatedEntityId` dla kontekstu
- Sprawdzaj `result.success` przed dalszymi operacjami

### ❌ DON'T
- Nie spamuj powiadomieniami (łącz podobne)
- Nie używaj `sendToAll` dla rzeczy specyficznych dla działu
- Nie pomijaj obsługi błędów
- Nie wysyłaj pustych tablic do `sendToUsers`

---

## 📱 Integracja z Realtime

Powiadomienia są automatycznie wysyłane przez WebSocket do wszystkich odbiorców.

Odbieranie w komponencie:
```typescript
useEffect(() => {
  const channel = supabase
    .channel('notifications')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notification_recipients',
        filter: `user_id=eq.${currentUserId}`,
      },
      (payload) => {
        // Nowe powiadomienie!
        console.log('New notification:', payload);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [currentUserId]);
```

---

## 🧪 Testowanie

```typescript
// Test w komponencie
const handleTest = async () => {
  const result = await sendToUsers('your-user-id', {
    title: 'Test powiadomienia',
    message: 'To jest test',
    category: 'system',
    type: 'info',
  });

  console.log('Test result:', result);
};
```

---

## 📞 Wsparcie

Hook jest w pełni wytypowany TypeScript, więc IDE podpowie Ci dostępne opcje.

W razie pytań sprawdź plik: `src/hooks/useNotifications.example.tsx`
