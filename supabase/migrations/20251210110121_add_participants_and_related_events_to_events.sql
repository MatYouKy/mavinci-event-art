/*
  # Dodaj uczestników i powiązane wydarzenia do tabeli events

  1. Zmiany
    - Dodaj kolumnę `participants` (JSONB array) - przechowuje listę uczestników wydarzenia
      - Każdy uczestnik zawiera: type ('employee' | 'contact' | 'manual'), id (uuid lub null), name (string)
    - Dodaj kolumnę `related_event_ids` (UUID array) - przechowuje IDs powiązanych wydarzeń
    
  2. Indeksy
    - Dodaj indeks GIN dla kolumny participants (JSONB)
    - Dodaj indeks GIN dla kolumny related_event_ids (array)
*/

-- Dodaj kolumnę participants (JSONB array z uczestnikami)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'participants'
  ) THEN
    ALTER TABLE events ADD COLUMN participants JSONB DEFAULT '[]'::JSONB;
  END IF;
END $$;

-- Dodaj kolumnę related_event_ids (UUID array)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'related_event_ids'
  ) THEN
    ALTER TABLE events ADD COLUMN related_event_ids UUID[] DEFAULT ARRAY[]::UUID[];
  END IF;
END $$;

-- Dodaj indeks GIN dla participants (JSONB)
CREATE INDEX IF NOT EXISTS idx_events_participants_gin ON events USING GIN (participants);

-- Dodaj indeks GIN dla related_event_ids (array)
CREATE INDEX IF NOT EXISTS idx_events_related_event_ids_gin ON events USING GIN (related_event_ids);

-- Dodaj komentarze opisujące strukturę
COMMENT ON COLUMN events.participants IS 'Array of event participants: [{type: "employee"|"contact"|"manual", id: "uuid or null", name: "string"}]';
COMMENT ON COLUMN events.related_event_ids IS 'Array of related event IDs for grouping connected events';
