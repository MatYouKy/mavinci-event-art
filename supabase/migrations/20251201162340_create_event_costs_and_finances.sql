/*
  # System kosztów i finansów dla eventów

  1. Nowe tabele
    - `event_costs` - koszty związane z eventem
      - Różne kategorie: paliwo, podwykonawcy, wynajem, materiały, inne
      - Powiązanie z eventami, podwykonawcami, pojazdami
      - Załączniki (paragony, faktury)
      
    - `event_cost_categories` - kategorie kosztów
    
  2. Rozszerzenia
    - Dodanie pól finansowych do events
    - Funkcje do kalkulacji bilansu finansowego
    
  3. Security
    - RLS włączone
    - Dostęp dla użytkowników z uprawnieniami finances_manage
*/

-- Tabela kategorii kosztów
CREATE TABLE IF NOT EXISTS event_cost_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  icon text,
  color text DEFAULT '#d3bb73',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Wstaw domyślne kategorie
INSERT INTO event_cost_categories (name, description, icon, color) VALUES
  ('Paliwo', 'Koszty paliwa do pojazdów', 'fuel', '#ef4444'),
  ('Podwykonawcy', 'Płatności dla podwykonawców', 'users', '#f59e0b'),
  ('Wynajem sprzętu', 'Wynajem dodatkowego sprzętu', 'package', '#3b82f6'),
  ('Materiały', 'Zakup materiałów eksploatacyjnych', 'shopping-cart', '#8b5cf6'),
  ('Transport', 'Koszty transportu (autostrady, parking)', 'truck', '#06b6d4'),
  ('Noclegi', 'Koszty noclegów dla ekipy', 'bed', '#ec4899'),
  ('Wyżywienie', 'Catering i wyżywienie ekipy', 'utensils', '#84cc16'),
  ('Inne', 'Pozostałe koszty', 'more-horizontal', '#6b7280')
ON CONFLICT DO NOTHING;

-- Tabela kosztów eventów
CREATE TABLE IF NOT EXISTS event_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category_id uuid REFERENCES event_cost_categories(id),
  
  -- Podstawowe dane
  name text NOT NULL,
  description text,
  amount numeric(12, 2) NOT NULL,
  currency text DEFAULT 'PLN',
  
  -- Daty
  cost_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_date date,
  
  -- Powiązania
  subcontractor_id uuid REFERENCES subcontractors(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  paid_by uuid REFERENCES employees(id),
  
  -- Status
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),
  payment_method text,
  
  -- Załączniki
  receipt_url text,
  invoice_url text,
  notes text,
  
  -- Metadane
  created_by uuid REFERENCES employees(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_event_costs_event_id ON event_costs(event_id);
CREATE INDEX IF NOT EXISTS idx_event_costs_category_id ON event_costs(category_id);
CREATE INDEX IF NOT EXISTS idx_event_costs_status ON event_costs(status);
CREATE INDEX IF NOT EXISTS idx_event_costs_cost_date ON event_costs(cost_date);
CREATE INDEX IF NOT EXISTS idx_event_costs_subcontractor_id ON event_costs(subcontractor_id);

-- Dodaj pola finansowe do events jeśli nie istnieją
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' AND column_name = 'expected_revenue'
  ) THEN
    ALTER TABLE events ADD COLUMN expected_revenue numeric(12, 2) DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' AND column_name = 'actual_revenue'
  ) THEN
    ALTER TABLE events ADD COLUMN actual_revenue numeric(12, 2) DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' AND column_name = 'estimated_costs'
  ) THEN
    ALTER TABLE events ADD COLUMN estimated_costs numeric(12, 2) DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' AND column_name = 'actual_costs'
  ) THEN
    ALTER TABLE events ADD COLUMN actual_costs numeric(12, 2) DEFAULT 0;
  END IF;
END $$;

