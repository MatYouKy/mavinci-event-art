/*
  # Add Event Details Tables

  ## New Tables

  1. `event_equipment`
    - Links equipment to events
    - Tracks quantity needed and notes
    - Columns: id, event_id, equipment_id, quantity, notes, created_at

  2. `event_employees`
    - Assigns employees to events
    - Tracks roles and responsibilities
    - Columns: id, event_id, employee_id, role, notes, created_at

  3. `event_checklists`
    - Manages checklists for events
    - Columns: id, event_id, title, items (jsonb), created_at, updated_at

  4. `checklist_items` (embedded in event_checklists as JSONB)
    - Structure: { id, text, completed, assigned_to, due_date, notes }

  ## Security
    - Enable RLS on all tables
    - Add policies for authenticated users
*/

-- Event Equipment Assignment Table
CREATE TABLE IF NOT EXISTS event_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  equipment_id uuid REFERENCES equipment(id) ON DELETE CASCADE NOT NULL,
  quantity integer DEFAULT 1,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE event_equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view event equipment"
  ON event_equipment FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert event equipment"
  ON event_equipment FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update event equipment"
  ON event_equipment FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete event equipment"
  ON event_equipment FOR DELETE
  TO authenticated
  USING (true);

-- Event Employees Assignment Table
CREATE TABLE IF NOT EXISTS event_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  role text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE event_employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view event employees"
  ON event_employees FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert event employees"
  ON event_employees FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update event employees"
  ON event_employees FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete event employees"
  ON event_employees FOR DELETE
  TO authenticated
  USING (true);

-- Event Checklists Table
CREATE TABLE IF NOT EXISTS event_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  items jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE event_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view event checklists"
  ON event_checklists FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert event checklists"
  ON event_checklists FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update event checklists"
  ON event_checklists FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete event checklists"
  ON event_checklists FOR DELETE
  TO authenticated
  USING (true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_event_equipment_event_id ON event_equipment(event_id);
CREATE INDEX IF NOT EXISTS idx_event_equipment_equipment_id ON event_equipment(equipment_id);
CREATE INDEX IF NOT EXISTS idx_event_employees_event_id ON event_employees(event_id);
CREATE INDEX IF NOT EXISTS idx_event_employees_employee_id ON event_employees(employee_id);
CREATE INDEX IF NOT EXISTS idx_event_checklists_event_id ON event_checklists(event_id);
