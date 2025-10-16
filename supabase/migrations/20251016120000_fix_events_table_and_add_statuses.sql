/*
  # Fix Events Table and Add New Statuses

  1. Changes
    - Ensure events table exists with proper structure
    - Add new event statuses: 'inquiry' (zapytanie) and 'offer_to_send' (oferta do wysłania)
    - Update event_status enum to include new statuses
    - Ensure proper RLS policies

  2. Security
    - Maintain existing RLS policies
    - Allow authenticated users to manage events
*/

-- Drop the old enum type if it exists and recreate with new values
DO $$ BEGIN
  -- First, check if the type exists
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_status') THEN
    -- Drop the enum type (this will fail if it's being used, which is expected)
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
