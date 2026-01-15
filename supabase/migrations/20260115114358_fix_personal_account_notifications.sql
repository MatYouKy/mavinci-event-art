/*
  # Fix Personal Account Email Notifications

  1. Problem
    - Previous fix broke personal accounts
    - Personal accounts have employee_id directly in employee_email_accounts table
    - They DO NOT use employee_email_account_assignments table
    - Current trigger requires assignments for ALL account types, including personal

  2. Solution
    - Personal accounts: check employee_id in employee_email_accounts (no assignments needed)
    - Shared accounts: check employee_email_account_assignments
    - System accounts: check employee_email_account_assignments
    
  3. How It Should Work
    - Personal: Owner gets notified (based on employee_id column)
    - Shared: All assigned users get notified (based on assignments table)
    - System: All assigned users get notified (based on assignments table)
*/

-- Fix the notification trigger function
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

  -- Add notification recipients based on email account type
  
  -- Personal account - notify owner based on employee_id in employee_email_accounts
  IF v_account_info.account_type = 'personal' THEN
    IF v_account_info.employee_id IS NOT NULL THEN
      INSERT INTO notification_recipients (notification_id, user_id)
      SELECT v_notification_id, v_account_info.employee_id
      FROM employees
      WHERE id = v_account_info.employee_id
      AND (
        -- Check if email notifications are enabled (default true if not set)
        (preferences->'notifications'->>'email_received')::boolean IS NOT FALSE
      );
    END IF;

  -- Shared and System accounts - notify assigned users from employee_email_account_assignments
  ELSIF v_account_info.account_type IN ('shared', 'system') THEN
    INSERT INTO notification_recipients (notification_id, user_id)
    SELECT DISTINCT v_notification_id, eea.employee_id
    FROM employee_email_account_assignments eea
    INNER JOIN employees e ON e.id = eea.employee_id
    WHERE eea.email_account_id = NEW.email_account_id
    AND eea.can_receive = true
    AND (
      -- Check if email notifications are enabled (default true if not set)
      (e.preferences->'notifications'->>'email_received')::boolean IS NOT FALSE
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION notify_new_received_email() IS
'Creates notification when new email is received. Personal accounts use employee_id, shared/system accounts use assignments.';
