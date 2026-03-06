/*
  # Fix Sync Phase Notification - Nested jsonb_set

  Nie można mieć wielu SET metadata =, trzeba zagnieździć jsonb_set.
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

  -- Znajdź powiadomienie
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

  -- Aktualizuj metadata - zagnieżdżone jsonb_set
  IF notification_record.id IS NOT NULL THEN
    UPDATE notifications
    SET metadata = jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{invitation_status}',
          to_jsonb(NEW.invitation_status)
        ),
        '{invitation_responded_at}',
        to_jsonb(NEW.invitation_responded_at)
      ),
      '{requires_response}',
      to_jsonb(NEW.invitation_status = 'pending')
    )
    WHERE id = notification_record.id;
  END IF;

  RETURN NEW;
END;
$$;