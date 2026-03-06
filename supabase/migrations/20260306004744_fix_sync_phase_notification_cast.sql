/*
  # Fix Sync Phase Notification - Cast UUID to TEXT

  related_entity_id jest TEXT, więc trzeba rzutować NEW.id::text
*/

CREATE OR REPLACE FUNCTION sync_phase_notification_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  notification_record RECORD;
BEGIN
  -- Tylko przy zmianie invitation_status
  IF OLD.invitation_status = NEW.invitation_status THEN
    RETURN NEW;
  END IF;

  -- Znajdź powiadomienie (rzutuj UUID na TEXT)
  SELECT n.id, n.metadata
  INTO notification_record
  FROM notifications n
  WHERE n.related_entity_type = 'event_phase_assignment'
  AND n.related_entity_id = NEW.id::text
  AND EXISTS (
    SELECT 1 FROM notification_recipients nr
    WHERE nr.notification_id = n.id
    AND nr.user_id = NEW.employee_id
  )
  ORDER BY n.created_at DESC
  LIMIT 1;

  -- Aktualizuj metadata
  IF notification_record.id IS NOT NULL THEN
    UPDATE notifications
    SET
      metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{invitation_status}',
        to_jsonb(NEW.invitation_status)
      ),
      metadata = jsonb_set(
        metadata,
        '{invitation_responded_at}',
        to_jsonb(NEW.invitation_responded_at)
      ),
      metadata = jsonb_set(
        metadata,
        '{requires_response}',
        to_jsonb(NEW.invitation_status = 'pending')
      )
    WHERE id = notification_record.id;
  END IF;

  RETURN NEW;
END;
$$;