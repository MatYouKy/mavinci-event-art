/*
  # Dodanie filtrowania po firmie do podsumowań miesięcznych

  1. Zmiany w tabeli
    - Dodanie kolumny my_company_id do monthly_financial_summaries
    - Zmiana UNIQUE constraint na (month, year, my_company_id)
  
  2. Funkcje
    - Aktualizacja update_monthly_summary aby przyjmowała my_company_id (NULL = wszystkie firmy)
*/

-- Najpierw usuń starą funkcję
DROP FUNCTION IF EXISTS update_monthly_summary(int, int);

-- Usuń stary unique constraint
ALTER TABLE monthly_financial_summaries 
  DROP CONSTRAINT IF EXISTS monthly_financial_summaries_month_year_key;

-- Dodaj kolumnę my_company_id
ALTER TABLE monthly_financial_summaries 
  ADD COLUMN IF NOT EXISTS my_company_id uuid REFERENCES my_companies(id) ON DELETE CASCADE;

-- Nowy unique constraint z company_id (NULL oznacza "wszystkie firmy")
DROP INDEX IF EXISTS idx_monthly_summaries_unique;
CREATE UNIQUE INDEX idx_monthly_summaries_unique 
  ON monthly_financial_summaries(month, year, COALESCE(my_company_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Dodaj indeks dla lepszej wydajności
CREATE INDEX IF NOT EXISTS idx_monthly_summaries_company 
  ON monthly_financial_summaries(my_company_id);

-- Funkcja do aktualizacji podsumowania dla konkretnej firmy lub wszystkich
CREATE OR REPLACE FUNCTION update_monthly_summary(
  p_month int, 
  p_year int,
  p_company_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Jeśli p_company_id jest NULL, liczymy dla wszystkich firm
  INSERT INTO monthly_financial_summaries (
    month, 
    year, 
    my_company_id,
    total_income, 
    total_expenses, 
    invoices_issued_count, 
    invoices_received_count, 
    invoices_paid_count, 
    invoices_unpaid_count, 
    invoices_overdue_count, 
    bank_statement_uploaded
  )
  SELECT
    p_month,
    p_year,
    p_company_id,
    COALESCE(SUM(CASE WHEN invoice_type = 'issued' THEN gross_amount ELSE 0 END), 0) as total_income,
    COALESCE(SUM(CASE WHEN invoice_type = 'received' THEN gross_amount ELSE 0 END), 0) as total_expenses,
    COUNT(CASE WHEN invoice_type = 'issued' THEN 1 END) as invoices_issued_count,
    COUNT(CASE WHEN invoice_type = 'received' THEN 1 END) as invoices_received_count,
    COUNT(CASE WHEN payment_status = 'paid' THEN 1 END) as invoices_paid_count,
    COUNT(CASE WHEN payment_status = 'unpaid' THEN 1 END) as invoices_unpaid_count,
    COUNT(CASE WHEN payment_status = 'overdue' THEN 1 END) as invoices_overdue_count,
    EXISTS(
      SELECT 1 FROM bank_statements 
      WHERE statement_month = p_month 
        AND statement_year = p_year
    ) as bank_statement_uploaded
  FROM ksef_invoices
  WHERE EXTRACT(MONTH FROM COALESCE(issue_date, ksef_issued_at)) = p_month
    AND EXTRACT(YEAR FROM COALESCE(issue_date, ksef_issued_at)) = p_year
    AND (p_company_id IS NULL OR my_company_id = p_company_id)
  ON CONFLICT (month, year, COALESCE(my_company_id, '00000000-0000-0000-0000-000000000000'::uuid)) 
  DO UPDATE SET
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

COMMENT ON FUNCTION update_monthly_summary IS 'Aktualizuje podsumowanie finansowe dla danego miesiąca i firmy (NULL = wszystkie firmy)';
