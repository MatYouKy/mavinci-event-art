# Mavinci Desktop: kontrakt własnego serwera v1

Stan: przygotowany klient i kontrakt; własny serwer oraz migracja bazy **nie są wdrożone**. Tryb domyślny klienta używa bezpośrednio Supabase i obecnych RLS/RPC. Wszystkie adresy poniżej dotyczą przyszłego trybu „Własny serwer”.

HTTPS obowiązkowy, HTTP dozwolony wyłącznie na localhost. JSON UTF-8, daty ISO 8601, identyfikatory jako tekst. Poza login/refresh: `Authorization: Bearer <access_token>`. Serwer sam ustala pracownika — identyfikator z klienta nie jest źródłem uprawnień. Własny serwer nie otrzymuje nagłówka `apikey` Supabase.

## Sesja

`POST /api/native/v1/login` — `{email,password}`.

`POST /api/native/v1/refresh` — `{refresh_token}`.

Odpowiedzi w formacie `{access_token,refresh_token,expires_at,expires_in,user:{id}}`. `expires_at` jest czasem Unix w sekundach. Tokeny powinny być rotowane, powiązane z kontem, urządzeniem, serwerem i zakresem. Klient przechowuje tokeny wyłącznie w pęku kluczy, odświeża przed upływem ważności i nie ponawia automatycznie zapisów.

`POST /api/native/v1/logout` — unieważnienie bieżącej sesji. Klient usuwa lokalną sesję nawet przy braku internetu.

`GET /api/native/v1/me` — profil pracownika w formacie `Employee` z `Domain.swift`: wymagane `id`, `auth_user_id`, `name`, `surname`, `is_active`; pozostałe pola opcjonalne: `role`, `access_level`, `permissions`, `finance_access_scope`, `company_access_mode`, `my_company_ids`, `invoice_company_permissions`, `sales_team_id`. Profil zawiera aktualne efektywne uprawnienia. Zmiana profilu unieważnia kopię klienta.

## Synchronizacja

`POST /api/native/v1/sync` — `{p_set:"tasks",p_hashes:{"0":"hash",...}}`.

Zbiory: tasks, inquiries, contacts, events, offers, tenders, notifications. Kształt rekordów jest opisany w `HTTPBackend.*Fields` oraz migracji `20261101160000_native_workspace_sync.sql`. `id` to zawsze niepusty unikalny tekst. Powiadomienia używają ID wiersza odbiorcy, a nie wspólnego ID komunikatu.

Odpowiedź: `{hashes:{"0":"hash",..."f":"hash"},changed:{"a":[{id:"...",...}],"b":[]}}`. Zawsze 16 skrótów, zmienione kubełki mają pełną aktualną zawartość, usunięcia dają pustą tablicę. Algorytm podziału: pierwszy znak szesnastkowy MD5 identyfikatora. Serwer może stosować własny deterministyczny skrót treści, ale musi reagować także na usunięcia, zmiany powiązań i zakresów. Nie wolno ufać samemu `updated_at`.

Każdy odczyt wymusza zakres konta, firmy, zespołu i danych osobowych/finansowych. Nie wysyłaj danych spoza uprawnień. Widok wydarzenia pierwszej wersji nie wymaga żadnych pól finansowych, a lista ofert nie wymaga kwot.

`POST /api/native/v1/sales-day` — `{}`; odpowiedź zgodna z istniejącym `get_my_sales_day`: followups, waiting_offers, tenders, pipeline, unscheduled_inquiries.

## Czynności

`POST /api/native/v1/command` — `{command,id,...payload}`. Serwer wymusza istniejące reguły, uprawnienia, zasięg i historię. Odpowiedź 2xx wyłącznie po potwierdzonym, atomowym zapisie.

| command | Dane |
| --- | --- |
| task_create | title, description, priority, status, board_column, due_date, created_by; serwer ustala rzeczywistego autora i właściciela, tworzy prywatne zadanie i przypisanie atomowo |
| task_update | id, expected_updated_at, title, description, priority, status, board_column, due_date, opcjonalnie currently_working_by; serwer odrzuca nieaktualną wersję |
| notification_read | id odbiorcy; tylko własne powiadomienie |
| claim_inquiry | id zapytania, przypisanie do bieżącego pracownika |
| complete_inquiry_followup | id, p_next_action_at ISO/null; zachowanie jak istniejące RPC |
| snooze_inquiry_followup | id, p_minutes; zachowanie jak istniejące RPC |

Dla tworzenia potrzebna będzie obsługa kluczy idempotencji przed wdrożeniem automatycznych ponowień lub kolejki offline. Obecny klient nie ma takiej kolejki i nie ponawia samoczynnie zapisów.

