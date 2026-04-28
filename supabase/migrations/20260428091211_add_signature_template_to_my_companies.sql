/*
  # Add email signature template to my_companies

  1. Changes
    - Adds `email_signature_template` (text) to `my_companies` - HTML with placeholders like {{full_name}}, {{position}}, {{phone}}, {{email}}, {{website}}, {{avatar_url}}, {{company_logo}}, {{company_name}}, {{company_address}}, {{company_nip}}, {{company_krs}}, {{company_regon}}
    - Adds `email_signature_use_template` (boolean) - whether to apply the company-level template

  2. Notes
    - Per-employee `employee_signatures.custom_html` still works as override
    - Template stored on company means a single source of truth for branding
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='my_companies' AND column_name='email_signature_template'
  ) THEN
    ALTER TABLE my_companies ADD COLUMN email_signature_template text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='my_companies' AND column_name='email_signature_use_template'
  ) THEN
    ALTER TABLE my_companies ADD COLUMN email_signature_use_template boolean DEFAULT false;
  END IF;
END $$;
