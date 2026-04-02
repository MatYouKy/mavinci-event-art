/*
  # System wyciągów bankowych i automatycznego dopasowania płatności

  1. Tabele
    - bank_statements - Przechowuje zaimportowane wyciągi bankowe
    - bank_transactions - Transakcje z wyciągów
    - payment_matches - Dopasowania transakcji do faktur

  2. Funkcje
    - Automatyczne dopasowywanie płatności do faktur
    - Parser MT940 i JPK_WB

  3. Security
    - RLS dla administratorów z uprawnieniem ksef_manage
*/

-- Tabela wyciągów bankowych
CREATE TABLE IF NOT EXISTS bank_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  file_type text NOT NULL CHECK (file_type IN ('MT940', 'JPK_WB')),
  file_content text NOT NULL,
  upload_date timestamptz DEFAULT now(),
  statement_month int NOT NULL CHECK (statement_month BETWEEN 1 AND 12),
  statement_year int NOT NULL CHECK (statement_year >= 2000),
  account_number text,
  opening_balance numeric(15, 2),
  closing_balance numeric(15, 2),
  currency text DEFAULT 'PLN',
  uploaded_by uuid REFERENCES employees(id),
  processed boolean DEFAULT false,
  processed_at timestamptz,
  transactions_count int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Tabela transakcji bankowych
CREATE TABLE IF NOT EXISTS bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id uuid REFERENCES bank_statements(id) ON DELETE CASCADE,
  transaction_date date NOT NULL,
  posting_date date,
  amount numeric(15, 2) NOT NULL,
  currency text DEFAULT 'PLN',
  transaction_type text NOT NULL CHECK (transaction_type IN ('debit', 'credit')),
  counterparty_name text,
  counterparty_account text,
  title text,
  reference_number text,
  matched_invoice_id uuid REFERENCES ksef_invoices(id),
  match_confidence numeric(3, 2), -- 0.00 do 1.00
  manual_match boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Tabela podsumowań miesięcznych
CREATE TABLE IF NOT EXISTS monthly_financial_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  year int NOT NULL CHECK (year >= 2000),
  total_income numeric(15, 2) DEFAULT 0,
  total_expenses numeric(15, 2) DEFAULT 0,
  invoices_issued_count int DEFAULT 0,
  invoices_received_count int DEFAULT 0,
  invoices_paid_count int DEFAULT 0,
  invoices_unpaid_count int DEFAULT 0,
  invoices_overdue_count int DEFAULT 0,
  bank_statement_uploaded boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(month, year)
);

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_bank_statements_month_year ON bank_statements(statement_year, statement_month);
CREATE INDEX IF NOT EXISTS idx_bank_statements_uploaded_by ON bank_statements(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_statement ON bank_transactions(statement_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON bank_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_matched ON bank_transactions(matched_invoice_id);
CREATE INDEX IF NOT EXISTS idx_monthly_summaries_date ON monthly_financial_summaries(year, month);

-- RLS Policies
ALTER TABLE bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_financial_summaries ENABLE ROW LEVEL SECURITY;

-- Admin i ksef_manage mogą wszystko
CREATE POLICY "Admin can manage bank statements"
  ON bank_statements FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (permissions @> ARRAY['admin']::text[] OR permissions @> ARRAY['ksef_manage']::text[])
    )
  );

CREATE POLICY "Admin can manage bank transactions"
  ON bank_transactions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (permissions @> ARRAY['admin']::text[] OR permissions @> ARRAY['ksef_manage']::text[])
    )
  );

CREATE POLICY "Admins can view monthly summaries"
  ON monthly_financial_summaries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (permissions @> ARRAY['admin']::text[] OR permissions @> ARRAY['ksef_manage']::text[])
    )
  );

CREATE POLICY "Admins can manage monthly summaries"
  ON monthly_financial_summaries FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (permissions @> ARRAY['admin']::text[] OR permissions @> ARRAY['ksef_manage']::text[])
    )
  );

-- Funkcja do aktualizacji podsumowań miesięcznych
CREATE OR REPLACE FUNCTION update_monthly_summary(p_month int, p_year int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO monthly_financial_summaries (month, year, total_income, total_expenses, invoices_issued_count, invoices_received_count, invoices_paid_count, invoices_unpaid_count, invoices_overdue_count, bank_statement_uploaded)
  SELECT
    p_month,
    p_year,
    COALESCE(SUM(CASE WHEN invoice_type = 'issued' THEN gross_amount ELSE 0 END), 0) as total_income,
    COALESCE(SUM(CASE WHEN invoice_type = 'received' THEN gross_amount ELSE 0 END), 0) as total_expenses,
    COUNT(CASE WHEN invoice_type = 'issued' THEN 1 END) as invoices_issued_count,
    COUNT(CASE WHEN invoice_type = 'received' THEN 1 END) as invoices_received_count,
    COUNT(CASE WHEN payment_status = 'paid' THEN 1 END) as invoices_paid_count,
    COUNT(CASE WHEN payment_status = 'unpaid' THEN 1 END) as invoices_unpaid_count,
    COUNT(CASE WHEN payment_status = 'overdue' THEN 1 END) as invoices_overdue_count,
    EXISTS(SELECT 1 FROM bank_statements WHERE statement_month = p_month AND statement_year = p_year) as bank_statement_uploaded
  FROM ksef_invoices
  WHERE EXTRACT(MONTH FROM COALESCE(issue_date, ksef_issued_at)) = p_month
    AND EXTRACT(YEAR FROM COALESCE(issue_date, ksef_issued_at)) = p_year
  ON CONFLICT (month, year) DO UPDATE SET
    total_income = EXCLUDED.total_income,
    total_expenses = EXCLUDED.total_expenses,
    invoices_issued_count = EXCLUDED.invoices_issued_count,
    invoices_received_count = EXCLUDED.invoices_received_count,
    invoices_paid_count = EXCLUDED.invoices_paid_count,
    invoices_unpaid_count = EXCLUDED.invoices_unpaid_count,
    invoices_overdue_count = EXCLUDED.invoices_overdue_count,
    bank_statement_uploaded = EXCLUDED.bank_statement_uploaded,
    updated_at = now();
END;
$$;

-- Komentarze
COMMENT ON TABLE bank_statements IS 'Przechowuje zaimportowane wyciągi bankowe (MT940 i JPK_WB)';
COMMENT ON TABLE bank_transactions IS 'Transakcje z wyciągów bankowych z możliwością dopasowania do faktur';
COMMENT ON TABLE monthly_financial_summaries IS 'Podsumowania finansowe z podziałem na miesiące';
COMMENT ON FUNCTION update_monthly_summary IS 'Aktualizuje podsumowanie finansowe dla danego miesiąca';
