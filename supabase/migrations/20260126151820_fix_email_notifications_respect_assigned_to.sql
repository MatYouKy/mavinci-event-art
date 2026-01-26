/*
  # Fix Email Notifications to Respect assigned_to

  1. Problem
    - Users receive notifications for ALL emails from shared/system accounts
    - Should only receive notifications for emails assigned to them OR unassigned emails
    - RLS policies don't check assigned_to, so users see all emails from accessible accounts

  2. Solution
    - Update notification trigger to check assigned_to:
      * If assigned_to is NULL - notify all users with access
      * If assigned_to is set - notify ONLY that user
    - Update RLS policy to check assigned_to:
      * Users see emails assigned to them
      * Users see unassigned emails from their accessible accounts
      * Admin with messages_manage still sees everything

  3. How It Should Work Now
    - Personal: Owner gets notified (no change)
    - Shared: Only assigned user gets notified, or all if unassigned
    - System: Only assigned user gets notified, or all if unassigned
*/

-- Fix the notification trigger to respect assigned_to
CREATE OR REPLACE FUNCTION notify_new_received_email()
RETURNS TRIGGER AS $$
DECLARE
  v_notification_id uuid;
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

  -- Add notification recipients based on email account type AND assigned_to

  -- Personal account - notify owner based on employee_id
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

  -- Shared and System accounts - check assigned_to first
  ELSIF v_account_info.account_type IN ('shared', 'system') THEN

    -- If email is assigned to specific user - notify ONLY that user
    IF NEW.assigned_to IS NOT NULL THEN
      INSERT INTO notification_recipients (notification_id, user_id)
      SELECT v_notification_id, NEW.assigned_to
      FROM employees
      WHERE id = NEW.assigned_to
      AND (
        -- Check if email notifications are enabled (default true if not set)
        (preferences->'notifications'->>'email_received')::boolean IS NOT FALSE
      );

    -- If email is unassigned - notify all users with access to the account
    ELSE
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
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION notify_new_received_email() IS
'Creates notification when new email is received. Respects assigned_to - if set, only that user is notified. If NULL, all users with access are notified.';

-- Update RLS policy to respect assigned_to
DROP POLICY IF EXISTS "Users can view received emails from accessible accounts with preferences" ON received_emails;

CREATE POLICY "Users can view received emails with assignment and preferences"
  ON received_emails
  FOR SELECT
  TO authenticated
  USING (
    -- Admin with messages_manage sees all
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
    OR
    -- Users with messages_view see:
    -- 1. Emails from their personal accounts
    -- 2. Emails from shared accounts (assigned to them OR unassigned)
    -- 3. Emails from system accounts (assigned to them OR unassigned, if system_messages pref enabled)
    (
      EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND 'messages_view' = ANY(employees.permissions)
      )
      AND
      (
        -- Email is assigned to this user
        received_emails.assigned_to = auth.uid()
        OR
        -- Email is unassigned AND user has access to the account
        (
          received_emails.assigned_to IS NULL
          AND
          EXISTS (
            SELECT 1 FROM employee_email_accounts eea
            WHERE eea.id = received_emails.email_account_id
            AND eea.is_active = true
            AND (
              -- Personal account owned by user
              (eea.account_type = 'personal' AND eea.employee_id = auth.uid())
              OR
              -- Shared account assigned to user
              (eea.account_type = 'shared' AND EXISTS (
                SELECT 1 FROM employee_email_account_assignments
                WHERE email_account_id = eea.id
                AND employee_id = auth.uid()
              ))
              OR
              -- System account - check preferences
              (
                eea.account_type = 'system'
                AND EXISTS (
                  SELECT 1 FROM employee_email_account_assignments
                  WHERE email_account_id = eea.id
                  AND employee_id = auth.uid()
                )
                AND EXISTS (
                  SELECT 1 FROM employees
                  WHERE employees.id = auth.uid()
                  AND (
                    -- Check if preference exists and is true, or if it doesn't exist (default true)
                    (preferences->'notifications'->>'system_messages')::boolean IS NOT FALSE
                  )
                )
              )
            )
          )
        )
      )
    )
  );

COMMENT ON POLICY "Users can view received emails with assignment and preferences" ON received_emails IS
'Users see emails assigned to them OR unassigned emails from their accessible accounts. Admin sees all.';