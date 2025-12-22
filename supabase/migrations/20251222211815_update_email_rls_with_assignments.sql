/*
  # Update Email RLS Policies with Account Assignments

  1. Changes
    - Update RLS policies for employee_email_accounts to include:
      - Personal accounts (employee_id = user)
      - Shared accounts with assignments
      - System accounts (available to all)
    - Update RLS policies for received_emails to respect assignments
    - Update RLS policies for sent_emails to respect assignments

  2. Security
    - Users see only emails from accounts they have access to
    - Admin with messages_manage still sees everything
    - Proper filtering based on account assignments table
*/

-- Drop existing policies for employee_email_accounts
DROP POLICY IF EXISTS "Users with messages_manage can view all email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users with messages_view can view own email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users with messages_manage can insert email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users with messages_manage can update email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users with messages_manage can delete email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users can view their accessible email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users can insert email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users can update email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users can delete email accounts" ON employee_email_accounts;

-- New policies for employee_email_accounts with assignment support

-- SELECT: Users see their personal accounts, assigned shared accounts, and all system accounts
CREATE POLICY "Users can view accessible email accounts"
  ON employee_email_accounts
  FOR SELECT
  TO authenticated
  USING (
    is_active = true AND (
      -- Admin with messages_manage sees everything
      EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND 'messages_manage' = ANY(employees.permissions)
      )
      OR
      -- Personal accounts owned by user
      (account_type = 'personal' AND employee_id = auth.uid())
      OR
      -- Shared accounts assigned to user
      (account_type = 'shared' AND EXISTS (
        SELECT 1 FROM employee_email_account_assignments
        WHERE email_account_id = employee_email_accounts.id
        AND employee_id = auth.uid()
      ))
      OR
      -- System accounts available to all
      account_type = 'system'
    )
  );

-- INSERT: Only messages_manage or personal accounts
CREATE POLICY "Users can insert email accounts"
  ON employee_email_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Admin with messages_manage can create any account
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
    OR
    -- Users can create their own personal accounts
    (account_type = 'personal' AND employee_id = auth.uid())
  );

-- UPDATE: Only messages_manage can update
CREATE POLICY "Users can update email accounts"
  ON employee_email_accounts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
  );

-- DELETE: Only messages_manage can delete
CREATE POLICY "Users can delete email accounts"
  ON employee_email_accounts
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
  );

-- Drop existing policies for received_emails
DROP POLICY IF EXISTS "Users with messages_manage can view all received emails" ON received_emails;
DROP POLICY IF EXISTS "Users with messages_view can view own received emails" ON received_emails;
DROP POLICY IF EXISTS "Users with messages_manage can update received emails" ON received_emails;
DROP POLICY IF EXISTS "Users with messages_view can update own received emails" ON received_emails;
DROP POLICY IF EXISTS "System can insert received emails" ON received_emails;
DROP POLICY IF EXISTS "Users with messages_manage can delete received emails" ON received_emails;

-- New policies for received_emails with assignment support

-- SELECT: Users see emails from their accessible accounts
CREATE POLICY "Users can view received emails from accessible accounts"
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
    -- Users with messages_view see emails from their accessible accounts
    (
      EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND 'messages_view' = ANY(employees.permissions)
      )
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
          -- System account (available to all)
          eea.account_type = 'system'
        )
      )
    )
  );

-- UPDATE: Users can update emails from their accessible accounts
CREATE POLICY "Users can update received emails from accessible accounts"
  ON received_emails
  FOR UPDATE
  TO authenticated
  USING (
    -- Admin with messages_manage can update all
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
    OR
    -- Users with messages_view can update emails from their accessible accounts
    (
      EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND 'messages_view' = ANY(employees.permissions)
      )
      AND
      EXISTS (
        SELECT 1 FROM employee_email_accounts eea
        WHERE eea.id = received_emails.email_account_id
        AND eea.is_active = true
        AND (
          (eea.account_type = 'personal' AND eea.employee_id = auth.uid())
          OR
          (eea.account_type = 'shared' AND EXISTS (
            SELECT 1 FROM employee_email_account_assignments
            WHERE email_account_id = eea.id
            AND employee_id = auth.uid()
          ))
          OR
          eea.account_type = 'system'
        )
      )
    )
  );

-- INSERT: System can insert (for email sync)
CREATE POLICY "System can insert received emails"
  ON received_emails
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- DELETE: Only messages_manage can delete
CREATE POLICY "Users with messages_manage can delete received emails"
  ON received_emails
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
  );

-- Drop existing policies for sent_emails
DROP POLICY IF EXISTS "Users with messages_manage can view all sent emails" ON sent_emails;
DROP POLICY IF EXISTS "Users with messages_view can view own sent emails" ON sent_emails;
DROP POLICY IF EXISTS "System can insert sent emails" ON sent_emails;
DROP POLICY IF EXISTS "Users with messages_manage can delete sent emails" ON sent_emails;

-- New policies for sent_emails with assignment support

-- SELECT: Users see emails from their accessible accounts
CREATE POLICY "Users can view sent emails from accessible accounts"
  ON sent_emails
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
    -- Users with messages_view see emails from their accessible accounts
    (
      EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND 'messages_view' = ANY(employees.permissions)
      )
      AND
      EXISTS (
        SELECT 1 FROM employee_email_accounts eea
        WHERE eea.id = sent_emails.email_account_id
        AND eea.is_active = true
        AND (
          (eea.account_type = 'personal' AND eea.employee_id = auth.uid())
          OR
          (eea.account_type = 'shared' AND EXISTS (
            SELECT 1 FROM employee_email_account_assignments
            WHERE email_account_id = eea.id
            AND employee_id = auth.uid()
          ))
          OR
          eea.account_type = 'system'
        )
      )
    )
  );

-- INSERT: System can insert (for email sync)
CREATE POLICY "System can insert sent emails"
  ON sent_emails
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- DELETE: Only messages_manage can delete
CREATE POLICY "Users with messages_manage can delete sent emails"
  ON sent_emails
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
  );

-- Create helper function to check if user has access to email account
CREATE OR REPLACE FUNCTION user_has_email_account_access(
  account_id uuid,
  user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  acc_type email_account_type;
  acc_employee_id uuid;
  acc_is_active boolean;
BEGIN
  -- Get account info
  SELECT account_type, employee_id, is_active
  INTO acc_type, acc_employee_id, acc_is_active
  FROM employee_email_accounts
  WHERE id = account_id;

  IF NOT FOUND OR NOT acc_is_active THEN
    RETURN false;
  END IF;

  -- Check if user has messages_manage permission
  IF EXISTS (
    SELECT 1 FROM employees
    WHERE id = user_id
    AND 'messages_manage' = ANY(permissions)
  ) THEN
    RETURN true;
  END IF;

  -- System accounts are available to everyone
  IF acc_type = 'system' THEN
    RETURN true;
  END IF;

  -- Personal accounts belong to their owner
  IF acc_type = 'personal' AND acc_employee_id = user_id THEN
    RETURN true;
  END IF;

  -- Shared accounts need assignment
  IF acc_type = 'shared' THEN
    RETURN EXISTS (
      SELECT 1 FROM employee_email_account_assignments
      WHERE email_account_id = account_id
      AND employee_id = user_id
    );
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION user_has_email_account_access IS
'Helper function to check if a user has access to an email account based on account type and assignments';
