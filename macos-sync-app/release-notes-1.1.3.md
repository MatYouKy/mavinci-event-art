# Mavinci Reminders 1.1.3 (3)

Apple Silicon, macOS 13+. Wydanie lokalne z podpisem ad-hoc, bez notaryzacji Apple.

## Naprawy i diagnostyka

- Ustawienia otwierają się przez własne, pojedyncze okno zamiast nieskutecznego
  polecenia showSettingsWindow wysyłanego do łańcucha responderów.
- Menu udostępnia pełny błąd synchronizacji i przycisk kopiowania komunikatu.
- Po nieudanym pobraniu pokazujemy „nie odczytano listy”, nie pozorne 0 zadań.
- Brak zgody na Przypomnienia jest zgłaszany wprost, bez pozornego sukcesu.
- Polski opis stanów i błędów, numer wersji w menu, monochromatyczny sygnet.
- Weryfikacja osobistego zakresu zadań przed importem: tylko /crm/tasks i własne
  przypisania, również dla administratora. Osobne liczniki aktywnych i zamkniętych.

## Wymagana zgodność z CRM

Przed aktualizacją aplikacji wdróż aktualny /bridge/tasks/sync i zastosuj migrację
20260911150000_personal_task_sync.sql. Starszy backend nie potwierdza
tasks_board_assigned_v1, więc klient celowo zatrzyma import z jasnym komunikatem.
To zabezpieczenie przed pobraniem zadań z niewłaściwego zakresu.

Dla synchronizacji plików nadal wymagane są migracje
20260911230000_mac_folder_sync.sql i 20260911233000_mac_root_catalog.sql
oraz aktualne endpointy mac-sync. Nie wykonuj ponownie już zastosowanych migracji.

## Instalacja

Zamknij starą aplikację z paska menu, zastąp ją nową w Aplikacjach i uruchom
stamtąd. Nie usuwaj zadań, Pęku kluczy ani konfiguracji. Stare pozycje spoza
zakresu nie są automatycznie kasowane. Jeżeli nadal wystąpi błąd, wybierz
„Pokaż błąd synchronizacji…” → „Kopiuj komunikat”.

Pakowanie i testy nie uruchamiają synchronizacji z żywym CRM. To wydanie nie
potwierdza przyczyny błędu konkretnego konta bez jego komunikatu diagnostycznego.
