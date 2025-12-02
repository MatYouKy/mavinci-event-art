/*
  # Tworzenie systemu szablonów umów ze zmiennymi

  1. Nowe tabele
    - `contract_templates` - szablony umów z możliwością użycia zmiennych
    
  2. Security
    - Enable RLS
    - Polityki dla użytkowników z uprawnieniami contracts_manage
*/

-- Tabela szablonów umów
CREATE TABLE IF NOT EXISTS contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  template_type text NOT NULL DEFAULT 'wedding' CHECK (template_type IN ('wedding', 'conference', 'corporate', 'concert', 'other')),
  content text NOT NULL,
  variables_used text[] DEFAULT ARRAY[]::text[],
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;

-- Polityki RLS
CREATE POLICY "Wszyscy mogą czytać aktywne szablony"
  ON contract_templates
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "Użytkownicy z contracts_manage mogą zarządzać"
  ON contract_templates
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'contracts_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'contracts_manage' = ANY(employees.permissions)
    )
  );

-- Trigger do aktualizacji updated_at
CREATE OR REPLACE FUNCTION update_contract_template_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contract_templates_updated_at
  BEFORE UPDATE ON contract_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_contract_template_updated_at();

COMMENT ON TABLE contract_templates IS 'Szablony umów ze zmiennymi do automatycznego generowania dokumentów';
