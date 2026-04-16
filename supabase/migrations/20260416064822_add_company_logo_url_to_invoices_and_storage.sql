/*
  # Add company logo support for invoices

  1. Changes
    - Adds `company_logo_url` column to `invoices` table (nullable text)
    - Creates `company-logos` storage bucket for company logo uploads
    - Adds public read access and authenticated upload/delete policies

  2. Reason
    - Allows saving the company logo path when an invoice is created
    - Provides dedicated storage for company logo images
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'company_logo_url'
  ) THEN
    ALTER TABLE invoices ADD COLUMN company_logo_url text;
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read company logos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'company-logos');

CREATE POLICY "Authenticated users upload company logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'company-logos');

CREATE POLICY "Authenticated users delete company logos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'company-logos');

CREATE POLICY "Authenticated users update company logos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'company-logos')
  WITH CHECK (bucket_id = 'company-logos');
