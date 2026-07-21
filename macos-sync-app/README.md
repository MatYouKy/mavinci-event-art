# Mavinci Reminders — macOS Sync App

Natywna aplikacja macOS synchronizująca zadania z systemu CRM Mavinci z Apple Reminders.

## Wymagania

- macOS 13.0+ (Ventura lub nowszy)
- Xcode 15+
- Konto Apple Developer (opcjonalnie, do podpisania aplikacji)

## Budowanie

### Za pomocą Xcode

1. Otwórz `Package.swift` w Xcode (File → Open → wybierz `macos-sync-app/Package.swift`)
2. Wybierz schemat `MavinciReminders`
3. Build (Cmd + B) i Run (Cmd + R)

### Za pomocą linii poleceń

```bash
cd macos-sync-app
swift build -c release
```

Gotowy plik binarny: `.build/release/MavinciReminders`

## Konfiguracja

### 1. Generowanie tokenu

Token synchronizacji jest taki sam jak token używany do kalendarza iCal w CRM.
Wygeneruj go w CRM → Ustawienia → Integracje kalendarzowe.

Token jest przechowywany bezpiecznie w macOS Keychain.

### 2. Pierwsze uruchomienie

Przy pierwszym uruchomieniu aplikacja przeprowadzi Cię przez konfigurację:
1. Przyznaj dostęp do Apple Reminders
2. Wprowadź adres CRM (np. `https://app.mavinci.com`)
3. Wklej token synchronizacji
4. Przetestuj połączenie
5. Wybierz lub utwórz listę przypomnień (domyślnie: "Mavinci CRM")
6. Uruchom pierwszą synchronizację

### 3. Działanie

Aplikacja działa w tle jako ikona w pasku menu. Domyślnie synchronizuje co 5 minut.

## Architektura

```
Źródła/
├── App/
│   ├── MavinciRemindersApp.swift  — punkt wejścia @main, MenuBarExtra
│   └── AppDelegate.swift          — NSApplicationDelegate, konfiguracja NSMenu
├── Models/
│   ├── CRMTask.swift              — modele Codable (task, response, updates)
│   └── SyncState.swift            — stan synchronizacji (persisted)
├── Services/
│   ├── KeychainService.swift      — przechowywanie tokenu w Keychain
│   ├── CRMAPIClient.swift         — komunikacja z API CRM
│   ├── RemindersService.swift     — zarządzanie EKReminder via EventKit
│   └── SyncManager.swift          — orkiestrator synchronizacji
└── Views/
    ├── SettingsView.swift          — okno ustawień (2 zakładki)
    └── OnboardingView.swift        — kreator pierwszego uruchomienia
```

## API Endpoints (CRM)

Aplikacja korzysta z endpointu:

### GET `/bridge/tasks/sync?token={TOKEN}`

Zwraca listę zadań przypisanych do użytkownika.

**Odpowiedź:**
```json
{
  "success": true,
  "employee_id": "uuid",
  "employee_name": "Jan Kowalski",
  "tasks": [
    {
      "id": "uuid",
      "title": "Przygotować scenariusz",
      "description": "Opis zadania...",
      "priority": "high",
      "status": "in_progress",
      "board_column": "in_progress",
      "due_date": "2024-03-15T10:00:00Z",
      "event_id": "uuid",
      "event_name": "Gala firmowa Hotel Omega",
      "is_private": false,
      "created_at": "2024-03-01T08:00:00Z",
      "updated_at": "2024-03-10T14:30:00Z"
    }
  ],
  "synced_at": "2024-03-10T15:00:00Z"
}
```

### POST `/bridge/tasks/sync?token={TOKEN}`

Aktualizuje status wykonania zadań.

**Request body:**
```json
{
  "updates": [
    { "task_id": "uuid", "completed": true }
  ]
}
```

**Odpowiedź:**
```json
{
  "success": true,
  "results": [
    { "task_id": "uuid", "success": true }
  ]
}
```

## Mapowanie priorytetów

| CRM Priority | EventKit Priority | Opis          |
|-------------|-------------------|---------------|
| urgent      | 1                 | Najwyższy    |
| high        | 1                 | Wysoki        |
| medium      | 5                 | Średni        |
| low         | 9                 | Niski         |
| (brak)      | 0                 | Brak priorytetu |

## Zapobieganie pętlom

Aplikacja śledzi źródło każdej zmiany (`crm` lub `local`) i nie odsyła do CRM zmian, które sama właśnie zsynchronizowała. Stan śledzenia wygasa po 1 godzinie.

## Bezpieczeństwo

- Token przechowywany wyłącznie w macOS Keychain
- Komunikacja wyłącznie przez HTTPS
- Token nigdy nie jest logowany w pełnej postaci
- Dostęp tylko do zadań przypisanego użytkownika

## Rozwiązywanie problemów

### "Brak dostępu do Przypomnień"
Przejdź do Ustawienia systemowe → Prywatność i ochrona → Przypomnienia i włącz dostęp dla Mavinci Reminders.

### "Nieprawidłowy token"
Wygeneruj nowy token w CRM (Ustawienia → Integracje kalendarzowe) i zaktualizuj go w ustawieniach aplikacji.

### "Brak połączenia"
Sprawdź połączenie z internetem. Aplikacja automatycznie wznowi synchronizację po odzyskaniu łączności.
