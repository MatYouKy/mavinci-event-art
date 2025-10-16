/*
  # Fix Employee Assignment Notifications

  1. Problem
    - Old triggers use employee_id column which no longer exists
    - Notifications system now uses notification_recipients table

  2. Solution
    - Recreate triggers to use new notification_recipients system
    - Create notification then add recipient
*/

-- Drop old triggers
DROP TRIGGER IF EXISTS notify_employee_assignment ON employee_assignments;
DROP TRIGGER IF EXISTS notify_assignment_response ON employee_assignments;

-- Drop old functions
DROP FUNCTION IF EXISTS notify_employee_assignment();
DROP FUNCTION IF EXISTS notify_assignment_response();

-- Function to notify employee about assignment
CREATE OR REPLACE FUNCTION notify_employee_assignment()
RETURNS TRIGGER AS $$
DECLARE
  event_record RECORD;
  notification_id uuid;
BEGIN
  -- Only send notification for new assignments with pending status
  IF NEW.status != 'pending' THEN
    RETURN NEW;
  END IF;

  -- Get event details
  SELECT
    e.id as event_id,
    e.name as event_name,
    e.event_date,
    e.event_end_date,
    e.location,
    e.description,
    c.name as category
  INTO event_record
  FROM events e
  LEFT JOIN event_categories c ON e.category_id = c.id
  WHERE e.id = NEW.event_id;

  -- Create notification
  INSERT INTO notifications (
    category,
    title,
    message,
    related_entity_type,
    related_entity_id,
    metadata,
    created_at
  ) VALUES (
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
  ) RETURNING id INTO notification_id;

  -- Add recipient
  INSERT INTO notification_recipients (notification_id, user_id)
  VALUES (notification_id, NEW.employee_id);

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
  notification_id uuid;
BEGIN
  -- Only send notification when status changes from pending
  IF OLD.status = NEW.status OR OLD.status != 'pending' THEN
    RETURN NEW;
  END IF;

  -- Get event and employee details
  SELECT
    e.id as event_id,
    e.name as event_name,
    e.created_by
  INTO event_record
  FROM events e
  WHERE e.id = NEW.event_id;

  SELECT
    name,
    surname,
    nickname
  INTO employee_record
  FROM employees
  WHERE id = NEW.employee_id;

  -- Set response text based on status
  IF NEW.status = 'accepted' THEN
    response_text := 'zaakceptował';
  ELSIF NEW.status = 'rejected' THEN
    response_text := 'odrzucił';
  ELSE
    RETURN NEW;
  END IF;

  -- Create notification for event creator
  INSERT INTO notifications (
    category,
    title,
    message,
    related_entity_type,
    related_entity_id,
    metadata,
    created_at
  ) VALUES (
    'team_response',
    'Odpowiedź na zaproszenie',
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
      'role', NEW.role
    ),
    now()
  ) RETURNING id INTO notification_id;

  -- Add recipient (event creator)
  INSERT INTO notification_recipients (notification_id, user_id)
  VALUES (notification_id, event_record.created_by);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate triggers
CREATE TRIGGER notify_employee_assignment
  AFTER INSERT ON employee_assignments
  FOR EACH ROW
  EXECUTE FUNCTION notify_employee_assignment();

CREATE TRIGGER notify_assignment_response
  AFTER UPDATE ON employee_assignments
  FOR EACH ROW
  EXECUTE FUNCTION notify_assignment_response();
