/*
  # Fix Notifications Permissions

  1. Changes
    - Update trigger to only notify employees with permission to view messages
    - Only employees with `can_view_messages = true` will receive contact form notifications

  2. Security
    - Prevents unauthorized access to notifications
    - Respects employee permissions system
*/

-- Drop existing trigger
DROP TRIGGER IF EXISTS trigger_notify_new_contact_message ON contact_messages;

-- Recreate function with permissions check
CREATE OR REPLACE FUNCTION notify_new_contact_message()
RETURNS TRIGGER AS $$
DECLARE
  emp_record RECORD;
BEGIN
  -- Create notifications only for employees who have permission to view messages
  FOR emp_record IN 
    SELECT e.id, e.email
    FROM employees e
    LEFT JOIN employee_permissions ep ON ep.employee_id = e.id
    WHERE e.is_active = true
      AND (ep.can_view_messages = true OR e.role = 'admin')
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
$$ LANGUAGE plpgsql;

-- Recreate trigger
CREATE TRIGGER trigger_notify_new_contact_message
  AFTER INSERT ON contact_messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_contact_message();