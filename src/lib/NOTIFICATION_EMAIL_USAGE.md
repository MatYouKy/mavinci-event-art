# System Powiadomień Email - Dokumentacja

## Przegląd

System pozwala administratorom skonfigurować dla każdego pracownika, na jaki adres email mają być wysyłane powiadomienia systemowe.

## Opcje Preferencji

Każdy pracownik może mieć ustawioną jedną z czterech opcji:

1. **`work`** (domyślnie) - Powiadomienia na email służbowy (z `auth.users.email`)
2. **`personal`** - Powiadomienia na email prywatny
3. **`both`** - Powiadomienia na oba emaile
4. **`none`** - Brak powiadomień email (tylko w systemie)

## Struktura Bazy Danych

```sql
-- Kolumny w tabeli employees
personal_email text DEFAULT NULL
notification_email_preference text DEFAULT 'work'
  CHECK (notification_email_preference IN ('work', 'personal', 'both', 'none'))
```

## Użycie w Kodzie

### Podstawowe Użycie

```typescript
import { getEmployeeNotificationEmails } from '@/lib/notificationEmails';

// Pobierz emaile dla jednego pracownika
const result = await getEmployeeNotificationEmails(employeeId);
console.log(result.emails); // ['email@example.com'] lub [] lub ['email1@example.com', 'email2@example.com']
```

### Wysyłanie Powiadomień do Wielu Pracowników

```typescript
import {
  getMultipleEmployeeNotificationEmails,
  getAllUniqueEmails,
} from '@/lib/notificationEmails';

// Pobierz emaile dla wielu pracowników
const employeeIds = ['uuid1', 'uuid2', 'uuid3'];
const notifications = await getMultipleEmployeeNotificationEmails(employeeIds);

// Wyślij osobne emaile do każdego
for (const notification of notifications) {
  if (notification.emails.length > 0) {
    await sendEmail({
      to: notification.emails,
      subject: 'Powiadomienie',
      body: 'Treść...',
    });
  }
}

// LUB pobierz wszystkie unikalne emaile
const allEmails = getAllUniqueEmails(notifications);
await sendBulkEmail({
  to: allEmails,
  subject: 'Powiadomienie grupowe',
  body: 'Treść...',
});
```

### Przykład w Edge Function

```typescript
// W supabase/functions/send-notification/index.ts

import { getEmployeeNotificationEmails } from '../_shared/notificationEmails.ts';

Deno.serve(async (req) => {
  const { employeeId, subject, body } = await req.json();

  // Pobierz preferencje email
  const { emails, preference } = await getEmployeeNotificationEmails(employeeId);

  if (preference === 'none' || emails.length === 0) {
    // Tylko powiadomienie w systemie, bez emaila
    await supabase.from('notifications').insert({
      employee_id: employeeId,
      subject,
      body,
    });

    return new Response(
      JSON.stringify({ success: true, emailSent: false }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Wyślij emaile
  for (const email of emails) {
    await sendEmail({ to: email, subject, body });
  }

  // Dodaj powiadomienie w systemie
  await supabase.from('notifications').insert({
    employee_id: employeeId,
    subject,
    body,
  });

  return new Response(
    JSON.stringify({ success: true, emailSent: true, emailCount: emails.length }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
```

## Walidacja

System automatycznie waliduje, że:
- Jeśli `notification_email_preference` jest ustawione na `'personal'` lub `'both'`, to `personal_email` nie może być NULL
- Trigger w bazie danych: `validate_notification_email_preference_trigger`

## UI - Edycja przez Admina

W interfejsie pracownika (`/crm/employees/[id]`), tylko administrator widzi i może edytować:

1. **Email prywatny** - pole tekstowe (opcjonalne)
2. **Powiadomienia email wysyłać na** - select z opcjami:
   - Email służbowy
   - Email prywatny (wymaga ustawienia emaila prywatnego)
   - Oba emaile (wymaga ustawienia emaila prywatnego)
   - Nie wysyłaj emaili

## Najlepsze Praktyki

1. **Zawsze sprawdzaj preferencję** przed wysłaniem emaila
2. **Dodawaj powiadomienie w systemie** nawet jeśli email nie jest wysyłany
3. **Loguj próby wysyłki** dla celów audytowych
4. **Obsługuj błędy** gdy email się nie powiedzie, ale powiadomienie systemowe powinno działać

## Migracja Istniejących Powiadomień

Jeśli masz istniejący kod wysyłający emaile, zmień:

```typescript
// PRZED
await sendEmail({ to: employee.email, ... });

// PO
const { emails } = await getEmployeeNotificationEmails(employee.id);
if (emails.length > 0) {
  for (const email of emails) {
    await sendEmail({ to: email, ... });
  }
}
```
