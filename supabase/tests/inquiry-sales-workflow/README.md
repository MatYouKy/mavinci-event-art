# Izolowane testy kontraktowe sprzedaży

Uruchomienie w tym katalogu: `yarn install`, następnie `yarn test`.

PGlite działa wyłącznie w pamięci. Skrypt nie czyta `.env`, nie łączy się z Supabase i nie wysyła wiadomości. Fixture zawiera minimalne tabele i zastępcze zależności potrzebne do testowania nowych funkcji; nie jest kopią produkcyjnego schematu. Szczególnie nie dowodzi poprawności wszystkich istniejących polityk RLS, triggerów, renderowania PDF ani transportu SMTP.
