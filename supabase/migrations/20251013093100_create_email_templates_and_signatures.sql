/*
  # Email Templates and Signatures System

  1. New Tables
    - `email_templates`
      - `id` (uuid, primary key)
      - `name` (text) - nazwa szablonu
      - `subject_template` (text) - szablon tematu
      - `body_template` (text) - szablon HTML
      - `is_default` (boolean)
      - `created_at`, `updated_at` (timestamptz)

    - `employee_signatures`
      - `employee_id` (uuid, primary key)
      - `full_name`, `position`, `phone`, `email`, `website` (text)
      - `avatar_url` (text)
      - `custom_html` (text) - własny HTML stopki
      - `use_custom_html` (boolean)
      - `created_at`, `updated_at` (timestamptz)

  2. Security
    - RLS enabled
    - Employees can view templates and signatures
    - Employees manage their own signature
    - Admins manage templates

  3. Sample Data
    - Professional email template with placeholders
*/

CREATE TABLE IF NOT EXISTS email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject_template text DEFAULT '',
  body_template text NOT NULL,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_signatures (
  employee_id uuid PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  position text DEFAULT '',
  phone text DEFAULT '',
  email text NOT NULL,
  website text DEFAULT 'https://mavinci.pl',
  avatar_url text DEFAULT '',
  custom_html text DEFAULT '',
  use_custom_html boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view email templates"
  ON email_templates
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage email templates"
  ON email_templates
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.access_level IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Employees can view all signatures"
  ON employee_signatures
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Employees can insert their own signature"
  ON employee_signatures
  FOR INSERT
  TO authenticated
  WITH CHECK (employee_id = auth.uid());

CREATE POLICY "Employees can update their own signature"
  ON employee_signatures
  FOR UPDATE
  TO authenticated
  USING (employee_id = auth.uid())
  WITH CHECK (employee_id = auth.uid());

CREATE POLICY "Employees can delete their own signature"
  ON employee_signatures
  FOR DELETE
  TO authenticated
  USING (employee_id = auth.uid());

INSERT INTO email_templates (name, body_template, is_default) VALUES
(
  'Profesjonalna Odpowiedź',
  '<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          
          <tr>
            <td style="padding: 30px; text-align: center; background: linear-gradient(135deg, #1c1f33 0%, #0f1119 100%);">
              <img src="{{LOGO_URL}}" alt="Mavinci" style="height: 50px; width: auto;">
            </td>
          </tr>
          
          <tr>
            <td style="padding: 40px 30px; color: #333333; font-size: 16px; line-height: 1.6;">
              {{CONTENT}}
            </td>
          </tr>
          
          <tr>
            <td style="padding: 30px; background-color: #f8f8f8; border-top: 3px solid #d3bb73;">
              {{SIGNATURE}}
            </td>
          </tr>
          
          <tr>
            <td style="padding: 20px 30px; background-color: #1c1f33; color: #e5e4e2; font-size: 12px; text-align: center;">
              <p style="margin: 0 0 10px 0;">© 2025 Mavinci - Profesjonalna organizacja eventów</p>
              <p style="margin: 0;">
                <a href="https://mavinci.pl" style="color: #d3bb73; text-decoration: none;">mavinci.pl</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>',
  true
) ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_email_templates_default ON email_templates(is_default) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_employee_signatures_employee ON employee_signatures(employee_id);
