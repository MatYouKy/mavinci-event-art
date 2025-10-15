/*
  # Update Triggers for New Notification System

  ## Changes
  - notify_new_contact_message: Create ONE notification + multiple recipients
  - notify_message_assignment: Create ONE notification for assigned user
  
  ## Benefits
  - No duplicate notifications
  - Individual read status per user
  - Cleaner notification list
*/

-- Update notify_new_contact_message to use recipients
CREATE OR REPLACE FUNCTION notify_new_contact_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp_record RECORD;
  category_pl TEXT;
  new_notification_id UUID;
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
    INSERT INTO notification_recipients (
      notification_id,
      user_id,
      is_read,
      created_at
    )
    VALUES (
      new_notification_id,
      (SELECT id FROM auth.users WHERE email = emp_record.email LIMIT 1),
      false,
      NOW()
    )
    ON CONFLICT (notification_id, user_id) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Update notify_message_assignment to use recipients
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
  new_notification_id UUID;
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
      'Przypisano wiadomość',
      notification_message,
      'info',
      'system',
      '/crm/messages',
      TG_TABLE_NAME,
      NEW.id::text,
      NOW()
    )
    RETURNING id INTO new_notification_id;

    -- Create recipient for assigned user only
    INSERT INTO notification_recipients (
      notification_id,
      user_id,
      is_read,
      created_at
    )
    VALUES (
      new_notification_id,
      (SELECT id FROM auth.users WHERE email = assigned_emp.email LIMIT 1),
      false,
      NOW()
    )
    ON CONFLICT (notification_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
