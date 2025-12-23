/*
  # Fix contact message notifications to respect user preferences

  1. Changes
    - Update notify_new_contact_message to respect preferences.notifications.contact_form_messages
    - Update notify_new_contact_message to respect preferences.notifications.email_received (general email notification setting)
    - Uses employee.id directly instead of looking up auth.users by email

  2. Security
    - Only notifies users who have contact_form_messages enabled (default true)
    - Safe error handling to prevent blocking contact form submissions
*/

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
      format('/crm/messages/%s?type=contact_form', NEW.id),
      'contact_messages',
      NEW.id::text,
      NOW()
    )
    RETURNING id INTO new_notification_id;

    -- Create recipients for employees with permissions AND enabled preferences
    INSERT INTO notification_recipients (
      notification_id,
      user_id,
      is_read,
      created_at
    )
    SELECT 
      new_notification_id,
      e.id,
      false,
      NOW()
    FROM employees e
    WHERE e.is_active = true
      AND (
        'messages_view' = ANY(e.permissions) 
        OR 'messages_manage' = ANY(e.permissions)
      )
      AND (
        -- Check if contact form notifications are enabled (default true)
        (e.preferences->'notifications'->>'contact_form_messages')::boolean IS NOT FALSE
      )
      AND (
        -- Check if general email/message notifications are enabled (default true)
        (e.preferences->'notifications'->>'email_received')::boolean IS NOT FALSE
      )
    ON CONFLICT (notification_id, user_id) DO NOTHING;

  EXCEPTION WHEN OTHERS THEN
    -- Log error but don't block the INSERT
    RAISE NOTICE 'Error in notify_new_contact_message trigger: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION notify_new_contact_message() IS
'Creates notification when new contact form message is received. Respects user preferences for contact_form_messages and email_received.';
