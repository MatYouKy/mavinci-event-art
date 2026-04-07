/*
  # Dodanie powiązania wyciągów bankowych z firmami

  1. Zmiany w tabeli
    - Dodanie kolumny my_company_id do bank_statements
    - Zmiana unique constraint na (statement_month, statement_year, my_company_id)
  
  2. Czyszczenie danych
    - Usunięcie istniejących wyciągów (nie wiemy do której firmy należą)
    
  3. Funkcje
    - Aktualizacja update_monthly_summary aby sprawdzała wyciągi dla konkretnej firmy
*/

-- Usuń istniejące wyciągi (nie możemy przypisać ich do firmy)
DELETE FROM bank_statements;

-- Dodaj kolumnę my_company_id
ALTER TABLE bank_statements 
  ADD COLUMN IF NOT EXISTS my_company_id uuid REFERENCES my_companies(id) ON DELETE CASCADE NOT NULL;

-- Dodaj unique constraint aby jeden wyciąg na miesiąc/rok/firmę
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_statements_unique 
  ON bank_statements(statement_month, statement_year, my_company_id);

-- Dodaj indeks dla lepszej wydajności
CREATE INDEX IF NOT EXISTS idx_bank_statements_company 
  ON bank_statements(my_company_id);

-- Zaktualizuj funkcję update_monthly_summary aby sprawdzała wyciągi dla konkretnej firmy
DROP FUNCTION IF EXISTS update_monthly_summary(int, int, uuid);

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
    -- Sprawdź czy istnieje wyciąg dla tej firmy i miesiąca
    EXISTS(
      SELECT 1 FROM bank_statements 
      WHERE statement_month = p_month 
        AND statement_year = p_year
        AND (p_company_id IS NULL OR my_company_id = p_company_id)
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

COMMENT ON COLUMN bank_statements.my_company_id IS 'Firma do której należy wyciąg bankowy';
COMMENT ON FUNCTION update_monthly_summary IS 'Aktualizuje podsumowanie finansowe dla danego miesiąca i firmy (NULL = wszystkie firmy)';
