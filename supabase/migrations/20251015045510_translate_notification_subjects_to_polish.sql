/*
  # Translate Notification Subjects to Polish

  ## Changes
  - Update notify_new_contact_message to translate category names
  - event_inquiry -> Zapytanie o event
  - team_join -> Rekrutacja  
  - general -> Ogólna
  
  ## Purpose
  - Make notifications more user-friendly for Polish-speaking employees
  - Consistent with UI translations
*/

CREATE OR REPLACE FUNCTION notify_new_contact_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp_record RECORD;
  category_pl TEXT;
BEGIN
  -- Translate category to Polish
  CASE NEW.category
    WHEN 'event_inquiry' THEN category_pl := 'Zapytanie o event';
    WHEN 'team_join' THEN category_pl := 'Rekrutacja';
    WHEN 'general' THEN category_pl := 'Ogólna';
    ELSE category_pl := NEW.category;
  END CASE;

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
      format('Od: %s (%s) - Kategoria: %s', NEW.name, NEW.email, category_pl),
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
