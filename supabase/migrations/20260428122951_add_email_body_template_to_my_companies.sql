/*
  # Add email body template to my_companies

  1. Changes
    - Add `email_body_template` (text) - HTML template for email body with placeholders
    - Add `email_body_use_template` (boolean) - toggle to enable using the template

  2. Purpose
    Allow each company to define a reusable email body template (with logo, header,
    branded styling) that wraps the user's message and signature, configurable from
    /crm/settings/email-template.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'my_companies' AND column_name = 'email_body_template'
  ) THEN
    ALTER TABLE my_companies ADD COLUMN email_body_template text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'my_companies' AND column_name = 'email_body_use_template'
  ) THEN
    ALTER TABLE my_companies ADD COLUMN email_body_use_template boolean DEFAULT false;
  END IF;
END $$;
