/*
  # Create sent emails tracking table

  1. New Tables
    - `sent_emails`
      - `id` (uuid, primary key)
      - `employee_id` (uuid, foreign key to employees.id)
      - `email_account_id` (uuid, foreign key)
      - `to_address` (text)
      - `subject` (text)
      - `body` (text)
      - `reply_to` (text, optional)
      - `message_id` (text, optional)
      - `sent_at` (timestamptz)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `sent_emails` table
    - Add policies for authenticated employees to view their own sent emails
*/

CREATE TABLE IF NOT EXISTS sent_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  email_account_id uuid REFERENCES employee_email_accounts(id) ON DELETE SET NULL,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  reply_to text,
  message_id text,
  sent_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sent_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view all sent emails"
  ON sent_emails
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can insert sent emails"
  ON sent_emails
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_sent_emails_employee ON sent_emails(employee_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_sent_at ON sent_emails(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_sent_emails_email_account ON sent_emails(email_account_id);
