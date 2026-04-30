/*
  # Event Calculations System

  ## Summary
  Adds a calculations system for events. Each event can have multiple calculations.
  Each calculation contains items grouped by category: equipment, staff (people),
  transport, and other. Items can be imported from offer products or added manually.

  ## New Tables
  1. `event_calculations`
      - `id` (uuid, PK)
      - `event_id` (uuid, FK -> events, cascade)
      - `name` (text) - name of the calculation (e.g. "Wariant 1", "Kalkulacja dla klienta")
      - `notes` (text) - optional notes
      - `created_by` (uuid, FK -> employees)
      - `created_at` / `updated_at` (timestamptz)

  2. `event_calculation_items`
      - `id` (uuid, PK)
      - `calculation_id` (uuid, FK -> event_calculations, cascade)
      - `category` (text) - one of: equipment, staff, transport, other
      - `name` (text) - item name
      - `description` (text) - optional details
      - `unit` (text) - unit of measure (szt., h, dni, km)
      - `quantity` (numeric)
      - `unit_price` (numeric) - net price per unit
      - `days` (numeric) - optional multiplier for multi-day bookings
      - `source` (text) - "offer" or "manual"
      - `source_ref` (uuid) - optional reference to offer item or similar
      - `position` (integer) - order within category
      - `created_at` (timestamptz)

  ## Security
  Both tables get RLS enabled. Authenticated employees may manage calculations
  for events they can access (delegates to existing events RLS via EXISTS).
*/

CREATE TABLE IF NOT EXISTS event_calculations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Kalkulacja',
  notes text DEFAULT '',
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_calculations_event_id ON event_calculations(event_id);

CREATE TABLE IF NOT EXISTS event_calculation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calculation_id uuid NOT NULL REFERENCES event_calculations(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'equipment',
  name text NOT NULL DEFAULT '',
  description text DEFAULT '',
  unit text NOT NULL DEFAULT 'szt.',
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  days numeric NOT NULL DEFAULT 1,
  source text NOT NULL DEFAULT 'manual',
  source_ref uuid,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT event_calculation_items_category_check
    CHECK (category IN ('equipment', 'staff', 'transport', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_event_calculation_items_calc_id
  ON event_calculation_items(calculation_id);

ALTER TABLE event_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_calculation_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'event_calculations' AND policyname = 'event_calculations_select'
  ) THEN
    CREATE POLICY "event_calculations_select"
      ON event_calculations FOR SELECT
      TO authenticated
      USING (
        EXISTS (SELECT 1 FROM events e WHERE e.id = event_calculations.event_id)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'event_calculations' AND policyname = 'event_calculations_insert'
  ) THEN
    CREATE POLICY "event_calculations_insert"
      ON event_calculations FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM events e WHERE e.id = event_calculations.event_id)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'event_calculations' AND policyname = 'event_calculations_update'
  ) THEN
    CREATE POLICY "event_calculations_update"
      ON event_calculations FOR UPDATE
      TO authenticated
      USING (
        EXISTS (SELECT 1 FROM events e WHERE e.id = event_calculations.event_id)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM events e WHERE e.id = event_calculations.event_id)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'event_calculations' AND policyname = 'event_calculations_delete'
  ) THEN
    CREATE POLICY "event_calculations_delete"
      ON event_calculations FOR DELETE
      TO authenticated
      USING (
        EXISTS (SELECT 1 FROM events e WHERE e.id = event_calculations.event_id)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'event_calculation_items' AND policyname = 'event_calculation_items_select'
  ) THEN
    CREATE POLICY "event_calculation_items_select"
      ON event_calculation_items FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM event_calculations c
          JOIN events e ON e.id = c.event_id
          WHERE c.id = event_calculation_items.calculation_id
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'event_calculation_items' AND policyname = 'event_calculation_items_insert'
  ) THEN
    CREATE POLICY "event_calculation_items_insert"
      ON event_calculation_items FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM event_calculations c
          WHERE c.id = event_calculation_items.calculation_id
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'event_calculation_items' AND policyname = 'event_calculation_items_update'
  ) THEN
    CREATE POLICY "event_calculation_items_update"
      ON event_calculation_items FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM event_calculations c
          WHERE c.id = event_calculation_items.calculation_id
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM event_calculations c
          WHERE c.id = event_calculation_items.calculation_id
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'event_calculation_items' AND policyname = 'event_calculation_items_delete'
  ) THEN
    CREATE POLICY "event_calculation_items_delete"
      ON event_calculation_items FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM event_calculations c
          WHERE c.id = event_calculation_items.calculation_id
        )
      );
  END IF;
END $$;
