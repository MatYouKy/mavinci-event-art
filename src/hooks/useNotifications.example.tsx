import { useNotifications } from './useNotifications';

export function NotificationExamples() {
  const { sendToAll, sendToPermission, sendToUsers } = useNotifications();

  // Przykład 1: Wyślij do wszystkich aktywnych pracowników
  const handleSendToAll = async () => {
    const result = await sendToAll({
      title: 'Ważne ogłoszenie',
      message: 'Spotkanie firmowe jutro o 10:00',
      category: 'global',
      type: 'info',
      actionUrl: '/crm/calendar',
    });

    if (result.success) {
      console.log(`Wysłano do ${result.recipientsCount} użytkowników`);
    }
  };

  // Przykład 2: Wyślij do pracowników z konkretnym uprawnieniem
  const handleSendToPermission = async () => {
    const result = await sendToPermission('events_manage', {
      title: 'Nowe wydarzenie wymaga uwagi',
      message: 'Konferencja ABC potrzebuje przypisania sprzętu',
      category: 'event',
      type: 'warning',
      relatedEntityType: 'event',
      relatedEntityId: 'event-uuid-123',
      actionUrl: '/crm/events/event-uuid-123',
    });

    if (result.success) {
      console.log(`Wysłano do ${result.recipientsCount} użytkowników z uprawnieniem events_manage`);
    }
  };

  // Przykład 3: Wyślij do konkretnego użytkownika
  const handleSendToOneUser = async () => {
    const result = await sendToUsers('user-uuid-123', {
      title: 'Przypisano Cię do zadania',
      message: 'Masz nowe zadanie: Przygotowanie sceny',
      category: 'tasks',
      type: 'info',
      relatedEntityType: 'task',
      relatedEntityId: 'task-uuid-456',
      actionUrl: '/crm/tasks/task-uuid-456',
    });

    if (result.success) {
      console.log('Wysłano notyfikację do użytkownika');
    }
  };

  // Przykład 4: Wyślij do wielu konkretnych użytkowników (tablica)
  const handleSendToMultipleUsers = async () => {
    const result = await sendToUsers(
      ['user-uuid-1', 'user-uuid-2', 'user-uuid-3'],
      {
        title: 'Zmiana w harmonogramie',
        message: 'Wydarzenie "Gala 2024" zostało przesunięte na 15:00',
        category: 'event_update',
        type: 'warning',
        relatedEntityType: 'event',
        relatedEntityId: 'event-uuid-789',
        actionUrl: '/crm/events/event-uuid-789',
      }
    );

    if (result.success) {
      console.log(`Wysłano do ${result.recipientsCount} użytkowników`);
    }
  };

  // Przykład 5: Wyślij notyfikację o błędzie do adminów
  const handleSendErrorToAdmins = async () => {
    const result = await sendToPermission('admin', {
      title: 'Błąd systemu',
      message: 'Synchronizacja z magazynem nie powiodła się',
      category: 'system',
      type: 'error',
      actionUrl: '/crm/settings',
    });

    if (result.success) {
      console.log('Wysłano alert do adminów');
    }
  };

  // Przykład 6: Wyślij sukces do managera
  const handleSendSuccessNotification = async () => {
    const result = await sendToUsers('manager-uuid-123', {
      title: 'Oferta zaakceptowana',
      message: 'Klient ABC zaakceptował ofertę nr OF-2024-123',
      category: 'offer',
      type: 'success',
      relatedEntityType: 'offer',
      relatedEntityId: 'offer-uuid-123',
      actionUrl: '/crm/offers/offer-uuid-123',
    });

    if (result.success) {
      console.log('Wysłano powiadomienie o sukcesie');
    }
  };

  return null;
}

// ===== DOKUMENTACJA =====

/*
  # Hook: useNotifications()

  ## Funkcje:

  ### 1. sendToAll(data)
  Wysyła notyfikację do WSZYSTKICH aktywnych pracowników.

  Przykład:
  ```typescript
  const result = await sendToAll({
    title: 'Tytuł powiadomienia',
    message: 'Treść wiadomości',
    category: 'global',
    type: 'info',
    actionUrl: '/crm/page'
  });
  ```

  ### 2. sendToPermission(permission, data)
  Wysyła notyfikację do pracowników z określonym uprawnieniem.

  Dostępne uprawnienia:
  - 'admin'
  - 'events_manage'
  - 'events_view'
  - 'clients_manage'
  - 'equipment_manage'
  - 'offers_manage'
  - 'messages_manage'
  - 'fleet_manage'
  - 'tasks_manage'
  - itd.

  Przykład:
  ```typescript
  const result = await sendToPermission('events_manage', {
    title: 'Nowe wydarzenie',
    message: 'Dodano wydarzenie XYZ',
    category: 'event',
    type: 'info',
    relatedEntityType: 'event',
    relatedEntityId: 'uuid-123',
    actionUrl: '/crm/events/uuid-123'
  });
  ```

  ### 3. sendToUsers(userIds, data)
  Wysyła notyfikację do konkretnych użytkowników.

  userIds: string | string[]
  - Może być pojedynczym UUID: 'user-uuid-123'
  - Lub tablicą UUID: ['uuid-1', 'uuid-2', 'uuid-3']

  Przykład (jeden użytkownik):
  ```typescript
  const result = await sendToUsers('user-uuid-123', {
    title: 'Przypisano zadanie',
    message: 'Masz nowe zadanie',
    category: 'tasks',
    type: 'info',
    actionUrl: '/crm/tasks/task-123'
  });
  ```

  Przykład (wielu użytkowników):
  ```typescript
  const result = await sendToUsers(
    ['uuid-1', 'uuid-2', 'uuid-3'],
    {
      title: 'Zmiana w projekcie',
      message: 'Projekt ABC wymaga uwagi',
      category: 'event',
      type: 'warning',
      actionUrl: '/crm/events/abc'
    }
  );
  ```

  ## Parametry NotificationData:

  - title: string (wymagane) - Tytuł notyfikacji
  - message: string (wymagane) - Treść wiadomości
  - category: string (wymagane) - Kategoria:
    - 'client' | 'event' | 'offer' | 'employee' | 'system' | 'global' |
    - 'contact_form' | 'tasks' | 'event_assignment' | 'event_update' |
    - 'message_assignment'

  - type?: string (opcjonalne, domyślnie 'info') - Typ:
    - 'info' | 'success' | 'warning' | 'error'

  - relatedEntityType?: string (opcjonalne) - Typ powiązanej encji:
    - 'client' | 'event' | 'offer' | 'employee' | 'equipment' |
    - 'contact_messages' | 'task' | 'vehicle' | 'maintenance_record' |
    - 'insurance_policy' | 'fuel_entry'

  - relatedEntityId?: string (opcjonalne) - UUID powiązanej encji
  - actionUrl?: string (opcjonalne) - Link do strony/akcji

  ## Odpowiedź:

  Wszystkie funkcje zwracają Promise z obiektem:

  Sukces:
  ```typescript
  {
    success: true,
    notificationId: 'uuid-powiadomienia',
    recipientsCount: 5
  }
  ```

  Błąd:
  ```typescript
  {
    success: false,
    error: Error
  }
  ```

  Ostrzeżenie (brak odbiorców):
  ```typescript
  {
    success: true,
    notificationId: 'uuid',
    recipientsCount: 0,
    warning: 'No active employees found with permission: xyz'
  }
  ```
*/
