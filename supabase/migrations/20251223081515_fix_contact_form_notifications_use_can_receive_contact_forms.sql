/*
  # Fix Contact Form Notifications - Use can_receive_contact_forms

  1. Changes
    - Contact form notifications now go only to employees who have:
      - System email account assigned
      - can_receive_contact_forms = true on that assignment
    - No longer sends to all employees with messages_manage

  2. Security
    - Explicit opt-in for contact form notifications
    - Controlled via checkbox in /crm/employees/[id]
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

  -- Create notification for employees who opted in for contact form notifications
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

  -- Send only to employees who:
  -- 1. Have a system email account assigned
  -- 2. Have can_receive_contact_forms = true
  FOR employee_record IN
    SELECT DISTINCT e.id
    FROM employees e
    INNER JOIN employee_email_account_assignments eeaa ON eeaa.employee_id = e.id
    INNER JOIN employee_email_accounts eea ON eea.id = eeaa.email_account_id
    WHERE e.is_active = true
    AND eea.is_active = true
    AND eea.account_type = 'system'
    AND eeaa.can_receive_contact_forms = true
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

COMMENT ON FUNCTION process_contact_form_submission IS 'Wysyła powiadomienia tylko do pracowników z zaznaczonym checkbox "Formularz kontaktowy" na koncie systemowym';