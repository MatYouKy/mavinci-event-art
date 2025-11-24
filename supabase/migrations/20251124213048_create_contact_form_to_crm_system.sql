/*
  # Create Contact Form to CRM System
  
  Creates a trigger that automatically copies data from contact_form_submissions to contact_messages
  and sends notifications to employees with messages_manage permission.
  
  1. Functionality
    - Trigger on INSERT to contact_form_submissions
    - Create contact_message record with proper mapping
    - Send notification to employees with messages_manage permission
  
  2. Data Mapping
    - name -> name
    - email -> email
    - phone -> phone
    - message -> message
    - source_page -> source (with additional metadata)
    - status -> 'unread'
    - priority -> 'normal'
    - type -> 'form_submission'
*/

-- Create function to copy contact form submissions to contact_messages
CREATE OR REPLACE FUNCTION process_contact_form_submission()
RETURNS TRIGGER AS $$
DECLARE
  new_message_id uuid;
  employee_record RECORD;
  notification_id uuid;
BEGIN
  -- Insert into contact_messages
  INSERT INTO contact_messages (
    name,
    email,
    phone,
    message,
    source,
    status,
    priority,
    type,
    metadata,
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
    jsonb_build_object(
      'source_page', NEW.source_page,
      'source_section', NEW.source_section,
      'city_interest', NEW.city_interest,
      'event_type', NEW.event_type,
      'utm_source', NEW.utm_source,
      'utm_medium', NEW.utm_medium,
      'utm_campaign', NEW.utm_campaign,
      'referrer', NEW.referrer,
      'submission_id', NEW.id
    ),
    NEW.created_at
  ) RETURNING id INTO new_message_id;

  -- Update the contact_form_submission with the message_id
  UPDATE contact_form_submissions
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('message_id', new_message_id)
  WHERE id = NEW.id;

  -- Create notification for employees with messages_manage permission
  INSERT INTO notifications (
    subject,
    message,
    category,
    entity_type,
    entity_id,
    action_url,
    created_at
  ) VALUES (
    'Nowe zapytanie z formularza',
    format('Klient %s wysłał zapytanie przez formularz kontaktowy ze strony: %s', NEW.name, COALESCE(NEW.source_page, 'Nieznana')),
    'message',
    'contact_message',
    new_message_id,
    '/crm/messages',
    now()
  ) RETURNING id INTO notification_id;

  -- Send to all employees with messages_manage permission
  FOR employee_record IN
    SELECT user_id
    FROM employees
    WHERE 'messages_manage' = ANY(permissions)
  LOOP
    INSERT INTO notification_recipients (
      notification_id,
      user_id,
      is_read,
      created_at
    ) VALUES (
      notification_id,
      employee_record.user_id,
      false,
      now()
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists
DROP TRIGGER IF EXISTS on_contact_form_submission ON contact_form_submissions;

-- Create trigger
CREATE TRIGGER on_contact_form_submission
  AFTER INSERT ON contact_form_submissions
  FOR EACH ROW
  EXECUTE FUNCTION process_contact_form_submission();

-- Add metadata column to contact_form_submissions if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contact_form_submissions' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE contact_form_submissions ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;
