# Mavinci Reminders — macOS Sync App

Natywna aplikacja macOS synchronizująca zadania z systemu CRM Mavinci z Apple Reminders.

## Aktualizacja 1.1 — foldery i odporna synchronizacja

Nowy pakiet 1.1.3 znajduje się w `release/1.1.3/`. To wydanie lokalne dla Apple
Silicon, podpisane ad-hoc, bez Developer ID i notaryzacji Apple. Stary pakiet
w `dist/` i zainstalowana kopia nie są automatycznie zastępowane.
Zaktualizuj backend CRM i zastosuj migrację
supabase/migrations/20260911230000_mac_folder_sync.sql, następnie
supabase/migrations/20260911233000_mac_root_catalog.sql, a następnie zainstaluj
nową podpisaną aplikację .app w folderze Aplikacje i zamknij starą kopię.

Informacje o zmianach i aktualizacji: `release-notes-1.1.3.md`.
Wersja 1.1.3 wymaga również aktualnego endpointu zadań i migracji
`20260911150000_personal_task_sync.sql` (przed aktualizacją aplikacji).
Jeżeli backend nie potwierdza osobistego zakresu, import zostanie zatrzymany.
Przy błędzie wybierz w menu „Pokaż błąd synchronizacji…” i skopiuj komunikat.
Brak odczytu listy nie jest już prezentowany jako 0 zadań.
Dodano 9 testów walidacji zakresu na sztucznych danych, bez połączeń z CRM lub EventKit.
Kolejne lokalne wydanie przygotowuje `bash package-release.sh` po świadomym
zwiększeniu wersji w Info.plist i dodaniu odpowiedniego pliku release-notes.
Skrypt nie nadpisuje istniejącego wydania, nie instaluje aplikacji i nie publikuje
pakietu. Sprawdza kompilację, podpis ad-hoc i integralność obrazu DMG.

### Jeden katalog Mac / iCloud ↔ CRM

- CRM → dowolne wydarzenie → Pliki → **Folder Mac / iCloud**: administrator
  generuje jeden klucz **całego katalogu CRM**. Obejmuje on wszystkie obecne
  i przyszłe wydarzenia, wygasa po roku i można go unieważnić w tym samym panelu.
  Lista kluczy całego katalogu jest wspólna dla wydarzeń, ale dotyczy tylko
  zalogowanego administratora. Nie przekazuj tego klucza pracownikom.
- Mac → Ustawienia → **Pliki**: wybierz raz np. iCloud Drive/CRM i wklej klucz.
  Aplikacja automatycznie tworzy `events/RRRR-MM-DD/Nazwa wydarzenia/`, a pod nim
  `Umowy`, `Oferty`, `Pliki`, `Prywatne`. Datę ustala w strefie Europe/Warsaw;
  wydarzenia bez daty trafiają pod `events/Bez daty/`.
- ID wydarzenia pozostaje w konfiguracji aplikacji; ukryty znacznik folderu
  potwierdza tożsamość powiązania. Folderów nie rozpoznajemy po samej nazwie.
  Kolizje otrzymują `(2)`, `(3)` itd. Nie importujemy automatycznie istniejących,
  niepowiązanych folderów. Luźne pliki w głównym CRM nie są wysyłane.
- Raz przydzielona ścieżka jest zachowywana również po zmianie nazwy lub daty
  wydarzenia. Nie przenoś powiązanych folderów ręcznie: brak znacznika zatrzymuje
  synchronizację danego wydarzenia, zamiast przypisywać dokumenty do innego.
- Stare klucze pojedynczych wydarzeń nadal działają. Odznacz „Cały katalog CRM”,
  aby nimi zarządzać. Przed przejściem na katalog główny odłącz stare lokalne
  powiązania. Pliki nie zostaną usunięte; istniejących folderów nie przejmujemy
  automatycznie, aby uniknąć błędnego przypisania.
- Wszystkie zwykłe pliki i podfoldery wewnątrz powiązanych wydarzeń są synchronizowane,
  z limitem 50 MB na plik. Ukryte pliki, pakiety aplikacji i dowiązania symboliczne
  nie są przesyłane. Podczas zapisywania lub pobierania z iCloud plik oczekuje
  na następny cykl.
- Pliki pochodzące z folderu Mac dostępne są w tym panelu CRM. Można je pobierać,
  podglądać (formaty obsługiwane przez przeglądarkę), a administrator może dodawać
  nowe oraz wysyłać **Nową wersję**, którą Mac pobierze automatycznie.
- Widoczność plików z Maca: aktywny administrator ma pełen dostęp. Inny aktywny
  pracownik musi przejść aktualne RLS wydarzenia i być jego twórcą lub mieć
  zaakceptowane przypisanie. Wtedy widzi `Pliki`; `Umowy` wymagają dodatkowo
  `contracts_manage`, a `Oferty` — `offers_create`. Zasada obejmuje cały podfolder.
  `Prywatne`, nieznane katalogi i stare pliki bez kategorii pozostają admin-only.
  Kontrola działa na serwerze zarówno przy listowaniu, jak i pobieraniu po ID.
  Nie zmieniamy istniejących uprawnień ani publiczności starego magazynu event-files.
- Klucze synchronizacji działają tylko, gdy ich właściciel nadal jest aktywnym
  administratorem. Nie ma automatycznej synchronizacji komputerów pracowników.
  Cofnięcie dostępu blokuje kolejne żądania, ale nie kasuje pobranych kopii;
  wcześniej wydany link może działać jeszcze do 60 sekund. Dostęp do lokalnego
  dysku i udostępnienia iCloud są niezależne od CRM — nie udostępniaj głównego
  folderu innym użytkownikom, jeśli zawiera prywatne umowy lub oferty.
