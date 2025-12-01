/*
  # System faktur VAT dla Mavinci

  1. Nowe tabele
    - `invoices` - główna tabela faktur
      - Typy: proforma, advance (zaliczkowa), final (końcowa), corrective (korygująca)
      - Automatyczna numeracja
      - Powiązanie z eventem i klientem (organizacją)
      - Dane sprzedawcy i nabywcy
      - Wszystkie parametry faktury

    - `invoice_items` - pozycje na fakturze
      - Nazwa towaru/usługi
      - Ilość, jednostka miary
      - Cena netto, stawka VAT
      - Automatyczne kalkulacje

    - `invoice_settings` - konfiguracja systemu faktur
      - Dane firmy (sprzedawcy)
      - Numeracja faktur
      - Domyślne ustawienia

  2. Security
    - RLS włączone dla wszystkich tabel
    - Dostęp dla użytkowników z uprawnieniami finances_manage
*/

-- Tabela ustawień faktur (dane firmy)
CREATE TABLE IF NOT EXISTS invoice_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL DEFAULT 'MAVINCI SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
  company_nip text NOT NULL DEFAULT '7394011583',
  company_street text NOT NULL DEFAULT 'ul. Marcina Kasprzaka 15 / 66',
  company_postal_code text NOT NULL DEFAULT '10-057',
  company_city text NOT NULL DEFAULT 'Olsztyn',
  company_country text NOT NULL DEFAULT 'Polska',
  bank_account text NOT NULL DEFAULT '12 1020 3541 0000 5502 0408 6815',
  bank_name text,
  default_payment_method text NOT NULL DEFAULT 'przelew',
  default_payment_days integer NOT NULL DEFAULT 14,
  invoice_issue_place text NOT NULL DEFAULT 'Olsztyn',
  invoice_footer_text text DEFAULT 'Niniejsza faktura jest wezwaniem do zapłaty zgodnie z artykułem 455kc. po przekroczeniu terminu płatności będą naliczane ustawowe odsetki za zwłokę.',
  website text DEFAULT 'www.mavinci.pl',
  logo_url text,
  signature_name text DEFAULT 'Mateusz Kwiatkowski',
  signature_title text DEFAULT 'Podpis osoby upoważnionej do wystawienia',
  current_year integer NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::integer,
  last_invoice_number integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Wstaw domyślne ustawienia
INSERT INTO invoice_settings (id) VALUES (gen_random_uuid())
ON CONFLICT DO NOTHING;

-- Główna tabela faktur
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Numer i typ faktury
  invoice_number text NOT NULL UNIQUE,
  invoice_type text NOT NULL CHECK (invoice_type IN ('proforma', 'advance', 'final', 'corrective')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'sent', 'paid', 'overdue', 'cancelled')),

  -- Daty
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  sale_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_due_date date NOT NULL,
  paid_date date,

  -- Powiązania
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  contact_person_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  related_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,

  -- Dane sprzedawcy (można nadpisać)
  seller_name text NOT NULL,
  seller_nip text NOT NULL,
  seller_street text NOT NULL,
  seller_postal_code text NOT NULL,
  seller_city text NOT NULL,
  seller_country text NOT NULL DEFAULT 'Polska',

  -- Dane nabywcy
  buyer_name text NOT NULL,
  buyer_nip text,
  buyer_street text NOT NULL,
  buyer_postal_code text NOT NULL,
  buyer_city text NOT NULL,
  buyer_country text NOT NULL DEFAULT 'Polska',
  buyer_email text,
  buyer_phone text,

  -- Dane płatności
  payment_method text NOT NULL DEFAULT 'przelew',
  bank_account text,

  -- Sumy
  total_net numeric(12, 2) NOT NULL DEFAULT 0,
  total_vat numeric(12, 2) NOT NULL DEFAULT 0,
  total_gross numeric(12, 2) NOT NULL DEFAULT 0,

  -- Dodatkowe informacje
  notes text,
  internal_notes text,

  -- PDF
  pdf_url text,
  pdf_generated_at timestamptz,

  -- Metadane
  issue_place text NOT NULL DEFAULT 'Olsztyn',
  issued_by uuid REFERENCES employees(id),
  created_by uuid REFERENCES employees(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_invoices_event_id ON invoices(event_id);
CREATE INDEX IF NOT EXISTS idx_invoices_organization_id ON invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_invoices_payment_due_date ON invoices(payment_due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_type ON invoices(invoice_type);

-- Pozycje faktury
CREATE TABLE IF NOT EXISTS invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

  position_number integer NOT NULL,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'szt.',
  quantity numeric(12, 2) NOT NULL DEFAULT 1,

  price_net numeric(12, 2) NOT NULL,
  vat_rate integer NOT NULL DEFAULT 23 CHECK (vat_rate IN (0, 5, 8, 23)),

  value_net numeric(12, 2) NOT NULL,
  vat_amount numeric(12, 2) NOT NULL,
  value_gross numeric(12, 2) NOT NULL,

  description text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(invoice_id, position_number)
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);

-- Tabela historii zmian faktur
CREATE TABLE IF NOT EXISTS invoice_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  action text NOT NULL,
  changed_by uuid REFERENCES employees(id),
  changes jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_history_invoice_id ON invoice_history(invoice_id);

-- Funkcja generowania numeru faktury
CREATE OR REPLACE FUNCTION generate_invoice_number(p_invoice_type text)
RETURNS text AS $$
DECLARE
  v_year integer;
  v_next_number integer;
  v_prefix text;
  v_invoice_number text;
  v_settings_id uuid;
BEGIN
  SELECT id, current_year, last_invoice_number + 1
  INTO v_settings_id, v_year, v_next_number
  FROM invoice_settings
  ORDER BY created_at
  LIMIT 1;

  IF v_year != EXTRACT(YEAR FROM CURRENT_DATE)::integer THEN
    v_year := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
    v_next_number := 1;

    UPDATE invoice_settings
    SET current_year = v_year,
        last_invoice_number = 0
    WHERE id = v_settings_id;
  END IF;

  CASE p_invoice_type
    WHEN 'proforma' THEN v_prefix := 'PRO';
    WHEN 'advance' THEN v_prefix := 'ZAL';
    WHEN 'corrective' THEN v_prefix := 'KOR';
    ELSE v_prefix := '';
  END CASE;

  IF v_prefix != '' THEN
    v_invoice_number := v_prefix || '/' || v_next_number || '/' || v_year;
  ELSE
    v_invoice_number := v_next_number || '/' || v_year;
  END IF;

  UPDATE invoice_settings
  SET last_invoice_number = v_next_number,
      updated_at = now()
  WHERE id = v_settings_id;

  RETURN v_invoice_number;
END;
$$ LANGUAGE plpgsql;

-- Funkcja aktualizacji sum faktury
CREATE OR REPLACE FUNCTION update_invoice_totals()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE invoices
  SET
    total_net = (
      SELECT COALESCE(SUM(value_net), 0)
      FROM invoice_items
      WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)
    ),
    total_vat = (
      SELECT COALESCE(SUM(vat_amount), 0)
      FROM invoice_items
      WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)
    ),
    total_gross = (
      SELECT COALESCE(SUM(value_gross), 0)
      FROM invoice_items
      WHERE invoice_id = COALESCE(NEW.invoice_id, OLD.invoice_id)
    ),
    updated_at = now()
  WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_invoice_totals ON invoice_items;
