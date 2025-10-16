/*
  # Create Event Relations Tables

  1. New Tables
    - `equipment_bookings` - tracks equipment assigned to events
      - `id` (uuid, primary key)
      - `event_id` (uuid, foreign key to events)
      - `equipment_id` (uuid, foreign key to equipment_items)
      - `quantity` (integer)
      - `start_date` (timestamptz)
      - `end_date` (timestamptz)
      - `notes` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `employee_assignments` - tracks employees assigned to events
      - `id` (uuid, primary key)
      - `event_id` (uuid, foreign key to events)
      - `employee_id` (uuid, foreign key to employees)
      - `role` (text) - role/responsibility in the event
      - `hours` (numeric) - estimated or actual hours
      - `notes` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Updates
    - Add `event_id` to tasks table if it doesn't exist

  3. Security
    - Enable RLS on all new tables
    - Allow authenticated users to manage relations
*/

-- Create equipment_bookings table
CREATE TABLE IF NOT EXISTS equipment_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  equipment_id uuid REFERENCES equipment_items(id) ON DELETE CASCADE NOT NULL,
  quantity integer DEFAULT 1 NOT NULL,
  start_date timestamptz,
  end_date timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create employee_assignments table
CREATE TABLE IF NOT EXISTS employee_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  role text,
  hours numeric(10, 2),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add event_id to tasks table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tasks' AND column_name = 'event_id'
  ) THEN
    ALTER TABLE tasks ADD COLUMN event_id uuid REFERENCES events(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create triggers for updated_at
CREATE TRIGGER update_equipment_bookings_updated_at
  BEFORE UPDATE ON equipment_bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employee_assignments_updated_at
  BEFORE UPDATE ON employee_assignments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE equipment_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_assignments ENABLE ROW LEVEL SECURITY;

-- RLS policies for equipment_bookings
CREATE POLICY "Allow authenticated users to view equipment bookings"
  ON equipment_bookings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert equipment bookings"
  ON equipment_bookings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update equipment bookings"
  ON equipment_bookings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete equipment bookings"
  ON equipment_bookings FOR DELETE
  TO authenticated
  USING (true);

-- RLS policies for employee_assignments
CREATE POLICY "Allow authenticated users to view employee assignments"
  ON employee_assignments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert employee assignments"
  ON employee_assignments FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update employee assignments"
  ON employee_assignments FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to delete employee assignments"
  ON employee_assignments FOR DELETE
  TO authenticated
  USING (true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_equipment_bookings_event_id ON equipment_bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_equipment_bookings_equipment_id ON equipment_bookings(equipment_id);
CREATE INDEX IF NOT EXISTS idx_employee_assignments_event_id ON employee_assignments(event_id);
CREATE INDEX IF NOT EXISTS idx_employee_assignments_employee_id ON employee_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_event_id ON tasks(event_id);
