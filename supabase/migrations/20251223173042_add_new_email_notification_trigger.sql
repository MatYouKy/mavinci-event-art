/*
  # Add notifications for new received emails

  1. New Functions
    - `notify_new_received_email()` - Creates notification when new email is received

  2. New Triggers
    - Trigger on INSERT to received_emails table

  3. Security
    - Notifications sent only to users with access to the email account
    - Respects user preferences for email notifications
    - Includes action URL to go directly to the message
*/

-- Function to create notification for new received email
CREATE OR REPLACE FUNCTION notify_new_received_email()
RETURNS TRIGGER AS $$
DECLARE
  v_notification_id uuid;
  v_employee_record RECORD;
  v_account_info RECORD;
BEGIN
  -- Get email account info
  SELECT
    account_name,
    account_type,
    employee_id
  INTO v_account_info
  FROM employee_email_accounts
  WHERE id = NEW.email_account_id;

  -- Create notification
  INSERT INTO notifications (
    title,
    message,
    type,
    category,
    action_url,
    related_entity_type,
    related_entity_id,
    metadata
  ) VALUES (
    'Nowa wiadomość email',
    format('Od: %s - %s',
      LEFT(NEW.from_address, 50),
      COALESCE(LEFT(NEW.subject, 100), '(bez tematu)')
    ),
    'info',
    'email_received',
    format('/crm/messages/%s?type=received', NEW.id),
    'received_email',
    NEW.id,
    jsonb_build_object(
      'email_account_id', NEW.email_account_id,
      'email_account_name', v_account_info.account_name,
      'from_address', NEW.from_address,
      'subject', NEW.subject
    )
  )
  RETURNING id INTO v_notification_id;

  -- Add notification recipients based on email account type and access
  -- Personal account - notify owner only
  IF v_account_info.account_type = 'personal' THEN
    IF v_account_info.employee_id IS NOT NULL THEN
      INSERT INTO notification_recipients (notification_id, user_id)
      SELECT v_notification_id, v_account_info.employee_id
      FROM employees
      WHERE id = v_account_info.employee_id
      AND (
        -- Check if email notifications are enabled (default true)
        (preferences->'notifications'->>'email_received')::boolean IS NOT FALSE
      );
    END IF;

  -- Shared account - notify all assigned users
  ELSIF v_account_info.account_type = 'shared' THEN
    INSERT INTO notification_recipients (notification_id, user_id)
    SELECT DISTINCT v_notification_id, eea.employee_id
    FROM employee_email_account_assignments eea
    INNER JOIN employees e ON e.id = eea.employee_id
    WHERE eea.email_account_id = NEW.email_account_id
    AND (
      -- Check if email notifications are enabled (default true)
      (e.preferences->'notifications'->>'email_received')::boolean IS NOT FALSE
    );

  -- System account - notify users with messages_view or messages_manage who have system_messages enabled
  ELSIF v_account_info.account_type = 'system' THEN
    INSERT INTO notification_recipients (notification_id, user_id)
    SELECT DISTINCT v_notification_id, e.id
    FROM employees e
    WHERE (
      'messages_view' = ANY(e.permissions)
      OR 'messages_manage' = ANY(e.permissions)
    )
    AND (
      -- Check if system email notifications are enabled (default true)
      (e.preferences->'notifications'->>'system_messages')::boolean IS NOT FALSE
    )
    AND (
      -- Check if email notifications are enabled (default true)
      (e.preferences->'notifications'->>'email_received')::boolean IS NOT FALSE
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new received emails
DROP TRIGGER IF EXISTS trigger_notify_new_received_email ON received_emails;

CREATE TRIGGER trigger_notify_new_received_email
  AFTER INSERT ON received_emails
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_received_email();

COMMENT ON FUNCTION notify_new_received_email() IS
'Creates notification when new email is received. Notifies users based on account type and their preferences.';

COMMENT ON TRIGGER trigger_notify_new_received_email ON received_emails IS
'Triggers notification creation when new email is received';