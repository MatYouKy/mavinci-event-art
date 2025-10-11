/*
  # Create Employee Email Accounts System

  1. New Tables
    - `employee_email_accounts`
      - `id` (uuid, primary key)
      - `employee_id` (uuid) - reference to employee (no FK constraint as employees table may not exist)
      - `account_name` (text) - friendly name for the account
      - `from_name` (text) - display name when sending emails
      - `email_address` (text) - the email address
      - `imap_host` (text) - IMAP server address
      - `imap_port` (integer) - IMAP port (usually 993)
      - `imap_username` (text) - IMAP login
      - `imap_password` (text) - IMAP password
      - `imap_use_ssl` (boolean) - whether to use SSL
      - `smtp_host` (text) - SMTP server address
      - `smtp_port` (integer) - SMTP port (usually 587 or 465)
      - `smtp_username` (text) - SMTP login
      - `smtp_password` (text) - SMTP password
      - `smtp_use_tls` (boolean) - whether to use TLS
      - `signature` (text, nullable) - email signature
      - `is_default` (boolean) - whether this is the default account
      - `is_active` (boolean) - whether the account is active
      - `last_sync` (timestamptz, nullable) - last email sync time
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `employee_email_accounts` table
    - Add policies for authenticated users to manage email accounts

  3. Indexes
    - Index on employee_id for faster lookups
    - Index on email_address for searching
    - Index on is_default for quick default account lookup
*/

CREATE TABLE IF NOT EXISTS employee_email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid,
  account_name text NOT NULL,
  from_name text NOT NULL,
  email_address text NOT NULL,
  imap_host text NOT NULL,
  imap_port integer NOT NULL DEFAULT 993,
  imap_username text NOT NULL,
  imap_password text NOT NULL,
  imap_use_ssl boolean DEFAULT true,
  smtp_host text NOT NULL,
  smtp_port integer NOT NULL DEFAULT 587,
  smtp_username text NOT NULL,
  smtp_password text NOT NULL,
  smtp_use_tls boolean DEFAULT true,
  signature text,
  is_default boolean DEFAULT false,
  is_active boolean DEFAULT true,
  last_sync timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_employee_email_accounts_employee_id 
  ON employee_email_accounts(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_email_accounts_email 
  ON employee_email_accounts(email_address);
CREATE INDEX IF NOT EXISTS idx_employee_email_accounts_default 
  ON employee_email_accounts(is_default) WHERE is_default = true;

-- Enable RLS
ALTER TABLE employee_email_accounts ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can view all active email accounts
CREATE POLICY "Authenticated users can view active email accounts"
  ON employee_email_accounts
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Policy: Users can insert email accounts
CREATE POLICY "Authenticated users can insert email accounts"
  ON employee_email_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy: Users can update email accounts
CREATE POLICY "Authenticated users can update email accounts"
  ON employee_email_accounts
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Policy: Users can delete email accounts
CREATE POLICY "Authenticated users can delete email accounts"
  ON employee_email_accounts
  FOR DELETE
  TO authenticated
  USING (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_employee_email_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_employee_email_accounts_updated_at
  BEFORE UPDATE ON employee_email_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_employee_email_accounts_updated_at();
