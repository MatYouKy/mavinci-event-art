/*
  # Aktualizacja systemu spotkań - wielokrotne powiązania z wydarzeniami

  1. Zmiany
    - Usunięcie kolumny `event_id` (pojedyncze powiązanie)
    - Dodanie kolumny `related_event_ids` (wielokrotne powiązania)
    - Aktualizacja indeksu

  2. Bezpieczeństwo
    - Brak zmian w RLS - wszystko pozostaje bez zmian
*/

-- Usuń stary indeks
DROP INDEX IF EXISTS idx_meetings_event_id;

-- Usuń starą kolumnę event_id
ALTER TABLE meetings DROP COLUMN IF EXISTS event_id;

-- Dodaj nową kolumnę dla tablicy wydarzeń
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS related_event_ids uuid[] DEFAULT NULL;

-- Utwórz indeks dla nowej kolumny (indeks GIN dla efektywnego wyszukiwania w tablicach)
CREATE INDEX IF NOT EXISTS idx_meetings_related_event_ids ON meetings USING GIN(related_event_ids) WHERE deleted_at IS NULL;

-- Komentarz dla dokumentacji
COMMENT ON COLUMN meetings.related_event_ids IS 'Tablica UUID wydarzeń powiązanych ze spotkaniem - pozwala na wiele powiązań';