CREATE TRIGGER trigger_update_invoice_totals
AFTER INSERT OR UPDATE OR DELETE ON invoice_items
FOR EACH ROW
EXECUTE FUNCTION update_invoice_totals();

-- Funkcja kalkulacji wartości pozycji
CREATE OR REPLACE FUNCTION calculate_invoice_item_values()
RETURNS TRIGGER AS $$
BEGIN
  NEW.value_net := NEW.quantity * NEW.price_net;
  NEW.vat_amount := ROUND(NEW.value_net * NEW.vat_rate / 100.0, 2);
  NEW.value_gross := NEW.value_net + NEW.vat_amount;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_calculate_invoice_item_values ON invoice_items;
CREATE TRIGGER trigger_calculate_invoice_item_values
BEFORE INSERT OR UPDATE OF quantity, price_net, vat_rate ON invoice_items
FOR EACH ROW
EXECUTE FUNCTION calculate_invoice_item_values();

-- RLS Policies
ALTER TABLE invoice_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read invoice_settings for finances_manage"
  ON invoice_settings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'finances_manage' = ANY(permissions)
    )
  );

CREATE POLICY "Allow update invoice_settings for finances_manage"
  ON invoice_settings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'finances_manage' = ANY(permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'finances_manage' = ANY(permissions)
    )
  );

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read invoices for finances_manage"
  ON invoices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'finances_manage' = ANY(permissions)
    )
  );

CREATE POLICY "Allow insert invoices for finances_manage"
  ON invoices FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'finances_manage' = ANY(permissions)
    )
  );

CREATE POLICY "Allow update invoices for finances_manage"
  ON invoices FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'finances_manage' = ANY(permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'finances_manage' = ANY(permissions)
    )
  );

CREATE POLICY "Allow delete invoices for finances_manage"
  ON invoices FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'finances_manage' = ANY(permissions)
    )
  );

ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all invoice_items for finances_manage"
  ON invoice_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'finances_manage' = ANY(permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'finances_manage' = ANY(permissions)
    )
  );

ALTER TABLE invoice_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read invoice_history for finances_manage"
  ON invoice_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'finances_manage' = ANY(permissions)
    )
  );

CREATE POLICY "Allow insert invoice_history for finances_manage"
  ON invoice_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'finances_manage' = ANY(permissions)
    )
  );

-- Dodaj uprawnienie finances_manage do admina
DO $$
BEGIN
  UPDATE employees
  SET permissions = array_append(permissions, 'finances_manage')
  WHERE 'admin' = ANY(permissions)
  AND NOT ('finances_manage' = ANY(permissions));
END $$;
