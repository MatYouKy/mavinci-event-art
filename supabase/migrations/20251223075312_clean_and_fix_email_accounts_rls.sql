/*
  # Clean and Fix Email Accounts RLS

  1. Changes
    - Remove all conflicting policies
    - Create simple, clear policies
    - Admin with messages_manage sees and manages all accounts

  2. Security
    - Admin full access to all accounts
    - Users see only their assigned accounts
*/

-- Drop ALL existing policies
DROP POLICY IF EXISTS "Service role full access" ON employee_email_accounts;
DROP POLICY IF EXISTS "Service role has full access" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users can delete email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users can insert email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users can update email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users can view accessible email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users can view their email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Users with messages_view can view own and system accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Admins can view all email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Admins can create email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Admins can update email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Admins can delete email accounts" ON employee_email_accounts;

-- SELECT: Admin sees all, users see assigned
CREATE POLICY "Select email accounts"
  ON employee_email_accounts
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND (
      -- Admin with messages_manage sees all
      EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND 'messages_manage' = ANY(employees.permissions)
      )
      OR
      -- Personal account owner
      (account_type = 'personal' AND employee_id = auth.uid())
      OR
      -- Assigned shared or system account
      (
        (account_type = 'shared' OR account_type = 'system')
        AND EXISTS (
          SELECT 1 FROM employee_email_account_assignments
          WHERE email_account_id = employee_email_accounts.id
          AND employee_id = auth.uid()
        )
      )
    )
  );

-- INSERT: Only admin
CREATE POLICY "Insert email accounts"
  ON employee_email_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
  );

-- UPDATE: Only admin
CREATE POLICY "Update email accounts"
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

-- DELETE: Only admin
CREATE POLICY "Delete email accounts"
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

-- Service role bypass
CREATE POLICY "Service role bypass"
  ON employee_email_accounts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);