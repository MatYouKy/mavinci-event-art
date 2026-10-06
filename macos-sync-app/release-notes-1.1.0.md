# Mavinci Reminders 1.1.0 (2)

Wydanie lokalne dla Apple Silicon, macOS 13 lub nowszego.
Podpis ad-hoc, bez certyfikatu Developer ID i bez notaryzacji Apple.
Nie jest to pakiet zatwierdzony do publicznej dystrybucji bez ostrzeżeń Gatekeepera.

## Zmiany

- Synchronizacja zadań z ochroną przed powielaniem i nakładającymi się cyklami.
- Dwukierunkowa synchronizacja plików z wybranego katalogu Mac / iCloud Drive.
- Automatyczna struktura CRM/events/RRRR-MM-DD/Nazwa wydarzenia.
- Foldery Umowy, Oferty, Pliki i Prywatne oraz kontrola widoczności w CRM.
- Zachowywanie konfliktujących wersji, bez propagowania usunięć plików.
- Autostart przy logowaniu, z uwzględnieniem zgody w ustawieniach macOS.

## Aktualizacja

1. Zaktualizuj backend CRM, w tym endpoint synchronizacji zadań i plików.
   Zastosuj kolejno migracje 20260911230000_mac_folder_sync.sql oraz
   20260911233000_mac_root_catalog.sql, jeżeli nie są jeszcze zastosowane.
2. Zakończ starą aplikację z paska menu. Nie uruchamiaj dwóch wersji równolegle.
3. Otwórz DMG i przenieś Mavinci Reminders.app do Aplikacji, zastępując starą wersję.
4. Uruchom aplikację z Aplikacji. macOS może ponownie poprosić o dostęp do
   Przypomnień, Pęku kluczy lub zgodę na działanie przy logowaniu.
5. Dla plików wygeneruj w CRM klucz całego katalogu i wskaż folder CRM
   w Ustawieniach aplikacji → Pliki.

Zachowano identyfikator poprzedniego wydania pl.mavinci.reminders i dotychczasowe
lokalizacje ustawień. Nie usuwaj Przypomnień ani konfiguracji przed aktualizacją.
Synchronizacja całego katalogu jest przeznaczona dla administratora. Uprawnienia
CRM nie cofają wcześniej pobranych kopii i nie sterują udostępnieniami iCloud.

Kompilacja i kontrola integralności pakietu nie zastępują sprawdzenia synchronizacji
na działającym CRM. Przy przygotowaniu wydania aplikacja nie jest uruchamiana
i nie zmienia rzeczywistych zadań ani dokumentów.
