/*
  # Fix Contact Message Trigger - Use Array Permissions

  ## Problem
  - Trigger uses old `ep.can_view_messages` column
  - Permissions are now stored as text[] in employees table
  - INSERT fails with: column ep.can_view_messages does not exist

  ## Solution
  - Update trigger to use new permissions array format
  - Check 'messages_view' permission in employees.permissions array
  - Use proper array contains operator
*/

-- Drop and recreate the trigger function with correct permissions check
DROP TRIGGER IF EXISTS trigger_notify_new_contact_message ON contact_messages;
DROP FUNCTION IF EXISTS notify_new_contact_message();

CREATE OR REPLACE FUNCTION notify_new_contact_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp_record RECORD;
BEGIN
  -- Create notifications for employees with messages_view permission or admins
  FOR emp_record IN 
    SELECT e.id, e.email
    FROM employees e
    WHERE e.is_active = true
    AND (
      'messages_view' = ANY(e.permissions) 
      OR e.role = 'admin'
    )
  LOOP
    -- Insert notification for this employee
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

-- Recreate trigger
CREATE TRIGGER trigger_notify_new_contact_message
  AFTER INSERT ON contact_messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_contact_message();
