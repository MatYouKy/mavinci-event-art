/*
  Naprawa importu wyciągów PDF PKO.

  Starszy parser zapisywał saldo rachunku jako kwotę operacji. Błędne rekordy są
  przenoszone do technicznego archiwum, usuwane z aktywnego raportowania, a pliki
  źródłowe wyciągów pozostają w Storage do ponownego, poprawnego importu.
*/

ALTER TABLE public.bank_statements
  DROP CONSTRAINT IF EXISTS bank_statements_file_type_check;
ALTER TABLE public.bank_statements
  ADD CONSTRAINT bank_statements_file_type_check
  CHECK (file_type IN ('MT940', 'JPK_WB', 'PDF'));

ALTER TABLE public.bank_statements
  DROP CONSTRAINT IF EXISTS bank_statements_account_type_check;
ALTER TABLE public.bank_statements
  ADD CONSTRAINT bank_statements_account_type_check
  CHECK (account_type IN ('regular', 'vat', 'mt940'));

ALTER TABLE public.bank_statements
  ADD COLUMN IF NOT EXISTS import_format text,
  ADD COLUMN IF NOT EXISTS parser_version integer,
  ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS validation_message text;

ALTER TABLE public.bank_statements
  DROP CONSTRAINT IF EXISTS bank_statements_validation_status_check;
ALTER TABLE public.bank_statements
  ADD CONSTRAINT bank_statements_validation_status_check
  CHECK (validation_status IN ('pending', 'valid', 'rejected'));

CREATE TABLE IF NOT EXISTS public.bank_transactions_import_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_transaction_id uuid NOT NULL UNIQUE,
  statement_id uuid,
  payload jsonb NOT NULL,
  archive_reason text NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_transactions_import_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bank_transactions_import_archive FROM anon, authenticated;

CREATE TEMP TABLE invalid_pdf_statements ON COMMIT DROP AS
SELECT bs.id
FROM public.bank_statements bs
WHERE bs.account_type IN ('regular', 'vat')
  AND COALESCE(bs.parser_version, 0) < 2;

CREATE TEMP TABLE invoices_matched_by_invalid_import ON COMMIT DROP AS
SELECT DISTINCT bt.matched_invoice_id AS invoice_id
FROM public.bank_transactions bt
JOIN invalid_pdf_statements bad ON bad.id = bt.statement_id
WHERE bt.matched_invoice_id IS NOT NULL;

INSERT INTO public.bank_transactions_import_archive (
  original_transaction_id,
  statement_id,
  payload,
  archive_reason
)
SELECT
  bt.id,
  bt.statement_id,
  to_jsonb(bt),
  'legacy_pdf_parser_used_account_balance_as_transaction_amount'
FROM public.bank_transactions bt
JOIN invalid_pdf_statements bad ON bad.id = bt.statement_id
ON CONFLICT (original_transaction_id) DO NOTHING;

DELETE FROM public.bank_transactions bt
USING invalid_pdf_statements bad
WHERE bt.statement_id = bad.id;

UPDATE public.bank_statements bs
SET processed = false,
    processed_at = NULL,
    transactions_count = 0,
    file_type = 'PDF',
    import_format = 'PDF',
    validation_status = 'rejected',
    validation_message = 'Wycofano transakcje utworzone przez parser PDF v1. Plik źródłowy zachowano do ponownego importu.'
FROM invalid_pdf_statements bad
WHERE bs.id = bad.id;

-- Istniejące importy MT940 nie korzystały z wadliwego parsera PDF. Nadajemy im
-- status poprawny przed założeniem ograniczenia dla przetworzonych wyciągów.
UPDATE public.bank_statements bs
SET import_format = COALESCE(bs.import_format, bs.file_type),
    parser_version = COALESCE(bs.parser_version, 1),
    validation_status = 'valid',
    validation_message = NULL
WHERE bs.processed = true
  AND bs.account_type = 'mt940'
  AND bs.file_type IN ('MT940', 'JPK_WB');

ALTER TABLE public.bank_statements
  DROP CONSTRAINT IF EXISTS bank_statements_processed_requires_validation;
