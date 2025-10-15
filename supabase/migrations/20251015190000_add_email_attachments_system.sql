/*
  # Create email attachments system

  1. New Tables
    - `email_attachments`
      - `id` (uuid, primary key)
      - `email_id` (uuid, references received_emails or sent_emails)
      - `email_type` (text, 'received' or 'sent')
      - `filename` (text)
      - `content_type` (text, MIME type)
      - `size_bytes` (integer)
      - `storage_path` (text, path in Supabase Storage)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `email_attachments` table
    - Authenticated users can view all attachments
    - Authenticated users can insert attachments

  3. Storage
    - Create bucket for email attachments if not exists
    - Set up policies for authenticated users
*/

-- Create email attachments table
CREATE TABLE IF NOT EXISTS email_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid NOT NULL,
  email_type text NOT NULL CHECK (email_type IN ('received', 'sent', 'contact_form')),
  filename text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes integer NOT NULL DEFAULT 0,
  storage_path text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_email_attachments_email_id ON email_attachments(email_id);
CREATE INDEX IF NOT EXISTS idx_email_attachments_type ON email_attachments(email_type);

-- Enable RLS
ALTER TABLE email_attachments ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view all attachments"
  ON email_attachments
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert attachments"
  ON email_attachments
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete attachments"
  ON email_attachments
  FOR DELETE
  TO authenticated
  USING (true);

-- Create storage bucket for email attachments (handled by storage policies)
INSERT INTO storage.buckets (id, name, public)
VALUES ('email-attachments', 'email-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DO $$
BEGIN
  -- Allow authenticated users to upload attachments
  IF NOT EXISTS (
    SELECT 1 FROM storage.policies
    WHERE bucket_id = 'email-attachments' AND name = 'Authenticated users can upload attachments'
  ) THEN
    CREATE POLICY "Authenticated users can upload attachments"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'email-attachments');
  END IF;

  -- Allow authenticated users to view attachments
  IF NOT EXISTS (
    SELECT 1 FROM storage.policies
    WHERE bucket_id = 'email-attachments' AND name = 'Authenticated users can view attachments'
  ) THEN
    CREATE POLICY "Authenticated users can view attachments"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (bucket_id = 'email-attachments');
  END IF;

  -- Allow authenticated users to delete attachments
  IF NOT EXISTS (
    SELECT 1 FROM storage.policies
    WHERE bucket_id = 'email-attachments' AND name = 'Authenticated users can delete attachments'
  ) THEN
    CREATE POLICY "Authenticated users can delete attachments"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (bucket_id = 'email-attachments');
  END IF;
END $$;
