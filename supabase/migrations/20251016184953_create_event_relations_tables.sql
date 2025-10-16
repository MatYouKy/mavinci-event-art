/*
  # Create Event Relations Tables

  1. New Tables
    - `event_equipment` - Links equipment items to events
      - `id` (uuid, primary key)
      - `event_id` (uuid, foreign key to events)
      - `equipment_id` (uuid, foreign key to equipment_items)
      - `quantity` (integer)
      - `notes` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `event_employees` - Assigns employees to events
      - `id` (uuid, primary key)
      - `event_id` (uuid, foreign key to events)
      - `employee_id` (uuid, foreign key to employees)
      - `role` (text)
      - `notes` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `event_checklists` - Manages checklists for events
      - `id` (uuid, primary key)
      - `event_id` (uuid, foreign key to events)
      - `title` (text)
      - `items` (jsonb)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Users with events_manage permission can access
*/

-- Event Equipment Assignment Table
CREATE TABLE IF NOT EXISTS event_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  quantity integer DEFAULT 1,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Event Employees Assignment Table
CREATE TABLE IF NOT EXISTS event_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Event Checklists Table
CREATE TABLE IF NOT EXISTS event_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title text NOT NULL,
  items jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add completed_at and completed_by columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'event_checklists' AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE event_checklists ADD COLUMN completed_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'event_checklists' AND column_name = 'completed_by'
  ) THEN
    ALTER TABLE event_checklists ADD COLUMN completed_by uuid REFERENCES employees(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_event_equipment_event_id ON event_equipment(event_id);
CREATE INDEX IF NOT EXISTS idx_event_equipment_equipment_id ON event_equipment(equipment_id);
CREATE INDEX IF NOT EXISTS idx_event_employees_event_id ON event_employees(event_id);
CREATE INDEX IF NOT EXISTS idx_event_employees_employee_id ON event_employees(employee_id);
CREATE INDEX IF NOT EXISTS idx_event_checklists_event_id ON event_checklists(event_id);

-- Enable RLS
ALTER TABLE event_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_checklists ENABLE ROW LEVEL SECURITY;

-- RLS Policies for event_equipment
CREATE POLICY "Users with events_manage can view event equipment"
  ON event_equipment FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users with events_manage can insert event equipment"
  ON event_equipment FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users with events_manage can update event equipment"
  ON event_equipment FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users with events_manage can delete event equipment"
  ON event_equipment FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  );

-- RLS Policies for event_employees
CREATE POLICY "Users with events_manage can view event employees"
  ON event_employees FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users with events_manage can insert event employees"
  ON event_employees FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users with events_manage can update event employees"
  ON event_employees FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users with events_manage can delete event employees"
  ON event_employees FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  );

-- RLS Policies for event_checklists
CREATE POLICY "Users with events_manage can view event checklists"
  ON event_checklists FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users with events_manage can insert event checklists"
  ON event_checklists FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users with events_manage can update event checklists"
  ON event_checklists FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users with events_manage can delete event checklists"
  ON event_checklists FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  );
