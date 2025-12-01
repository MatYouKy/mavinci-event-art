/*
  # System budżetu gotówkowego dla klientów indywidualnych

  1. Nowe tabele
    - event_cash_transactions - transakcje gotówkowe dla eventów
    
  2. Nowe pola
    - events.cash_budget - planowany budżet gotówkowy
    - events.actual_cash_revenue - faktyczny przychód gotówkowy
    
  3. Security
    - RLS: tylko admini mają dostęp do transakcji gotówkowych
*/

-- Dodaj pola gotówkowe do events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' AND column_name = 'cash_budget'
  ) THEN
    ALTER TABLE events ADD COLUMN cash_budget numeric DEFAULT 0;
    COMMENT ON COLUMN events.cash_budget IS 'Planowany budżet gotówkowy (dla klientów indywidualnych)';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' AND column_name = 'actual_cash_revenue'
  ) THEN
    ALTER TABLE events ADD COLUMN actual_cash_revenue numeric DEFAULT 0;
    COMMENT ON COLUMN events.actual_cash_revenue IS 'Faktyczny przychód gotówkowy';
  END IF;
END $$;

-- Tabela transakcji gotówkowych
CREATE TABLE IF NOT EXISTS event_cash_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL CHECK (amount > 0),
  description text NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('income', 'expense')),
  category text,
  
  handled_by uuid REFERENCES employees(id),
  handled_by_name text,
  
  confirmed boolean DEFAULT false,
  confirmed_by uuid REFERENCES employees(id),
  confirmed_at timestamptz,
  
  notes text,
  receipt_url text,
  
  created_by uuid REFERENCES employees(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_cash_transactions_event_id ON event_cash_transactions(event_id);
CREATE INDEX IF NOT EXISTS idx_event_cash_transactions_date ON event_cash_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_event_cash_transactions_type ON event_cash_transactions(transaction_type);

COMMENT ON TABLE event_cash_transactions IS 'Transakcje gotówkowe dla eventów (rozliczenia z klientami indywidualnymi) - widoczne tylko dla adminów';

ALTER TABLE event_cash_transactions ENABLE ROW LEVEL SECURITY;

-- RLS - TYLKO ADMINI
CREATE POLICY "Admins can view cash transactions"
  ON event_cash_transactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (role = 'admin' OR 'finances_manage' = ANY(permissions))
    )
  );

CREATE POLICY "Admins can insert cash transactions"
  ON event_cash_transactions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (role = 'admin' OR 'finances_manage' = ANY(permissions))
    )
  );

CREATE POLICY "Admins can update cash transactions"
  ON event_cash_transactions FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (role = 'admin' OR 'finances_manage' = ANY(permissions))
    )
  );

CREATE POLICY "Admins can delete cash transactions"
  ON event_cash_transactions FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND (role = 'admin' OR 'finances_manage' = ANY(permissions))
    )
  );

-- Trigger aktualizacji przychodu gotówkowego
CREATE OR REPLACE FUNCTION update_event_cash_revenue()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE events
  SET actual_cash_revenue = COALESCE((
    SELECT SUM(amount)
    FROM event_cash_transactions
    WHERE event_id = COALESCE(NEW.event_id, OLD.event_id)
      AND transaction_type = 'income'
      AND confirmed = true
  ), 0)
  WHERE id = COALESCE(NEW.event_id, OLD.event_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_update_event_cash_revenue ON event_cash_transactions;
CREATE TRIGGER trigger_update_event_cash_revenue
  AFTER INSERT OR UPDATE OR DELETE ON event_cash_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_event_cash_revenue();

-- Podsumowanie gotówki
CREATE OR REPLACE FUNCTION get_event_cash_summary(p_event_id uuid)
RETURNS TABLE (
  total_income numeric,
  total_expense numeric,
  confirmed_income numeric,
  confirmed_expense numeric,
  pending_income numeric,
  pending_expense numeric,
  balance numeric,
  transactions_count bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(SUM(CASE WHEN transaction_type = 'income' THEN amount ELSE 0 END), 0) as total_income,
    COALESCE(SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END), 0) as total_expense,
    COALESCE(SUM(CASE WHEN transaction_type = 'income' AND confirmed = true THEN amount ELSE 0 END), 0) as confirmed_income,
    COALESCE(SUM(CASE WHEN transaction_type = 'expense' AND confirmed = true THEN amount ELSE 0 END), 0) as confirmed_expense,
    COALESCE(SUM(CASE WHEN transaction_type = 'income' AND confirmed = false THEN amount ELSE 0 END), 0) as pending_income,
    COALESCE(SUM(CASE WHEN transaction_type = 'expense' AND confirmed = false THEN amount ELSE 0 END), 0) as pending_expense,
    COALESCE(
      SUM(CASE WHEN transaction_type = 'income' AND confirmed = true THEN amount ELSE 0 END) -
      SUM(CASE WHEN transaction_type = 'expense' AND confirmed = true THEN amount ELSE 0 END),
      0
    ) as balance,
    COUNT(*) as transactions_count
  FROM event_cash_transactions
  WHERE event_id = p_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Rozszerz get_event_financial_summary
DROP FUNCTION IF EXISTS get_event_financial_summary(uuid);

CREATE FUNCTION get_event_financial_summary(p_event_id uuid)
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
  costs_total numeric,
  cash_budget numeric,
  actual_cash_revenue numeric,
  total_revenue numeric,
  client_type text,
  is_cash_only boolean
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.expected_revenue,
    e.actual_revenue,
    e.estimated_costs,
    e.actual_costs,
    (e.expected_revenue - e.estimated_costs) as expected_profit,
    (e.actual_revenue + e.actual_cash_revenue - e.actual_costs) as actual_profit,
    CASE 
      WHEN e.expected_revenue > 0 
      THEN ((e.expected_revenue - e.estimated_costs) / e.expected_revenue * 100)
      ELSE 0 
    END as profit_margin_expected,
    CASE 
      WHEN (e.actual_revenue + e.actual_cash_revenue) > 0 
      THEN ((e.actual_revenue + e.actual_cash_revenue - e.actual_costs) / (e.actual_revenue + e.actual_cash_revenue) * 100)
      ELSE 0 
    END as profit_margin_actual,
    (SELECT COUNT(*) FROM invoices WHERE event_id = e.id)::bigint as invoices_count,
    (SELECT COUNT(*) FROM invoices WHERE event_id = e.id AND status IN ('paid', 'partially_paid'))::bigint as invoices_paid_count,
    COALESCE((SELECT SUM(total_gross) FROM invoices WHERE event_id = e.id), 0) as invoices_total,
    (SELECT COUNT(*) FROM event_costs WHERE event_id = e.id)::bigint as costs_count,
    (SELECT COUNT(*) FROM event_costs WHERE event_id = e.id AND status = 'paid')::bigint as costs_paid_count,
    COALESCE((SELECT SUM(amount) FROM event_costs WHERE event_id = e.id), 0) as costs_total,
    e.cash_budget,
    e.actual_cash_revenue,
    (e.actual_revenue + e.actual_cash_revenue) as total_revenue,
    e.client_type::text,
    (e.client_type = 'individual')::boolean as is_cash_only
  FROM events e
  WHERE e.id = p_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_event_cash_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_event_financial_summary(uuid) TO authenticated;
