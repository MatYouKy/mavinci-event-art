# Aplikacje desktopowe Mavinci

- `mac/` — natywna aplikacja SwiftUI dla macOS 14+. Zakres pierwszej wersji, uruchomienie i lista dalszych etapów: [instrukcja macOS](mac/README.md).
- `mobile/` w katalogu głównym pozostaje istniejącą aplikacją mobilną.
- Wspólne źródło prawdy: obecnie Supabase (Auth, RLS, istniejące RPC). Kontrakt przyszłego własnego serwera: `docs/desktop-native-api.md`.

Katalog desktop nie zastępuje `macos-sync-app/` — dotychczasowa synchronizacja Przypomnień Apple pozostaje osobnym narzędziem.
