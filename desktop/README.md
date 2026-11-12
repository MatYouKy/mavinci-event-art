# Aplikacje desktopowe Mavinci

- `mac/` — natywna aplikacja SwiftUI dla macOS 14+. Zakres pierwszej wersji, uruchomienie i lista dalszych etapów: [instrukcja macOS](mac/README.md).
- `mobile/` w katalogu głównym pozostaje istniejącą aplikacją mobilną.
- Wspólne źródło prawdy: obecnie Supabase (Auth, RLS, istniejące RPC). Kontrakt przyszłego własnego serwera: `docs/desktop-native-api.md`.

Aplikacja na Maca zastąpiła `macos-sync-app/` (usunięte): pliki wydarzeń są w Finderze („Mavinci” w pasku bocznym), a sygnet ze stanem jest na pasku menu. Synchronizacji Przypomnień Apple jeszcze nie przeniesiono — serwer `/bridge/tasks/sync` zostaje dla zainstalowanych kopii „Mavinci Reminders”.
