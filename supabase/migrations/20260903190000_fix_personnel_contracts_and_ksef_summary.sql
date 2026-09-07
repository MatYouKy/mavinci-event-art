BEGIN;

-- Umowy cywilnoprawne są osobnym rejestrem. Nie łączymy ich z generatorami
-- umów, ofert ani kalkulacji wydarzeń.
CREATE TABLE IF NOT EXISTS public.personnel_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  subcontractor_id uuid REFERENCES public.subcontractors(id) ON DELETE CASCADE,
  contract_kind text NOT NULL CHECK (contract_kind IN ('mandate', 'specific_work')),
  contract_number text NOT NULL,
  title text NOT NULL,
  start_date date,
  end_date date,
  gross_value numeric(14,2),
  currency text NOT NULL DEFAULT 'PLN' CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'completed', 'terminated')),
  file_url text,
  notes text,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personnel_contracts_exactly_one_party CHECK (
    num_nonnulls(employee_id, subcontractor_id) = 1
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_personnel_contract_number
  ON public.personnel_contracts(lower(contract_number));
CREATE INDEX IF NOT EXISTS idx_personnel_contracts_employee
  ON public.personnel_contracts(employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_personnel_contracts_subcontractor
  ON public.personnel_contracts(subcontractor_id) WHERE subcontractor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_personnel_contracts_dates
  ON public.personnel_contracts(start_date, end_date);

ALTER TABLE public.personnel_contracts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_view_personnel_contracts()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.is_crm_admin() OR EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = public.current_workflow_employee_id()
      AND employee.is_active = true
      AND COALESCE(employee.permissions, '{}'::text[]) && ARRAY[
        'employees_view',
        'employees_manage',
        'subcontractors_view',
        'subcontractors_manage'
      ]::text[]
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_personnel_contracts()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.is_crm_admin() OR EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = public.current_workflow_employee_id()
      AND employee.is_active = true
      AND COALESCE(employee.permissions, '{}'::text[]) && ARRAY[
        'employees_manage',
        'subcontractors_manage'
      ]::text[]
  );
$$;

DROP POLICY IF EXISTS "Personnel contracts are visible to authorized staff"
  ON public.personnel_contracts;
CREATE POLICY "Personnel contracts are visible to authorized staff"
  ON public.personnel_contracts FOR SELECT TO authenticated
  USING (public.can_view_personnel_contracts());

DROP POLICY IF EXISTS "Personnel contracts are managed by authorized staff"
  ON public.personnel_contracts;
CREATE POLICY "Personnel contracts are managed by authorized staff"
  ON public.personnel_contracts FOR ALL TO authenticated
  USING (public.can_manage_personnel_contracts())
  WITH CHECK (public.can_manage_personnel_contracts());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.personnel_contracts TO authenticated;
REVOKE ALL ON FUNCTION public.can_view_personnel_contracts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_personnel_contracts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_personnel_contracts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_personnel_contracts() TO authenticated;

-- Podsumowanie może korzystać wyłącznie z dokumentów faktycznie zsynchronizowanych
-- i posiadających numer KSeF. Rekord roboczy utworzony przed synchronizacją nie może
-- być liczony drugi raz obok oficjalnego dokumentu.
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
    COALESCE(SUM(CASE WHEN ksef.invoice_type = 'issued' THEN ksef.gross_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ksef.invoice_type = 'received' THEN ksef.gross_amount ELSE 0 END), 0),
    COUNT(CASE WHEN ksef.invoice_type = 'issued' THEN 1 END),
    COUNT(CASE WHEN ksef.invoice_type = 'received' THEN 1 END),
    COUNT(CASE WHEN ksef.payment_status = 'paid' THEN 1 END),
    COUNT(CASE WHEN ksef.payment_status = 'unpaid' THEN 1 END),
    COUNT(CASE WHEN ksef.payment_status = 'overdue' THEN 1 END),
    EXISTS (
      SELECT 1
      FROM public.bank_statements statement
      WHERE statement.statement_month = p_month
        AND statement.statement_year = p_year
        AND statement.processed = true
        AND statement.validation_status = 'valid'
        AND (p_company_id IS NULL OR statement.my_company_id = p_company_id)
    )
  FROM public.ksef_invoices ksef
  LEFT JOIN public.invoices invoice ON ksef.invoice_id = invoice.id
  WHERE EXTRACT(MONTH FROM COALESCE(ksef.issue_date, ksef.ksef_issued_at)) = p_month
    AND EXTRACT(YEAR FROM COALESCE(ksef.issue_date, ksef.ksef_issued_at)) = p_year
    AND (p_company_id IS NULL OR ksef.my_company_id = p_company_id)
    AND ksef.sync_status = 'synced'
    AND NULLIF(BTRIM(ksef.ksef_reference_number), '') IS NOT NULL
    AND NOT (
      COALESCE(invoice.invoice_type, '') = 'advance'
      OR (ksef.invoice_id IS NULL AND ksef.invoice_number LIKE 'ZAL%')
    )
    AND NOT (
      COALESCE(invoice.invoice_type, '') = 'proforma'
      OR COALESCE(invoice.is_proforma, false) = true
    )
  ON CONFLICT (
    month,
    year,
    COALESCE(my_company_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
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

-- Przeliczenie istniejących podsumowań nastąpi od razu po wdrożeniu migracji.
DO $$
DECLARE
  summary_row record;
BEGIN
  FOR summary_row IN
    SELECT DISTINCT month, year, my_company_id
    FROM public.monthly_financial_summaries
  LOOP
    PERFORM public.update_monthly_summary(
      summary_row.month,
      summary_row.year,
      summary_row.my_company_id
    );
  END LOOP;
END;
$$;

COMMIT;
