/*
  # Utworzenie tabeli contracts dla wygenerowanych umów

  1. Nowe tabele
    - `contracts` - wygenerowane umowy z szablonów
      - `id` (uuid, primary key)
      - `contract_number` (text, unique) - automatycznie generowany numer
      - `template_id` (uuid) - szablon użyty do wygenerowania
      - `client_id` (uuid) - klient (kontakt z tabeli contacts)
      - `event_id` (uuid) - powiązany event
      - `offer_id` (uuid) - powiązana oferta
      - `title` (text) - tytuł umowy
      - `content` (text) - wygenerowana treść umowy
      - `status` (enum) - draft, sent, signed, cancelled
      - `generated_data` (jsonb) - dane użyte do wygenerowania
      - `signed_at` (timestamptz) - data podpisania
      - `valid_from` (date) - ważna od
      - `valid_until` (date) - ważna do
      - `pdf_url` (text) - URL do PDF
      - `notes` (text) - notatki
      - `created_by` (uuid) - employee ID
      
  2. Security
    - Enable RLS
    - Policies dla użytkowników z uprawnieniami contracts_manage
*/

-- Typ statusu umowy
DO $$ BEGIN
  CREATE TYPE contract_status AS ENUM (
    'draft',
    'sent',
    'signed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Tabela umów
CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number text UNIQUE NOT NULL,
  template_id uuid REFERENCES contract_templates(id) ON DELETE SET NULL,
  client_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  offer_id uuid REFERENCES offers(id) ON DELETE SET NULL,
  title text NOT NULL,
  content text NOT NULL,
  status contract_status DEFAULT 'draft',
  generated_data jsonb DEFAULT '{}'::jsonb,
  signed_at timestamptz,
  valid_from date,
  valid_until date,
  pdf_url text,
  notes text,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Funkcja do automatycznego generowania numeru umowy
CREATE OR REPLACE FUNCTION generate_contract_number()
RETURNS text AS $$
DECLARE
  v_year text;
  v_month text;
  v_count integer;
  v_contract_number text;
  v_exists boolean;
BEGIN
  v_year := TO_CHAR(CURRENT_DATE, 'YYYY');
  v_month := TO_CHAR(CURRENT_DATE, 'MM');
  
  v_count := 1;
  LOOP
    v_contract_number := 'UM/' || v_year || '/' || v_month || '/' || LPAD(v_count::text, 3, '0');
    
    SELECT EXISTS(
      SELECT 1 FROM contracts WHERE contract_number = v_contract_number
    ) INTO v_exists;
    
    IF NOT v_exists THEN
      RETURN v_contract_number;
    END IF;
    
    v_count := v_count + 1;
    
    IF v_count > 9999 THEN
      RAISE EXCEPTION 'Przekroczono limit numerów umów dla tego miesiąca';
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Trigger do generowania numeru umowy
CREATE OR REPLACE FUNCTION set_contract_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.contract_number IS NULL OR NEW.contract_number = '' THEN
    NEW.contract_number := generate_contract_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contracts_set_number
  BEFORE INSERT ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION set_contract_number();

-- Trigger do aktualizacji updated_at
CREATE OR REPLACE FUNCTION update_contract_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contracts_updated_at
  BEFORE UPDATE ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION update_contract_updated_at();

-- Enable RLS
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

-- Policies RLS
CREATE POLICY "Użytkownicy z contracts_manage mogą wszystko"
  ON contracts
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

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_contracts_template_id ON contracts(template_id);
CREATE INDEX IF NOT EXISTS idx_contracts_client_id ON contracts(client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_event_id ON contracts(event_id);
CREATE INDEX IF NOT EXISTS idx_contracts_offer_id ON contracts(offer_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_created_by ON contracts(created_by);

COMMENT ON TABLE contracts IS 'Wygenerowane umowy z szablonów dla klientów, eventów i ofert';
