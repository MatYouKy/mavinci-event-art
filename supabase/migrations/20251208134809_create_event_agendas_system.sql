/*
  # Create Event Agendas System

  1. New Tables
    - `event_agendas`
      - `id` (uuid, primary key)
      - `event_id` (uuid, references events)
      - `event_name` (text)
      - `event_date` (date)
      - `start_time` (time)
      - `end_time` (time)
      - `client_contact` (text)
      - `created_by` (uuid, references employees)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `event_agenda_items`
      - `id` (uuid, primary key)
      - `agenda_id` (uuid, references event_agendas)
      - `time` (time)
      - `title` (text)
      - `description` (text)
      - `order_index` (integer)
      - `created_at` (timestamptz)
    
    - `event_agenda_notes`
      - `id` (uuid, primary key)
      - `agenda_id` (uuid, references event_agendas)
      - `parent_id` (uuid, nullable, self-reference for nesting)
      - `content` (text)
      - `order_index` (integer)
      - `level` (integer, 0=top, 1=sub, 2=subsub)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Only authenticated employees with events_view permission can read agendas
    - Only employees with events_manage permission can create/update agendas
*/

-- Create event_agendas table
CREATE TABLE IF NOT EXISTS event_agendas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  event_date date NOT NULL,
  start_time time,
  end_time time,
  client_contact text,
  created_by uuid REFERENCES employees(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(event_id)
);

-- Create event_agenda_items table
CREATE TABLE IF NOT EXISTS event_agenda_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agenda_id uuid NOT NULL REFERENCES event_agendas(id) ON DELETE CASCADE,
  time time NOT NULL,
  title text NOT NULL,
  description text,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Create event_agenda_notes table (hierarchical)
CREATE TABLE IF NOT EXISTS event_agenda_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agenda_id uuid NOT NULL REFERENCES event_agendas(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES event_agenda_notes(id) ON DELETE CASCADE,
  content text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  level integer NOT NULL DEFAULT 0 CHECK (level >= 0 AND level <= 2),
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_event_agendas_event_id ON event_agendas(event_id);
CREATE INDEX IF NOT EXISTS idx_event_agenda_items_agenda_id ON event_agenda_items(agenda_id);
CREATE INDEX IF NOT EXISTS idx_event_agenda_items_order ON event_agenda_items(agenda_id, order_index);
CREATE INDEX IF NOT EXISTS idx_event_agenda_notes_agenda_id ON event_agenda_notes(agenda_id);
CREATE INDEX IF NOT EXISTS idx_event_agenda_notes_parent_id ON event_agenda_notes(parent_id);
CREATE INDEX IF NOT EXISTS idx_event_agenda_notes_order ON event_agenda_notes(agenda_id, parent_id, order_index);

-- Enable RLS
ALTER TABLE event_agendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_agenda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_agenda_notes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for event_agendas
CREATE POLICY "Employees with events_view can read agendas"
  ON event_agendas FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (
          'events_view' = ANY(employees.permissions)
          OR 'admin' = ANY(employees.permissions)
        )
    )
  );

CREATE POLICY "Employees with events_manage can insert agendas"
  ON event_agendas FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (
          'events_manage' = ANY(employees.permissions)
          OR 'admin' = ANY(employees.permissions)
        )
    )
  );

CREATE POLICY "Employees with events_manage can update agendas"
  ON event_agendas FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (
          'events_manage' = ANY(employees.permissions)
          OR 'admin' = ANY(employees.permissions)
        )
    )
  );

CREATE POLICY "Employees with events_manage can delete agendas"
  ON event_agendas FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (
          'events_manage' = ANY(employees.permissions)
          OR 'admin' = ANY(employees.permissions)
        )
    )
  );

-- RLS Policies for event_agenda_items
CREATE POLICY "Employees can read agenda items"
  ON event_agenda_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (
          'events_view' = ANY(employees.permissions)
          OR 'admin' = ANY(employees.permissions)
        )
    )
  );

CREATE POLICY "Employees with events_manage can insert agenda items"
  ON event_agenda_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (
          'events_manage' = ANY(employees.permissions)
          OR 'admin' = ANY(employees.permissions)
        )
    )
  );

CREATE POLICY "Employees with events_manage can update agenda items"
  ON event_agenda_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (
          'events_manage' = ANY(employees.permissions)
          OR 'admin' = ANY(employees.permissions)
        )
    )
  );

CREATE POLICY "Employees with events_manage can delete agenda items"
  ON event_agenda_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (
          'events_manage' = ANY(employees.permissions)
          OR 'admin' = ANY(employees.permissions)
        )
    )
  );

-- RLS Policies for event_agenda_notes
CREATE POLICY "Employees can read agenda notes"
  ON event_agenda_notes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (
          'events_view' = ANY(employees.permissions)
          OR 'admin' = ANY(employees.permissions)
        )
    )
  );

CREATE POLICY "Employees with events_manage can insert agenda notes"
  ON event_agenda_notes FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (
          'events_manage' = ANY(employees.permissions)
          OR 'admin' = ANY(employees.permissions)
        )
    )
  );

CREATE POLICY "Employees with events_manage can update agenda notes"
  ON event_agenda_notes FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (
          'events_manage' = ANY(employees.permissions)
          OR 'admin' = ANY(employees.permissions)
        )
    )
  );

CREATE POLICY "Employees with events_manage can delete agenda notes"
  ON event_agenda_notes FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (
          'events_manage' = ANY(employees.permissions)
          OR 'admin' = ANY(employees.permissions)
        )
    )
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_event_agendas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trigger_update_event_agendas_updated_at ON event_agendas;
CREATE TRIGGER trigger_update_event_agendas_updated_at
  BEFORE UPDATE ON event_agendas
  FOR EACH ROW
  EXECUTE FUNCTION update_event_agendas_updated_at();