- Pozostałe pliki wydarzenia oraz załączniki z podpisanymi umowami pobierane są do
  „Z CRM”. Jest to chroniona kopia lokalna: jej edycja nie zastępuje automatycznie
  podpisanego oryginału. Własną poprawkę można przesłać, zapisując ją poza „Z CRM”.
- Nie propagujemy usunięć. Usunięty lokalnie plik obecny w CRM może zostać ponownie
  pobrany. Przy równoczesnych zmianach lokalny plik pozostaje nienaruszony,
  a wersja CRM trafia do „Konflikty CRM”. Zmień nazwę lokalnej wersji, aby zachować
  obie w CRM, albo świadomie zastąp ją wybraną wersją.
- Prywatny magazyn mac-crm-sync, historia wersji i kontrola wersji w transakcji
  chronią przed nadpisaniem i duplikowaniem przy ponowieniu żądania. Klucz folderu
  jest w Pęku kluczy; w CRM przechowywany jest tylko jego skrót.
- Synchronizator nie używa nieoficjalnego API iCloud. Czyta wyłącznie folder
  wskazany systemowym oknem wyboru i zapamiętany przez security-scoped bookmark.
  Przesyłanie wymaga działającego, zalogowanego Maca i sieci. Po przesłaniu pliki
  pozostają dostępne w CRM także przy wyłączonym Macu.

### Autostart i zadania

- Kolejna wersja źródeł ogranicza zadania do tej samej tablicy co `/crm/tasks`
  (`is_private=false`, `is_inquiry=false`, bez `event_id`) i bezpośredniego
  przypisania w `task_assignees` do właściciela tokenu. Administrator nie ma
  wyjątku. Tożsamość wynika z tokenu, nie z nazwy wpisanej w aplikacji.
- Nowy klient wymaga potwierdzenia `tasks_board_assigned_v1` oraz przypisania
  przy każdym zadaniu. Przy starszym backendzie zatrzymuje import z polskim
  komunikatem. Najpierw zastosuj migrację `20260911150000_personal_task_sync.sql`
  i zaktualizuj backend, następnie aplikację. Migracja ponownie sprawdza
  przypisanie w transakcji zapisującej status zadania.
- Test połączenia pokazuje konto i oddzielnie zadania aktywne oraz zamknięte.
  Zakończone zadania pozostają w protokole, aby aktualizować istniejące
  Przypomnienia. Brak zadania nigdy nie jest poleceniem kasowania danych.
- Nowa opcja „Na głównej liście tylko moje aktywne zadania” jest domyślnie
  włączona zgodnie z zatwierdzonym porządkowaniem. Po poprawnym pełnym odczycie
  osobistego zakresu przenosi stare i zamknięte przypomnienia do listy
  „Archiwum Mavinci” na tym samym koncie Apple. Nie zmienia ich statusu w CRM
  ani nie oznacza ich jako wykonane tylko po to, aby schować je z listy.
- Przeniesienie wymaga zgodnego adresu CRM oraz znacznika MAVINCI_CRM_TASK_ID
  w notatce. Ręczne pozycje, inne serwery, nierozpoznane przypomnienia,
  konflikty i niewysłane zmiany pozostają nietknięte. Przed każdym ruchem
  zapisujemy lokalny dziennik w Application Support/MavinciReminders/ArchiveMoves.
- Zamknięte zadania, których nie ma lokalnie, nie są importowane. Ponownie
  aktywne zadanie przywracamy z archiwum zamiast tworzyć nową kopię. Wyłączenie
  opcji zatrzymuje porządkowanie, ale nie przenosi masowo archiwum z powrotem.
- Widok „Wszystkie” w Apple Reminders nadal może liczyć archiwum. Bieżące
  zadania sprawdzaj na wybranej głównej liście synchronizacji (np. Mavinci CRM).
- Porządkowanie jest na razie zmianą źródeł; nie podmienia pakietu 1.1.3
  ani zainstalowanej aplikacji i nie zostało uruchomione na rzeczywistych danych.

- Nowa wersja rejestruje autostart przy pierwszym uruchomieniu przez
  SMAppService.mainApp. To start **przy logowaniu użytkownika**, nie przed
  logowaniem. Jeśli macOS wymaga zgody, ustawienia aplikacji pokażą komunikat
  i przycisk otwarcia Elementów logowania. Nie obchodzimy zgody systemowej.
- Jedna blokada procesu, jeden timer i jeden mechanizm synchronizacji dla
  kreatora pierwszego uruchomienia oraz pracy w tle. Wznowienie po wybudzeniu
  i przy odzyskaniu sieci.
- Dane zadania (tytuł, opis, termin) pochodzą z CRM. Status wykonania synchronizuje
  się w obie strony. Lokalne odhaczenia są zapisywane w kolejce przed wysłaniem
  i nie są kasowane po błędzie pojedynczego zadania.
- Konflikt zadania pozostaje widoczny jako błąd, z zachowaniem lokalnej zmiany.
  Sprawdź zadanie w CRM i ustaw świadomie uzgodniony status — zgodny stan potwierdzi
  oczekującą zmianę. Brak zadania w odpowiedzi API nie oznacza polecenia usunięcia.
- Identyczne duplikaty oznaczone ID zadania są przenoszone do Archiwum Mavinci
  bez kasowania. Różniące się kopie pozostają do sprawdzenia; nie łączymy po tytule.
- Nowy klient przekazuje token zadań w nagłówku Authorization: Bearer.
  Stary parametr token w URL jest nadal obsługiwany dla starszych instalacji.

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