ALTER TABLE public.bank_statements
  ADD CONSTRAINT bank_statements_processed_requires_validation
  CHECK (
    processed IS NOT TRUE
    OR (
      validation_status = 'valid'
      AND (file_type <> 'PDF' OR COALESCE(parser_version, 0) >= 2)
    )
  );

UPDATE public.ksef_invoices ki
SET payment_status = CASE
      WHEN COALESCE(p.paid_amount, 0) >= COALESCE(ki.gross_amount, 0) AND COALESCE(ki.gross_amount, 0) > 0 THEN 'paid'
      WHEN COALESCE(p.paid_amount, 0) > 0 THEN 'partially_paid'
      WHEN ki.payment_due_date IS NOT NULL AND ki.payment_due_date < CURRENT_DATE THEN 'overdue'
      ELSE 'unpaid'
    END,
    payment_date = CASE WHEN COALESCE(p.paid_amount, 0) > 0 THEN p.latest_payment ELSE NULL END
FROM invoices_matched_by_invalid_import affected
LEFT JOIN (
  SELECT kp.ksef_invoice_id,
         SUM(kp.amount) AS paid_amount,
         MAX(kp.payment_date) AS latest_payment
  FROM public.ksef_invoice_payments kp
  GROUP BY kp.ksef_invoice_id
) p ON p.ksef_invoice_id = affected.invoice_id
WHERE ki.id = affected.invoice_id;

CREATE OR REPLACE FUNCTION public.update_monthly_summary(
  p_month int,
  p_year int,
  p_company_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.monthly_financial_summaries (
    month, year, my_company_id, total_income, total_expenses,
    invoices_issued_count, invoices_received_count, invoices_paid_count,
    invoices_unpaid_count, invoices_overdue_count, bank_statement_uploaded
  )
  SELECT
    p_month,
    p_year,
    p_company_id,
    COALESCE(SUM(CASE WHEN ki.invoice_type = 'issued' THEN ki.gross_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ki.invoice_type = 'received' THEN ki.gross_amount ELSE 0 END), 0),
    COUNT(CASE WHEN ki.invoice_type = 'issued' THEN 1 END),
    COUNT(CASE WHEN ki.invoice_type = 'received' THEN 1 END),
    COUNT(CASE WHEN ki.payment_status = 'paid' THEN 1 END),
    COUNT(CASE WHEN ki.payment_status = 'unpaid' THEN 1 END),
    COUNT(CASE WHEN ki.payment_status = 'overdue' THEN 1 END),
    EXISTS (
      SELECT 1
      FROM public.bank_statements bs
      WHERE bs.statement_month = p_month
        AND bs.statement_year = p_year
        AND bs.processed = true
        AND bs.validation_status = 'valid'
        AND (p_company_id IS NULL OR bs.my_company_id = p_company_id)
    )
  FROM public.ksef_invoices ki
  LEFT JOIN public.invoices inv ON ki.invoice_id = inv.id
  WHERE EXTRACT(MONTH FROM COALESCE(ki.issue_date, ki.ksef_issued_at)) = p_month
    AND EXTRACT(YEAR FROM COALESCE(ki.issue_date, ki.ksef_issued_at)) = p_year
    AND (p_company_id IS NULL OR ki.my_company_id = p_company_id)
    AND NOT (
      COALESCE(inv.invoice_type, '') = 'advance'
      OR (ki.invoice_id IS NULL AND ki.invoice_number LIKE 'ZAL%')
    )
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

UPDATE public.monthly_financial_summaries summary
SET bank_statement_uploaded = EXISTS (
  SELECT 1
  FROM public.bank_statements bs
  WHERE bs.statement_month = summary.month
    AND bs.statement_year = summary.year
    AND bs.processed = true
    AND bs.validation_status = 'valid'
    AND (summary.my_company_id IS NULL OR bs.my_company_id = summary.my_company_id)
), updated_at = now();

COMMENT ON TABLE public.bank_transactions_import_archive IS
  'Techniczne, niedostępne dla aplikacji archiwum błędnych transakcji wycofanych z raportowania.';
