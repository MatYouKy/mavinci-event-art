/*
  # Create Message Assignment Notification Trigger

  1. New Functions
    - `notify_message_assignment` - Creates notification when message is assigned to employee
    
  2. New Triggers
    - `trigger_notify_contact_message_assignment` - For contact_messages table
    - `trigger_notify_received_email_assignment` - For received_emails table
    
  3. Purpose
    - Automatically notify employee when message is assigned to them
    - Real-time notification system for task assignments
    
  4. Security
    - Uses SECURITY DEFINER to access auth.users
    - Only creates notification when assigned_to changes (not NULL)
*/

-- Function to notify employee about message assignment
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
      'message_assignment',
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

-- Trigger for contact_messages
DROP TRIGGER IF EXISTS trigger_notify_contact_message_assignment ON contact_messages;
CREATE TRIGGER trigger_notify_contact_message_assignment
  AFTER UPDATE ON contact_messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_message_assignment();

-- Trigger for received_emails
DROP TRIGGER IF EXISTS trigger_notify_received_email_assignment ON received_emails;
CREATE TRIGGER trigger_notify_received_email_assignment
  AFTER UPDATE ON received_emails
  FOR EACH ROW
  EXECUTE FUNCTION notify_message_assignment();
