# Mavinci Reminders 1.4

## Poprawki synchronizacji
- Jedna, zachowana instancja EventKit obsługuje zgodę macOS, wybór list i synchronizację.
- Odświeżenie lokalnego odczytu EventKit po uzyskaniu zgody, przed pobraniem list. Nie resetuje danych ani uprawnień systemowych.
- Wybrana lista jest identyfikowana po ID, także gdy różne konta mają listy o tej samej nazwie.
- Pusta istniejąca lista pozwala odtworzyć aktualne zadania z CRM; brak odpowiedzi systemu nie jest traktowany jako pusta lista.
- Brak automatycznego tworzenia zastępczej listy po błędzie. Nową listę tworzy się wyłącznie na wyraźne żądanie w konfiguracji.
- Błędy Przypomnień, plików i CRM są rozdzielone. Polski wybór list z przyciskiem odświeżania.
- Zachowane ograniczenie do własnych zadań, domyślnie tylko aktywnych. Stare zadania są archiwizowane, nie kasowane; niewysłane zmiany pozostają chronione.
- Jedna ikona z sygnetem i blokada jednoczesnego uruchamiania kopii nowej aplikacji.

## Instalacja
Zakończ wszystkie stare kopie. Otwórz DMG i zastąp aplikację w folderze Aplikacje. Uruchamiaj wyłącznie tę kopię. Zezwól na dostęp do Przypomnień, jeżeli macOS o niego poprosi. Nie usuwaj zadań, tokenu ani ustawień.

Wydanie lokalne Apple Silicon, podpisane ad-hoc, bez notaryzacji Apple. Zmiana podpisu pomiędzy wydaniami może wymagać ponownego nadania dostępu przez użytkownika. Pełne potwierdzenie synchronizacji na koncie użytkownika wymaga uruchomienia zainstalowanej aplikacji z jego zgodą; nie wykonujemy synchronizacji na danych użytkownika podczas budowania.
