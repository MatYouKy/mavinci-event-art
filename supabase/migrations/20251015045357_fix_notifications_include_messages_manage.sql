/*
  # Fix Notifications - Include messages_manage Permission

  ## Problem
  - Triggers only check for 'messages_view' permission
  - Users with 'messages_manage' should also receive notifications
  - Marek has messages_manage but doesn't receive notifications
  
  ## Solution
  - Update both triggers to check for messages_view OR messages_manage
  - This ensures all users with message permissions get notifications
*/

-- Fix notify_new_contact_message trigger
DROP FUNCTION IF EXISTS notify_new_contact_message() CASCADE;

CREATE OR REPLACE FUNCTION notify_new_contact_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp_record RECORD;
BEGIN
  FOR emp_record IN 
    SELECT e.id, e.email
    FROM employees e
    WHERE e.is_active = true
    AND (
      'messages_view' = ANY(e.permissions) 
      OR 'messages_manage' = ANY(e.permissions)
      OR e.role = 'admin'
    )
  LOOP
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
      'Nowa wiadomość kontaktowa',
      format('Od: %s (%s) - %s', NEW.name, NEW.email, COALESCE(NEW.subject, 'Brak tematu')),
      'info',
      'contact_form',
      false,
      '/crm/messages',
      'contact_messages',
      NEW.id::text,
      NOW(),
      (SELECT id FROM auth.users WHERE email = emp_record.email LIMIT 1)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_notify_new_contact_message
  AFTER INSERT ON contact_messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_contact_message();
