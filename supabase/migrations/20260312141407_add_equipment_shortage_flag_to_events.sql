/*
  # Dodaj flagę braków sprzętowych do events

  1. Problem
    - Oferty mogą być tworzone z konfliktami sprzętowymi (użytkownik wybiera "dodaj mimo to")
    - Nie ma sposobu na oznaczenie że event ma braki sprzętowe

  2. Rozwiązanie
    - Dodaj pole `has_equipment_shortage` do tabeli `events`
    - Pole boolean, domyślnie false
    - Aktualizowane przy tworzeniu oferty z konfliktami

  3. Użycie
    - Frontend: przy tworzeniu oferty z konfliktami ustaw flagę na true
    - UI: pokazuj ostrzeżenie gdy event ma braki sprzętowe
*/

-- Dodaj pole has_equipment_shortage
ALTER TABLE events
ADD COLUMN IF NOT EXISTS has_equipment_shortage boolean DEFAULT false;

-- Dodaj komentarz
COMMENT ON COLUMN events.has_equipment_shortage IS
'Flaga wskazująca że event ma braki sprzętowe (utworzono ofertę z konfliktami)';

-- Indeks dla szybkiego filtrowania eventów z brakami
CREATE INDEX IF NOT EXISTS idx_events_equipment_shortage
ON events(has_equipment_shortage)
WHERE has_equipment_shortage = true;
