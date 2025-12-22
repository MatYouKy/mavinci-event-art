/*
  # Aktualizacja triggera zaproszeń - automatyczne wysyłanie maili
  
  Zmienia trigger notify_employee_assignment aby:
  1. Tworzył notyfikację w systemie (jak dotychczas)
  2. Automatycznie wysyłał mail z zaproszeniem przez edge function
*/

CREATE OR REPLACE FUNCTION notify_employee_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  event_record RECORD;
  new_notification_id uuid;
  supabase_url text;
BEGIN
  -- Only send notification for new assignments with pending status
  IF NEW.status != 'pending' THEN
    RETURN NEW;
  END IF;

  -- Get event details
  SELECT
    e.id as event_id,
    e.name as event_name,
    e.event_date,
    e.event_end_date,
    e.location,
    e.description,
    c.name as category
  INTO event_record
  FROM events e
  LEFT JOIN event_categories c ON e.category_id = c.id
  WHERE e.id = NEW.event_id;

  -- Create notification with action_url to event details
  INSERT INTO notifications (
    category,
    title,
    message,
    type,
    related_entity_type,
    related_entity_id,
    action_url,
    metadata,
    created_at
  ) VALUES (
    'employee',
    'Zaproszenie do zespołu wydarzenia',
    format('Zostałeś zaproszony do zespołu wydarzenia "%s"', event_record.event_name),
    'info',
    'event',
    NEW.event_id::text,
    format('/crm/events/%s', NEW.event_id),
    jsonb_build_object(
      'event_id', NEW.event_id,
      'event_name', event_record.event_name,
      'event_date', event_record.event_date,
      'event_end_date', event_record.event_end_date,
      'location', event_record.location,
      'description', event_record.description,
      'category', event_record.category,
      'role', NEW.role,
      'responsibilities', NEW.responsibilities,
      'assignment_id', NEW.id,
      'requires_response', true
    ),
    now()
  ) RETURNING id INTO new_notification_id;

  -- Add recipient (employee being assigned)
  INSERT INTO notification_recipients (notification_id, user_id)
  VALUES (new_notification_id, NEW.employee_id)
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  -- Asynchronously send invitation email via edge function
  -- This uses pg_net extension if available, otherwise silently fails
  BEGIN
    -- Get Supabase URL from environment
    supabase_url := current_setting('app.settings.supabase_url', true);
    
    IF supabase_url IS NULL OR supabase_url = '' THEN
      supabase_url := 'https://fuuljhhuhfojtmmfmskq.supabase.co';
    END IF;

    -- Call edge function asynchronously (fire and forget)
    -- Note: This requires pg_net extension or similar
    PERFORM net.http_post(
      url := supabase_url || '/functions/v1/send-event-invitation',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('request.jwt.claims', true)::json->>'token'
      ),
      body := jsonb_build_object(
        'assignmentId', NEW.id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Log error but don't fail the trigger
    RAISE WARNING 'Failed to send invitation email for assignment %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION notify_employee_assignment IS 
'Tworzy powiadomienie i automatycznie wysyła mail z zaproszeniem przy dodaniu pracownika do wydarzenia';
