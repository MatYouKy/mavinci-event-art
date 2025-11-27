/*
  # Fix Contact Form Trigger - Employee ID
  
  Changes user_id to id in employees table query.
  The employees.id is the UUID from auth.users.
*/

CREATE OR REPLACE FUNCTION process_contact_form_submission()
RETURNS TRIGGER AS $$
DECLARE
  new_message_id uuid;
  employee_record RECORD;
  notification_id uuid;
  metadata_text text;
BEGIN
  -- Build metadata as text
  metadata_text := format(
    'Source: %s | Section: %s | City: %s | Event Type: %s | UTM Source: %s | UTM Medium: %s | UTM Campaign: %s | Referrer: %s | Submission ID: %s',
    COALESCE(NEW.source_page, 'Unknown'),
    COALESCE(NEW.source_section, 'N/A'),
    COALESCE(NEW.city_interest, 'N/A'),
    COALESCE(NEW.event_type, 'N/A'),
    COALESCE(NEW.utm_source, 'N/A'),
    COALESCE(NEW.utm_medium, 'N/A'),
    COALESCE(NEW.utm_campaign, 'N/A'),
    COALESCE(NEW.referrer, 'N/A'),
    NEW.id::text
  );

  -- Insert into contact_messages
  INSERT INTO contact_messages (
    name,
    email,
    phone,
    message,
    source_page,
    status,
    priority,
    category,
    subject,
    notes,
    ip_address,
    user_agent,
    created_at
  ) VALUES (
    NEW.name,
    NEW.email,
    NEW.phone,
    NEW.message,
    COALESCE(NEW.source_page, 'Website Form'),
    'unread',
    'normal',
    'form_submission',
    COALESCE(NEW.source_section, 'Contact Form'),
    metadata_text,
    NULL,
    NULL,
    NEW.created_at
  ) RETURNING id INTO new_message_id;

  -- Update the contact_form_submission with the message_id
  UPDATE contact_form_submissions
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('message_id', new_message_id)
  WHERE id = NEW.id;

  -- Create notification for employees with messages_manage permission
  INSERT INTO notifications (
    title,
    message,
    category,
    related_entity_type,
    related_entity_id,
    action_url,
    created_at
  ) VALUES (
    'Nowe zapytanie z formularza',
    format('Klient %s wysłał zapytanie przez formularz kontaktowy ze strony: %s', NEW.name, COALESCE(NEW.source_page, 'Nieznana')),
    'contact_form',
    'contact_messages',
    new_message_id::text,
    '/crm/messages',
    now()
  ) RETURNING id INTO notification_id;

  -- Send to all employees with messages_manage permission
  -- employees.id IS the auth.users.id (UUID)
  FOR employee_record IN
    SELECT id
    FROM employees
    WHERE 'messages_manage' = ANY(permissions)
    AND is_active = true
  LOOP
    INSERT INTO notification_recipients (
      notification_id,
      user_id,
      is_read,
      created_at
    ) VALUES (
      notification_id,
      employee_record.id,
      false,
      now()
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
