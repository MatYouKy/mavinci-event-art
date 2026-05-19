/*
  # Fix monthly summary to exclude advance (zaliczkowe) and proforma invoices

  1. Changes
    - Updated `update_monthly_summary` function to exclude advance invoices from totals
    - Advance invoices are identified by:
      a) Link to local `invoices` table with `invoice_type = 'advance'`
      b) Invoice number starting with 'ZAL' prefix (for KSeF invoices without local link)
    - Proforma invoices never appear in KSeF, so no filtering needed for those
    - Final/settlement invoices (FKO) already include the advance amounts, so excluding
      advances prevents double-counting

  2. Rationale
    - Advance invoices are settled/included in final invoices (FKO), so counting them
      separately would inflate revenue figures
    - Proforma is not a fiscal document and never goes to KSeF
*/

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
    COALESCE(SUM(CASE WHEN ki.invoice_type = 'issued' THEN ki.gross_amount ELSE 0 END), 0) as total_income,
    COALESCE(SUM(CASE WHEN ki.invoice_type = 'received' THEN ki.gross_amount ELSE 0 END), 0) as total_expenses,
    COUNT(CASE WHEN ki.invoice_type = 'issued' THEN 1 END) as invoices_issued_count,
    COUNT(CASE WHEN ki.invoice_type = 'received' THEN 1 END) as invoices_received_count,
    COUNT(CASE WHEN ki.payment_status = 'paid' THEN 1 END) as invoices_paid_count,
    COUNT(CASE WHEN ki.payment_status = 'unpaid' THEN 1 END) as invoices_unpaid_count,
    COUNT(CASE WHEN ki.payment_status = 'overdue' THEN 1 END) as invoices_overdue_count,
    EXISTS(
      SELECT 1 FROM bank_statements 
      WHERE statement_month = p_month 
        AND statement_year = p_year
        AND (p_company_id IS NULL OR my_company_id = p_company_id)
    ) as bank_statement_uploaded
  FROM ksef_invoices ki
  LEFT JOIN invoices inv ON ki.invoice_id = inv.id
  WHERE EXTRACT(MONTH FROM COALESCE(ki.issue_date, ki.ksef_issued_at)) = p_month
    AND EXTRACT(YEAR FROM COALESCE(ki.issue_date, ki.ksef_issued_at)) = p_year
    AND (p_company_id IS NULL OR ki.my_company_id = p_company_id)
    -- Exclude advance invoices (zaliczkowe) - they are settled in final invoices
    AND NOT (
      COALESCE(inv.invoice_type, '') = 'advance'
      OR (ki.invoice_id IS NULL AND ki.invoice_number LIKE 'ZAL%')
    )
    -- Exclude proforma invoices (should not be in KSeF, but just in case)
    AND NOT (
      COALESCE(inv.invoice_type, '') = 'proforma'
      OR COALESCE(inv.is_proforma, false) = true
    )
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

COMMENT ON FUNCTION update_monthly_summary IS 'Aktualizuje podsumowanie finansowe dla danego miesiąca i firmy. Wyklucza faktury zaliczkowe (ZAL) i proforma z bilansu.';
