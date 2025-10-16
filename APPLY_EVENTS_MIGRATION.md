# Zastosowanie migracji dla tabeli Events

Aby naprawić tabelę `events` i dodać nowe statusy, musisz zastosować migrację ręcznie w Supabase SQL Editor.

## Krok 1: Otwórz Supabase SQL Editor

1. Przejdź do [Supabase Dashboard](https://supabase.com/dashboard)
2. Wybierz swój projekt
3. W menu bocznym kliknij **SQL Editor**

## Krok 2: Wykonaj migrację

Skopiuj i wklej całą zawartość pliku `supabase/migrations/20251016120000_fix_events_table_and_add_statuses.sql` do SQL Editor i kliknij **Run**.

Lub skopiuj poniższy kod:

```sql
-- Drop the old enum type if it exists and recreate with new values
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_status') THEN
    DROP TYPE IF EXISTS event_status CASCADE;
  END IF;
END $$;

-- Create the event_status enum with all statuses including new ones
CREATE TYPE event_status AS ENUM (
  'inquiry',
  'offer_to_send',
  'offer_sent',
  'offer_accepted',
  'in_preparation',
  'in_progress',
  'completed',
  'cancelled',
  'invoiced'
);

-- Recreate events table with proper structure
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  event_date timestamptz NOT NULL,
  event_end_date timestamptz,
  location text,
  status event_status DEFAULT 'inquiry',
  budget numeric(10, 2) DEFAULT 0,
  final_cost numeric(10, 2) DEFAULT 0,
  notes text,
  attachments text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_events_updated_at ON events;
CREATE TRIGGER update_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow authenticated users to view events" ON events;
DROP POLICY IF EXISTS "Allow authenticated users to insert events" ON events;
DROP POLICY IF EXISTS "Allow authenticated users to update events" ON events;
DROP POLICY IF EXISTS "Allow authenticated users to delete events" ON events;

-- Create RLS policies for events
CREATE POLICY "Allow authenticated users to view events"
  ON events FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert events"
  ON events FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update events"
  ON events FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete events"
  ON events FOR DELETE
  TO authenticated
  USING (true);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_events_event_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_client_id ON events(client_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
```

## Krok 3: Sprawdź czy migracja się powiodła

Uruchom to zapytanie aby sprawdzić czy tabela została utworzona:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'events';
```

## Nowe statusy wydarzeń

Po migracji będziesz mógł używać następujących statusów:

- **inquiry** (Zapytanie) - nowy status dla początkowych zapytań
- **offer_to_send** (Oferta do wysłania) - nowy status gdy oferta jest gotowa do wysłania
- **offer_sent** (Oferta wysłana) - oferta została wysłana do klienta
- **offer_accepted** (Oferta zaakceptowana) - klient zaakceptował ofertę
- **in_preparation** (W przygotowaniu) - event w trakcie przygotowań
- **in_progress** (W trakcie) - event w trakcie realizacji
- **completed** (Zakończony) - event został zakończony
- **cancelled** (Anulowany) - event został anulowany
- **invoiced** (Rozliczony) - event został rozliczony finansowo
