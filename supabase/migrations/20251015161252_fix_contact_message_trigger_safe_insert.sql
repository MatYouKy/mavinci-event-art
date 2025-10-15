/*
  # Naprawa triggera powiadomień dla formularza kontaktowego

  1. Zmiany
    - Dodano obsługę błędów w trigger notify_new_contact_message
    - Trigger używa EXCEPTION WHEN OTHERS dla bezpieczeństwa
    - Jeśli trigger zawiedzie, INSERT się NIE wycofa
    - Formularz kontaktowy będzie działać nawet jeśli powiadomienia nie działają
  
  2. Bezpieczeństwo
    - Trigger nie rzuci błędu który zablokuje INSERT
    - Logs są zapisywane do RAISE NOTICE (widoczne w logach serwera)
*/

-- Napraw trigger aby był bezpieczny dla INSERT
CREATE OR REPLACE FUNCTION public.notify_new_contact_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  emp_record RECORD;
  category_pl TEXT;
  new_notification_id UUID;
  auth_user_id UUID;
BEGIN
  BEGIN
    -- Translate category to Polish
    CASE NEW.category
      WHEN 'event_inquiry' THEN category_pl := 'Zapytanie o event';
      WHEN 'team_join' THEN category_pl := 'Rekrutacja';
      WHEN 'general' THEN category_pl := 'Ogólna';
      ELSE category_pl := NEW.category;
    END CASE;

    -- Create ONE notification
    INSERT INTO notifications (
      title,
      message,
      type,
      category,
      action_url,
      related_entity_type,
      related_entity_id,
      created_at
    )
    VALUES (
      'Nowa wiadomość kontaktowa',
      format('Od: %s (%s) - Kategoria: %s', NEW.name, NEW.email, category_pl),
      'info',
      'contact_form',
      '/crm/messages',
      'contact_messages',
      NEW.id::text,
      NOW()
    )
    RETURNING id INTO new_notification_id;

    -- Create recipients for all employees with permissions
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
      -- Find auth user ID safely
      SELECT id INTO auth_user_id
      FROM auth.users 
      WHERE email = emp_record.email 
      LIMIT 1;

      -- Only insert if we found a matching auth user
      IF auth_user_id IS NOT NULL THEN
        INSERT INTO notification_recipients (
          notification_id,
          user_id,
          is_read,
          created_at
        )
        VALUES (
          new_notification_id,
          auth_user_id,
          false,
          NOW()
        )
        ON CONFLICT (notification_id, user_id) DO NOTHING;
      END IF;
    END LOOP;

  EXCEPTION WHEN OTHERS THEN
    -- Log error but don't block the INSERT
    RAISE NOTICE 'Error in notify_new_contact_message trigger: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;
