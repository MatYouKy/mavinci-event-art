/*
  # Fix Contact Message Notification Trigger - Permission Issue

  ## Problem
  - Trigger `notify_new_contact_message` wykonuje SELECT na `auth.users`
  - Użytkownicy anon nie mają dostępu do auth.users przez RLS
  - Formularz kontaktowy zwraca: "permission denied for table users"
  
  ## Solution
  - Zmień funkcję na SECURITY DEFINER (wykonuje się z prawami właściciela)
  - Dodaj SECURITY DEFINER do funkcji triggera
  - To pozwoli triggerowi czytać auth.users bez uprawnień anon
  
  ## Security
  - SECURITY DEFINER jest bezpieczny tutaj - trigger tylko odczytuje users
  - Nie pozwala anon na bezpośredni dostęp do users
  - Tylko trigger może czytać users podczas INSERT do contact_messages
*/

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS trigger_notify_new_contact_message ON contact_messages;
DROP FUNCTION IF EXISTS notify_new_contact_message();

-- Recreate function with SECURITY DEFINER
CREATE OR REPLACE FUNCTION notify_new_contact_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER  -- ✅ TO NAPRAWIA PROBLEM!
SET search_path = public
AS $$
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
$$;

-- Recreate trigger
CREATE TRIGGER trigger_notify_new_contact_message
  AFTER INSERT ON contact_messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_contact_message();
