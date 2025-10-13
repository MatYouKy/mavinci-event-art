/*
  # Dodanie miniaturki do jednostek i typu zdarzenia sprzedaż

  ## Zmiany
  1. Dodanie pola `thumbnail_url` do `equipment_units`
     - Miniaturka/zdjęcie jednostki
  
  2. Rozszerzenie typów zdarzeń o 'sold' (sprzedaż)
     - Po dodaniu zdarzenia sprzedaży jednostka może być usunięta

  ## Notatki
  - Każda jednostka może mieć własne zdjęcie
  - Zdarzenie "repair" anuluje uszkodzenie i wraca status na "available"
  - Zdarzenie "sold" oznacza że jednostka została sprzedana
*/

-- Dodaj pole thumbnail_url do jednostek
ALTER TABLE equipment_units
ADD COLUMN IF NOT EXISTS thumbnail_url text;

-- Zaktualizuj constraint dla event_type - dodaj 'sold'
ALTER TABLE equipment_unit_events DROP CONSTRAINT IF EXISTS equipment_unit_events_event_type_check;

ALTER TABLE equipment_unit_events
ADD CONSTRAINT equipment_unit_events_event_type_check
CHECK (event_type IN ('damage', 'repair', 'service', 'status_change', 'note', 'inspection', 'sold'));

COMMENT ON COLUMN equipment_units.thumbnail_url IS 'Zdjęcie/miniaturka jednostki sprzętu';
COMMENT ON COLUMN equipment_unit_events.event_type IS 'Typ zdarzenia: damage (uszkodzenie), repair (naprawa - anuluje uszkodzenie), service (serwis), status_change (zmiana statusu), note (notatka), inspection (inspekcja), sold (sprzedaż)';