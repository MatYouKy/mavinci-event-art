/*
  # Enable Realtime for time_entries

  1. Problem
    - Realtime nie jest włączony dla time_entries
    - Admin nie widzi zmian w czasie rzeczywistym
    - Subscription w frontendzie nie dostaje eventów

  2. Rozwiązanie
    - Włącz realtime dla tabeli time_entries
    - Pozwól na publikowanie INSERT, UPDATE, DELETE events
*/

-- Włącz realtime dla time_entries
ALTER PUBLICATION supabase_realtime ADD TABLE time_entries;

-- Opcjonalnie: możesz też wyraźnie ustawić replica identity
-- To pomoże w przypadku UPDATE/DELETE events
ALTER TABLE time_entries REPLICA IDENTITY FULL;

-- Komentarz
COMMENT ON TABLE time_entries IS 
  'Time tracking entries with realtime enabled for instant synchronization';
