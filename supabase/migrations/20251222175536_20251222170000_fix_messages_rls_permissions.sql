/*
  # Fix Messages RLS Permissions
  
  1. Changes
    - Update RLS policies for employee_email_accounts
      - Users with messages_view can only see their own email accounts
      - Users with messages_manage can see all email accounts
    - Update RLS policies for received_emails
      - Users with messages_view can only see emails from their accounts
      - Users with messages_manage can see all received emails
    - Update RLS policies for sent_emails
      - Users with messages_view can only see emails from their accounts
      - Users with messages_manage can see all sent emails
    - Update RLS policies for contact_messages
      - Only users with messages_manage can access contact messages
      - Users with messages_view cannot see contact form messages
      
  2. Security
    - Proper permission checks using employees.permissions array
    - Separate policies for view and manage permissions
    - Owner-only access for users with view permission
*/

-- Drop existing policies for employee_email_accounts
DROP POLICY IF EXISTS "Authenticated users can view active email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Authenticated users can insert email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Authenticated users can update email accounts" ON employee_email_accounts;
DROP POLICY IF EXISTS "Authenticated users can delete email accounts" ON employee_email_accounts;

-- Create new policies for employee_email_accounts
CREATE POLICY "Users with messages_manage can view all email accounts"
  ON employee_email_accounts
  FOR SELECT
  TO authenticated
  USING (
    is_active = true AND
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Users with messages_view can view own email accounts"
  ON employee_email_accounts
  FOR SELECT
  TO authenticated
  USING (
    is_active = true AND
    employee_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_view' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Users with messages_manage can insert email accounts"
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

CREATE POLICY "Users with messages_manage can update email accounts"
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

CREATE POLICY "Users with messages_manage can delete email accounts"
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
DROP POLICY IF EXISTS "Employees can view all received emails" ON received_emails;
DROP POLICY IF EXISTS "Employees can update received emails" ON received_emails;
DROP POLICY IF EXISTS "System can insert received emails" ON received_emails;

-- Create new policies for received_emails
CREATE POLICY "Users with messages_manage can view all received emails"
  ON received_emails
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Users with messages_view can view own received emails"
  ON received_emails
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employee_email_accounts eea
      WHERE eea.id = received_emails.email_account_id
      AND eea.employee_id = auth.uid()
      AND eea.is_active = true
    ) AND
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_view' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Users with messages_manage can update received emails"
  ON received_emails
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Users with messages_view can update own received emails"
  ON received_emails
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employee_email_accounts eea
      WHERE eea.id = received_emails.email_account_id
      AND eea.employee_id = auth.uid()
      AND eea.is_active = true
    ) AND
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_view' = ANY(employees.permissions)
    )
  );

CREATE POLICY "System can insert received emails"
  ON received_emails
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

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
DROP POLICY IF EXISTS "Employees can view all sent emails" ON sent_emails;
DROP POLICY IF EXISTS "System can insert sent emails" ON sent_emails;

-- Create new policies for sent_emails
CREATE POLICY "Users with messages_manage can view all sent emails"
  ON sent_emails
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Users with messages_view can view own sent emails"
  ON sent_emails
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employee_email_accounts eea
      WHERE eea.id = sent_emails.email_account_id
      AND eea.employee_id = auth.uid()
      AND eea.is_active = true
    ) AND
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_view' = ANY(employees.permissions)
    )
  );

CREATE POLICY "System can insert sent emails"
  ON sent_emails
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

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

-- Drop existing policies for contact_messages
DROP POLICY IF EXISTS "Authenticated users can read contact messages" ON contact_messages;
DROP POLICY IF EXISTS "Authenticated users can update contact messages" ON contact_messages;
DROP POLICY IF EXISTS "Authenticated users can delete contact messages" ON contact_messages;

-- Create new policies for contact_messages
CREATE POLICY "Users with messages_manage can view contact messages"
  ON contact_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Users with messages_manage can update contact messages"
  ON contact_messages
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

CREATE POLICY "Users with messages_manage can delete contact messages"
  ON contact_messages
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'messages_manage' = ANY(employees.permissions)
    )
  );