Błędy: 401 sesja nieaktywna, 403 brak uprawnień, 409 konflikt wersji, pozostałe 4xx/5xx niepowodzenie. Nie zwracaj stosów, SQL ani sekretów. Klient wyświetla własne polskie komunikaty. Do rozbudowanych formularzy należy dodać błędy pól i wspólny protokół formularzy, równocześnie dla macOS, mobile i WWW.


## Rozszerzenie 0.2 — kalendarz i wydarzenia

Zbiór synchronizacji `calendar` zawiera znormalizowane wydarzenia i własne / zaproszone spotkania z `id`, `source_id`, `kind` (`event` / `meeting`), `name`, `event_date`, `event_end_date`, `location` oraz `status`. ID spotkania ma prefiks `meeting:`. Spotkania cykliczne są materializowane przez serwer — nie twórz drugiej reguły cyklu w kliencie. Lokalne terminy zapytań są dodawane do kalendarza wewnętrznego z istniejącego zbioru inquiries. Powiązanie EventKit nie wymaga nowego uprawnienia CRM i nie zapisuje prywatnych danych Apple do API.

Przyszły własny serwer powinien dodatkowo implementować:

- `GET /api/native/v1/events/<id>` — `EventPageCache` z aktualnym `EventAccess`: dozwolone zakładki, manage, serwerowy zakres finance, opcjonalny workflow i własne przypisanie. Nie ufaj uprawnieniom przesłanym przez klienta.
- `GET /api/native/v1/events/<id>/tabs/<tab>` — mapa zbiorów `[nazwa:[rekordy]]`, zgodna z `EventBackend.eventSections`; każda zakładka wymaga autoryzacji przed pobraniem danych.
- `GET /api/native/v1/options/<table>` — autoryzowane słowniki formularzy, obecnie pracownicy i kategorie kosztów.
- `POST /api/native/v1/events/<id>/form` — table, id, expected_updated_at, payload, fixed; serwer traktuje je wyłącznie jako żądanie, narzuca listę dozwolonych operacji / pól i prawidłowe powiązania. Specjalne formularze `__manager` i `__complete` odpowiadają istniejącym procesom wyznaczenia kierownika / zakończenia realizacji. Operacje nie mogą być ogólnym, dowolnym zapisem tabel.
- `POST /api/native/v1/events/<id>/workflow` — action start / accept_warehouse / ready_warehouse; te same atomowe kontrole co istniejące funkcje Supabase.
- `GET /api/native/v1/files?path=...` — bajty autoryzowanego pliku, bez publicznego adresu.
- `POST /api/native/v1/events/<id>/files?name=...&folder_id=...` — bajty pliku i właściwy Content-Type; autoryzacja folderu, limit i spójne metadata po stronie serwera.

Własny serwer nadal nie jest wdrożony. Część wyspecjalizowanych operacji (np. załadunek konkretnej pozycji) wymaga dalszego uzupełnienia kontraktu przed użyciem tego trybu produkcyjnie. Obecna wersja pracuje przez Supabase.


## Rozszerzenie 0.3 — listy, kontakty i przetargi

Supabase: klient używa native_workspace_sync_v3 z tym samym protokołem kubełków. Zbiory mają dodatkowo pola zadeklarowane w HTTPBackend.contactFields / offerFields / tenderFields, metadata w notifications i kolory kategorii w calendar. Własny serwer musi zwracać ten bogatszy kształt rekordów przez swój dotychczasowy endpoint sync; kalendarz i lista wydarzeń bazują na jednym autoryzowanym zbiorze calendar.

Dodatkowe trasy przygotowane w kliencie (własny serwer nadal niewdrożony):

- GET /api/native/v1/records/<module>/<id>: pojedynczy dostępny rekord, także poza filtrami listy; moduły contacts, tenders, tasks/inquiries, offers, events, calendar (spotkanie normalizowane jak w kalendarzu).
- PATCH /api/native/v1/records/<module>/<id>: {values, expected_updated_at}; tylko contacts lub tenders. Serwer narzuca allowlistę pól i aktualne uprawnienia, odrzuca konflikt oraz zwraca potwierdzony rekord w bogatym kształcie.
- POST /api/native/v1/tenders/<id>/action: {action:assign|release|inquiry}; bieżący pracownik wynika z tokenu; zachowanie równoważne istniejącym RPC. Dla inquiry odpowiedź to ID zapytania jako JSON string.
- POST /api/native/v1/notifications/read-all: oznacza wyłącznie własne powiadomienia bieżącego pracownika.

Kanban używa istniejącego polecenia task_update. Zmiana kolumny ustawia board_column i status; poza in_progress czyści currently_working_by. Nie ma kolejki offline ani optymistycznego potwierdzenia zapisu. Zakresy danych i przejścia stanów pozostają na serwerze.
