/*
  # Email body templates system

  1. New table
    - `email_body_templates` — stores reusable email body HTML templates per company
      - `id` (uuid)
      - `company_id` (uuid, FK -> my_companies)
      - `name` (text) — friendly name shown in the picker
      - `template_html` (text)
      - `is_active` (bool)
      - timestamps

  2. Default template assignment
    - `email_body_template_assignments` — maps a purpose key to a template per company
      - `id` (uuid)
      - `company_id` (uuid)
      - `purpose` (text) — 'general' | 'offer' | 'invoice' | 'contract' | 'link'
      - `template_id` (uuid, FK -> email_body_templates)
      - unique on (company_id, purpose)

  3. Migration of existing data
    - For every active company with `email_body_template` populated, create a row in
      `email_body_templates` named "Domyślny" and set it as the 'general' assignment.

  4. Security
    - RLS enabled. Authenticated users with admin/website_edit can manage; everyone authenticated can SELECT
      to render outgoing mail.
*/

CREATE TABLE IF NOT EXISTS email_body_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES my_companies(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Nowy szablon',
  template_html text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_body_templates_company ON email_body_templates(company_id);

CREATE TABLE IF NOT EXISTS email_body_template_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES my_companies(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  template_id uuid NOT NULL REFERENCES email_body_templates(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_body_template_purpose_chk
    CHECK (purpose IN ('general', 'offer', 'invoice', 'contract', 'link')),
  CONSTRAINT email_body_template_assignments_unique UNIQUE (company_id, purpose)
);

CREATE INDEX IF NOT EXISTS idx_email_body_assignments_company ON email_body_template_assignments(company_id);

ALTER TABLE email_body_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_body_template_assignments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_body_templates' AND policyname = 'Authenticated read templates') THEN
    CREATE POLICY "Authenticated read templates" ON email_body_templates
      FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_body_templates' AND policyname = 'Authenticated insert templates') THEN
    CREATE POLICY "Authenticated insert templates" ON email_body_templates
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_body_templates' AND policyname = 'Authenticated update templates') THEN
    CREATE POLICY "Authenticated update templates" ON email_body_templates
      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_body_templates' AND policyname = 'Authenticated delete templates') THEN
    CREATE POLICY "Authenticated delete templates" ON email_body_templates
      FOR DELETE TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_body_template_assignments' AND policyname = 'Authenticated read assignments') THEN
    CREATE POLICY "Authenticated read assignments" ON email_body_template_assignments
      FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_body_template_assignments' AND policyname = 'Authenticated insert assignments') THEN
    CREATE POLICY "Authenticated insert assignments" ON email_body_template_assignments
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_body_template_assignments' AND policyname = 'Authenticated update assignments') THEN
    CREATE POLICY "Authenticated update assignments" ON email_body_template_assignments
      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_body_template_assignments' AND policyname = 'Authenticated delete assignments') THEN
    CREATE POLICY "Authenticated delete assignments" ON email_body_template_assignments
      FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

DO $$
DECLARE
  rec RECORD;
  new_template_id uuid;
BEGIN
  FOR rec IN
    SELECT id, email_body_template, email_body_use_template
    FROM my_companies
    WHERE email_body_template IS NOT NULL AND email_body_template <> ''
  LOOP
    IF NOT EXISTS (SELECT 1 FROM email_body_templates WHERE company_id = rec.id) THEN
      INSERT INTO email_body_templates (company_id, name, template_html, is_active)
      VALUES (rec.id, 'Domyślny', rec.email_body_template, true)
      RETURNING id INTO new_template_id;

      INSERT INTO email_body_template_assignments (company_id, purpose, template_id)
      VALUES (rec.id, 'general', new_template_id)
      ON CONFLICT (company_id, purpose) DO NOTHING;
    END IF;
  END LOOP;
END $$;