-- Funkcja do automatycznej aktualizacji actual_costs
CREATE OR REPLACE FUNCTION update_event_actual_costs()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE events
  SET actual_costs = (
    SELECT COALESCE(SUM(amount), 0)
    FROM event_costs
    WHERE event_id = COALESCE(NEW.event_id, OLD.event_id)
    AND status IN ('approved', 'paid')
  ),
  updated_at = now()
  WHERE id = COALESCE(NEW.event_id, OLD.event_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger do aktualizacji kosztów
DROP TRIGGER IF EXISTS trigger_update_event_actual_costs ON event_costs;
CREATE TRIGGER trigger_update_event_actual_costs
AFTER INSERT OR UPDATE OR DELETE ON event_costs
FOR EACH ROW
EXECUTE FUNCTION update_event_actual_costs();

-- Funkcja do aktualizacji actual_revenue z faktur
CREATE OR REPLACE FUNCTION update_event_actual_revenue()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE events
  SET actual_revenue = (
    SELECT COALESCE(SUM(total_gross), 0)
    FROM invoices
    WHERE event_id = COALESCE(NEW.event_id, OLD.event_id)
    AND status IN ('issued', 'sent', 'paid')
  ),
  updated_at = now()
  WHERE id = COALESCE(NEW.event_id, OLD.event_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger do aktualizacji przychodu
DROP TRIGGER IF EXISTS trigger_update_event_actual_revenue ON invoices;
CREATE TRIGGER trigger_update_event_actual_revenue
AFTER INSERT OR UPDATE OF status, total_gross, event_id OR DELETE ON invoices
FOR EACH ROW
EXECUTE FUNCTION update_event_actual_revenue();

-- Funkcja do pobierania podsumowania finansowego eventu
CREATE OR REPLACE FUNCTION get_event_financial_summary(p_event_id uuid)
RETURNS TABLE (
  expected_revenue numeric,
  actual_revenue numeric,
  estimated_costs numeric,
  actual_costs numeric,
  expected_profit numeric,
  actual_profit numeric,
  profit_margin_expected numeric,
  profit_margin_actual numeric,
  invoices_count bigint,
  invoices_paid_count bigint,
  invoices_total numeric,
  costs_count bigint,
  costs_paid_count bigint,
  costs_total numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.expected_revenue,
    e.actual_revenue,
    e.estimated_costs,
    e.actual_costs,
    (e.expected_revenue - e.estimated_costs) as expected_profit,
    (e.actual_revenue - e.actual_costs) as actual_profit,
    CASE 
      WHEN e.expected_revenue > 0 
      THEN ROUND((e.expected_revenue - e.estimated_costs) / e.expected_revenue * 100, 2)
      ELSE 0 
    END as profit_margin_expected,
    CASE 
      WHEN e.actual_revenue > 0 
      THEN ROUND((e.actual_revenue - e.actual_costs) / e.actual_revenue * 100, 2)
      ELSE 0 
    END as profit_margin_actual,
    (SELECT COUNT(*) FROM invoices WHERE event_id = p_event_id) as invoices_count,
    (SELECT COUNT(*) FROM invoices WHERE event_id = p_event_id AND status = 'paid') as invoices_paid_count,
    (SELECT COALESCE(SUM(total_gross), 0) FROM invoices WHERE event_id = p_event_id) as invoices_total,
    (SELECT COUNT(*) FROM event_costs WHERE event_id = p_event_id) as costs_count,
    (SELECT COUNT(*) FROM event_costs WHERE event_id = p_event_id AND status = 'paid') as costs_paid_count,
    (SELECT COALESCE(SUM(amount), 0) FROM event_costs WHERE event_id = p_event_id) as costs_total
  FROM events e
  WHERE e.id = p_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies
ALTER TABLE event_cost_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read cost categories for authenticated"
  ON event_cost_categories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow manage cost categories for finances_manage"
  ON event_cost_categories FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'finances_manage' = ANY(permissions)
    )
  );

ALTER TABLE event_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read event_costs for finances_manage or event access"
  ON event_costs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (
        'finances_manage' = ANY(permissions)
        OR 'admin' = ANY(permissions)
        OR id IN (
          SELECT employee_id FROM employee_assignments
          WHERE event_id = event_costs.event_id
        )
      )
    )
  );

CREATE POLICY "Allow insert event_costs for finances_manage"
  ON event_costs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'finances_manage' = ANY(permissions)
    )
  );

CREATE POLICY "Allow update event_costs for finances_manage"
  ON event_costs FOR UPDATE
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

CREATE POLICY "Allow delete event_costs for finances_manage"
  ON event_costs FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'finances_manage' = ANY(permissions)
    )
  );

-- Uprawnienia do funkcji
GRANT EXECUTE ON FUNCTION get_event_financial_summary(uuid) TO authenticated;

-- Komentarze
COMMENT ON TABLE event_costs IS 'Koszty związane z eventami - paliwo, podwykonawcy, materiały, etc.';
COMMENT ON TABLE event_cost_categories IS 'Kategorie kosztów eventów';
COMMENT ON COLUMN event_costs.status IS 'Status kosztu: pending (oczekujący), approved (zatwierdzony), paid (zapłacony), rejected (odrzucony)';
COMMENT ON FUNCTION get_event_financial_summary IS 'Pobiera kompletne podsumowanie finansowe eventu z przychodami, kosztami i marżą';
