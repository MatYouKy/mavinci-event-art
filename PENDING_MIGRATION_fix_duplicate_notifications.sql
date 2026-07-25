-- PENDING MIGRATION: fix_duplicate_event_invitation_notifications
-- Apply this via the Supabase MCP tool when available
--
-- Problem: When an employee is assigned to an event, TWO notifications fire:
--   1) notify_employee_assignment() on employee_assignments INSERT (category: 'employee')
--   2) notify_phase_assignment() on event_phase_assignments INSERT (category: 'team_invitation')
-- Both send to the same user for the same event, causing duplicates.
--
-- Solution: Update notify_phase_assignment() to skip if event-level notification already exists.

CREATE OR REPLACE FUNCTION notify_phase_assignment()
RETURNS TRIGGER AS $$
DECLARE
  phase_record RECORD;
  notification_id uuid;
  existing_notification_count int;
BEGIN
  IF NEW.invitation_status != 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT 
    ep.id as phase_id,
    ep.name as phase_name,
    ep.start_time,
    ep.end_time,
    e.id as event_id,
    e.name as event_name,
    e.created_by,
    ec.name as category_name,
    l.name as location_name
  INTO phase_record
  FROM event_phases ep
  JOIN events e ON e.id = ep.event_id
  LEFT JOIN event_categories ec ON ec.id = e.category_id
  LEFT JOIN locations l ON l.id = e.location_id
  WHERE ep.id = NEW.phase_id;

  -- Check if event-level invitation notification already exists for this employee+event
  SELECT COUNT(*) INTO existing_notification_count
  FROM notifications n
  JOIN notification_recipients nr ON nr.notification_id = n.id
  WHERE nr.user_id = NEW.employee_id
    AND n.metadata->>'event_id' = phase_record.event_id::text
    AND n.metadata->>'requires_response' = 'true'
    AND n.category IN ('employee', 'team_invitation')
    AND n.created_at > now() - interval '5 minutes';

  IF existing_notification_count > 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (
    category, title, message, related_entity_type, related_entity_id, metadata, created_at
  ) VALUES (
    'team_invitation',
    'Zaproszenie do fazy wydarzenia',
    format('Zostałeś zaproszony do fazy "%s" w wydarzeniu "%s"', 
      phase_record.phase_name, phase_record.event_name),
    'event_phase_assignment',
    NEW.id,
    jsonb_build_object(
      'event_id', phase_record.event_id,
      'event_name', phase_record.event_name,
      'phase_id', phase_record.phase_id,
      'phase_name', phase_record.phase_name,
      'phase_start', phase_record.start_time,
      'phase_end', phase_record.end_time,
      'category', phase_record.category_name,
      'location', phase_record.location_name,
      'role', NEW.role,
      'assignment_id', NEW.id,
      'invitation_status', NEW.invitation_status,
      'requires_response', true
    ),
    now()
  ) RETURNING id INTO notification_id;

  INSERT INTO notification_recipients (notification_id, user_id)
  VALUES (notification_id, NEW.employee_id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
