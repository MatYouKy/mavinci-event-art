/*
  # Fix Event Invitation Status Synchronization

  1. Problem
    - Pracownik który odrzucił zaproszenie (status = 'rejected') nadal widzi wydarzenie
    - Powiadomienie nie aktualizuje się po akcji w emailu (accept/reject)
    - Pracownik może podwójnie kliknąć akcję (email + notyfikacja)

  2. Solution
    - RLS: wykluczyć odrzucone wydarzenia (status = 'rejected')
    - Trigger: aktualizować metadata powiadomienia po zmianie statusu assignment
    - Metadata: dodać pole 'assignment_status' do śledzenia

  3. Security
    - Odrzuceni pracownicy nie mają dostępu do wydarzenia
    - Powiadomienie pokazuje aktualny status (pending/accepted/rejected)
*/

-- Update RLS policy to exclude rejected assignments
DROP POLICY IF EXISTS "Users can view events based on permissions" ON events;

CREATE POLICY "Users can view events based on permissions"
  ON events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        -- Full access: admin role or admin permission
        emp.role = 'admin'
        OR 'admin' = ANY(emp.permissions)

        -- Full access: events_manage or calendar_manage
        OR 'events_manage' = ANY(emp.permissions)
        OR 'calendar_manage' = ANY(emp.permissions)

        -- Limited access: events_view or calendar_view - only assigned events (not rejected)
        OR (
          ('events_view' = ANY(emp.permissions) OR 'calendar_view' = ANY(emp.permissions))
          AND (
            -- Events created by user
            events.created_by = auth.uid()
            OR
            -- Events assigned to user (excluding rejected status)
            EXISTS (
              SELECT 1 FROM employee_assignments ea
              WHERE ea.event_id = events.id
              AND ea.employee_id = auth.uid()
              AND ea.status != 'rejected'
            )
          )
        )
      )
    )
  );

COMMENT ON POLICY "Users can view events based on permissions" ON events IS
  'Unified policy: admin/events_manage/calendar_manage see all, events_view/calendar_view see only assigned (not rejected) or created';

-- Create function to sync notification metadata when assignment status changes
CREATE OR REPLACE FUNCTION sync_notification_on_assignment_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  notification_record RECORD;
BEGIN
  -- Only process status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Find notification related to this assignment
  SELECT n.id, n.metadata
  INTO notification_record
  FROM notifications n
  WHERE n.related_entity_type = 'event'
  AND n.related_entity_id = NEW.event_id::text
  AND n.metadata->>'assignment_id' = NEW.id::text
  AND EXISTS (
    SELECT 1 FROM notification_recipients nr
    WHERE nr.notification_id = n.id
    AND nr.user_id = NEW.employee_id
  )
  ORDER BY n.created_at DESC
  LIMIT 1;

  -- Update notification metadata with current status
  IF notification_record.id IS NOT NULL THEN
    UPDATE notifications
    SET
      metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{assignment_status}',
        to_jsonb(NEW.status)
      ),
      metadata = jsonb_set(
        metadata,
        '{responded_at}',
        to_jsonb(NEW.responded_at)
      ),
      metadata = jsonb_set(
        metadata,
        '{requires_response}',
        to_jsonb(NEW.status = 'pending')
      )
    WHERE id = notification_record.id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION sync_notification_on_assignment_status_change IS
  'Aktualizuje metadata powiadomienia gdy status zaproszenia się zmieni (pending -> accepted/rejected)';

-- Create trigger on employee_assignments
DROP TRIGGER IF EXISTS trigger_sync_notification_on_assignment_change ON employee_assignments;

CREATE TRIGGER trigger_sync_notification_on_assignment_change
  AFTER UPDATE OF status ON employee_assignments
  FOR EACH ROW
  EXECUTE FUNCTION sync_notification_on_assignment_status_change();

COMMENT ON TRIGGER trigger_sync_notification_on_assignment_change ON employee_assignments IS
  'Synchronizuje powiadomienie po zmianie statusu zaproszenia (accept/reject w emailu)';