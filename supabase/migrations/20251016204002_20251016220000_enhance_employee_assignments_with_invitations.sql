/*
  # Enhance Employee Assignments with Invitation System

  1. Updates to employee_assignments
    - Add `status` column (pending, accepted, rejected)
    - Add `responsibilities` column (text field for scope of work)
    - Add `invited_at` timestamp
    - Add `responded_at` timestamp
    - Add `invited_by` (uuid, reference to employee who invited)

  2. New Trigger
    - Create notification trigger when employee is assigned to event
    - Automatically set status to 'pending' on insert
    - Send notification to assigned employee with event details

  3. New Trigger for Status Changes
    - Notify event creator when employee accepts/rejects invitation

  4. Security
    - Update RLS policies to allow employees to update their own assignment status
*/

-- Add new columns to employee_assignments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_assignments' AND column_name = 'status'
  ) THEN
    ALTER TABLE employee_assignments ADD COLUMN status text DEFAULT 'pending' NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_assignments' AND column_name = 'responsibilities'
  ) THEN
    ALTER TABLE employee_assignments ADD COLUMN responsibilities text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_assignments' AND column_name = 'invited_at'
  ) THEN
    ALTER TABLE employee_assignments ADD COLUMN invited_at timestamptz DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_assignments' AND column_name = 'responded_at'
  ) THEN
    ALTER TABLE employee_assignments ADD COLUMN responded_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_assignments' AND column_name = 'invited_by'
  ) THEN
    ALTER TABLE employee_assignments ADD COLUMN invited_by uuid REFERENCES employees(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create index for status filtering
CREATE INDEX IF NOT EXISTS idx_employee_assignments_status ON employee_assignments(status);

-- Function to send invitation notification
CREATE OR REPLACE FUNCTION notify_employee_assignment()
RETURNS TRIGGER AS $$
DECLARE
  event_record RECORD;
  category_name text;
BEGIN
  -- Get event details
  SELECT e.*, e.name as event_name, e.description, e.event_date, e.event_end_date,
         e.location, e.created_by, c.name as category
  INTO event_record
  FROM events e
  LEFT JOIN event_categories c ON e.category_id = c.id
  WHERE e.id = NEW.event_id;

  -- Create notification for assigned employee
  INSERT INTO notifications (
    employee_id,
    category,
    title,
    message,
    entity_type,
    entity_id,
    metadata,
    created_at
  ) VALUES (
    NEW.employee_id,
    'team_invitation',
    'Zaproszenie do zespołu wydarzenia',
    format('Zostałeś zaproszony do zespołu wydarzenia "%s"', event_record.event_name),
    'employee_assignment',
    NEW.id,
    jsonb_build_object(
      'event_id', NEW.event_id,
      'event_name', event_record.event_name,
      'event_date', event_record.event_date,
      'event_end_date', event_record.event_end_date,
      'location', event_record.location,
      'description', event_record.description,
      'category', event_record.category,
      'role', NEW.role,
      'responsibilities', NEW.responsibilities,
      'assignment_id', NEW.id,
      'requires_response', true
    ),
    now()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to notify creator about response
CREATE OR REPLACE FUNCTION notify_assignment_response()
RETURNS TRIGGER AS $$
DECLARE
  event_record RECORD;
  employee_record RECORD;
  response_text text;
BEGIN
  -- Only trigger on status change from pending
  IF OLD.status = 'pending' AND NEW.status != 'pending' THEN
    -- Get event and employee details
    SELECT e.*, e.name as event_name, e.created_by
    INTO event_record
    FROM events e
    WHERE e.id = NEW.event_id;

    SELECT name, surname, nickname
    INTO employee_record
    FROM employees
    WHERE id = NEW.employee_id;

    -- Determine response text
    IF NEW.status = 'accepted' THEN
      response_text := 'zaakceptował(a)';
    ELSE
      response_text := 'odrzucił(a)';
    END IF;

    -- Notify event creator
    IF event_record.created_by IS NOT NULL THEN
      INSERT INTO notifications (
        employee_id,
        category,
        title,
        message,
        entity_type,
        entity_id,
        metadata,
        created_at
      ) VALUES (
        event_record.created_by,
        'team_response',
        'Odpowiedź na zaproszenie do zespołu',
        format('%s %s zaproszenie do wydarzenia "%s"',
          COALESCE(employee_record.nickname, employee_record.name || ' ' || employee_record.surname),
          response_text,
          event_record.event_name
        ),
        'employee_assignment',
        NEW.id,
        jsonb_build_object(
          'event_id', NEW.event_id,
          'event_name', event_record.event_name,
          'employee_id', NEW.employee_id,
          'employee_name', COALESCE(employee_record.nickname, employee_record.name || ' ' || employee_record.surname),
          'status', NEW.status,
          'assignment_id', NEW.id
        ),
        now()
      );
    END IF;

    -- Update responded_at timestamp
    NEW.responded_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old triggers if they exist
DROP TRIGGER IF EXISTS on_employee_assigned ON employee_assignments;
DROP TRIGGER IF EXISTS on_assignment_response ON employee_assignments;

-- Create triggers
CREATE TRIGGER on_employee_assigned
  AFTER INSERT ON employee_assignments
  FOR EACH ROW
  EXECUTE FUNCTION notify_employee_assignment();

CREATE TRIGGER on_assignment_response
  BEFORE UPDATE ON employee_assignments
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION notify_assignment_response();

-- Update RLS policies to allow employees to update their own assignment status
DROP POLICY IF EXISTS "Allow authenticated users to update employee assignments" ON employee_assignments;

CREATE POLICY "Allow employees to update their own assignment status"
  ON employee_assignments FOR UPDATE
  TO authenticated
  USING (employee_id = auth.uid())
  WITH CHECK (employee_id = auth.uid());

CREATE POLICY "Allow team managers to update assignments"
  ON employee_assignments FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'events_manage' = ANY(permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'events_manage' = ANY(permissions)
    )
  );
