/*
  # Fix Message Assignment Notification Category

  ## Problem
  - Notification category 'message_assignment' is not in allowed values
  - CHECK constraint only allows: client, event, offer, employee, system, global, contact_form
  
  ## Solution
  - Use 'system' category instead of 'message_assignment'
  - Recreate trigger function with correct category
*/

-- Recreate function with correct category
CREATE OR REPLACE FUNCTION notify_message_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  assigned_emp RECORD;
  message_subject TEXT;
  message_from TEXT;
  notification_message TEXT;
BEGIN
  IF NEW.assigned_to IS NOT NULL AND (OLD.assigned_to IS NULL OR OLD.assigned_to != NEW.assigned_to) THEN
    SELECT id, name, surname, email
    INTO assigned_emp
    FROM employees
    WHERE id = NEW.assigned_to;

    IF TG_TABLE_NAME = 'contact_messages' THEN
      message_subject := COALESCE(NEW.subject, 'Wiadomość z formularza');
      message_from := format('%s (%s)', NEW.name, NEW.email);
    ELSIF TG_TABLE_NAME = 'received_emails' THEN
      message_subject := COALESCE(NEW.subject, 'Brak tematu');
      message_from := NEW.from_address;
    END IF;

    notification_message := format('Przypisano Ci wiadomość: "%s" od %s', 
      message_subject, 
      message_from
    );

    INSERT INTO notifications (
      title,
      message,
      type,
      category,
      is_global,
      action_url,
      related_entity_type,
      related_entity_id,
      created_at,
      user_id
    )
    VALUES (
      'Przypisano wiadomość',
      notification_message,
      'info',
      'system',
      false,
      '/crm/messages',
      TG_TABLE_NAME,
      NEW.id::text,
      NOW(),
      (SELECT id FROM auth.users WHERE email = assigned_emp.email LIMIT 1)
    );
  END IF;

  RETURN NEW;
END;
$$;
