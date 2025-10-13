/*
  # Add Contact Message Notification Trigger

  1. New Function
    - `notify_new_contact_message` - Function that creates notification when new contact message arrives

  2. New Trigger
    - Automatically creates notification for admins when new contact message is submitted

  3. Purpose
    - Real-time notifications for new contact form submissions
    - Alerts admin users immediately
*/

CREATE OR REPLACE FUNCTION notify_new_contact_message()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO notifications (
    title,
    message,
    type,
    category,
    is_global,
    action_url,
    related_entity_type,
    related_entity_id,
    created_at
  )
  VALUES (
    'Nowa wiadomość kontaktowa',
    format('Od: %s (%s) - %s', NEW.name, NEW.email, COALESCE(NEW.subject, 'Brak tematu')),
    'info',
    'contact_form',
    true,
    '/crm/messages',
    'contact_messages',
    NEW.id::text,
    NOW()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_notify_new_contact_message'
  ) THEN
    CREATE TRIGGER trigger_notify_new_contact_message
      AFTER INSERT ON contact_messages
      FOR EACH ROW
      EXECUTE FUNCTION notify_new_contact_message();
  END IF;
END $$;