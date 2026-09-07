BEGIN;

CREATE TABLE IF NOT EXISTS public.bank_ai_reconciliation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  my_company_id uuid REFERENCES public.my_companies(id) ON DELETE CASCADE,
  statement_month smallint NOT NULL CHECK (statement_month BETWEEN 1 AND 12),
  statement_year integer NOT NULL CHECK (statement_year BETWEEN 2000 AND 2200),
  analysis_version integer NOT NULL CHECK (analysis_version > 0),
  analysis jsonb NOT NULL CHECK (jsonb_typeof(analysis) = 'object'),
  transactions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(transactions) = 'array'),
  documents jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(documents) = 'array'),
  snapshot_stats jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(snapshot_stats) = 'object'),
  matched_keys text[] NOT NULL DEFAULT '{}'::text[],
  is_stale boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL DEFAULT public.current_invoice_employee_id()
    REFERENCES public.employees(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL DEFAULT public.current_invoice_employee_id()
    REFERENCES public.employees(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  scope_key text GENERATED ALWAYS AS (
    CASE
      WHEN my_company_id IS NOT NULL THEN 'company:' || my_company_id::text
      ELSE 'employee:' || created_by::text
    END
  ) STORED
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_ai_report_scope_period
  ON public.bank_ai_reconciliation_reports(scope_key, statement_year, statement_month);
CREATE INDEX IF NOT EXISTS idx_bank_ai_reports_company_period
  ON public.bank_ai_reconciliation_reports(my_company_id, statement_year, statement_month);

ALTER TABLE public.bank_ai_reconciliation_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Bank AI reports are visible to authorized staff"
  ON public.bank_ai_reconciliation_reports;
CREATE POLICY "Bank AI reports are visible to authorized staff"
  ON public.bank_ai_reconciliation_reports FOR SELECT TO authenticated
  USING (
    public.can_view_invoices()
    AND (
      (my_company_id IS NOT NULL AND public.can_view_invoice_company(my_company_id))
      OR (my_company_id IS NULL AND created_by = public.current_invoice_employee_id())
    )
  );

DROP POLICY IF EXISTS "Bank AI reports are created by authorized staff"
  ON public.bank_ai_reconciliation_reports;
CREATE POLICY "Bank AI reports are created by authorized staff"
  ON public.bank_ai_reconciliation_reports FOR INSERT TO authenticated
  WITH CHECK (
    created_by = public.current_invoice_employee_id()
    AND public.can_manage_invoices()
    AND (my_company_id IS NULL OR public.can_manage_invoice_company(my_company_id))
  );

DROP POLICY IF EXISTS "Bank AI reports are updated by authorized staff"
  ON public.bank_ai_reconciliation_reports;
CREATE POLICY "Bank AI reports are updated by authorized staff"
  ON public.bank_ai_reconciliation_reports FOR UPDATE TO authenticated
  USING (
    public.can_manage_invoices()
    AND (
      (my_company_id IS NOT NULL AND public.can_manage_invoice_company(my_company_id))
      OR (my_company_id IS NULL AND created_by = public.current_invoice_employee_id())
    )
  )
  WITH CHECK (
    public.can_manage_invoices()
    AND (
      (my_company_id IS NOT NULL AND public.can_manage_invoice_company(my_company_id))
      OR (my_company_id IS NULL AND created_by = public.current_invoice_employee_id())
    )
  );

DROP POLICY IF EXISTS "Bank AI reports are deleted by authorized staff"
  ON public.bank_ai_reconciliation_reports;
CREATE POLICY "Bank AI reports are deleted by authorized staff"
  ON public.bank_ai_reconciliation_reports FOR DELETE TO authenticated
  USING (
    public.can_manage_invoices()
    AND (
      (my_company_id IS NOT NULL AND public.can_manage_invoice_company(my_company_id))
      OR (my_company_id IS NULL AND created_by = public.current_invoice_employee_id())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_ai_reconciliation_reports TO authenticated;

CREATE OR REPLACE FUNCTION public.stamp_bank_ai_reconciliation_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := public.current_invoice_employee_id();
    NEW.created_at := now();
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;

  NEW.updated_by := public.current_invoice_employee_id();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_bank_ai_reconciliation_report_trigger
  ON public.bank_ai_reconciliation_reports;
CREATE TRIGGER stamp_bank_ai_reconciliation_report_trigger
BEFORE INSERT OR UPDATE ON public.bank_ai_reconciliation_reports
FOR EACH ROW EXECUTE FUNCTION public.stamp_bank_ai_reconciliation_report();

CREATE OR REPLACE FUNCTION public.mark_bank_ai_reports_stale_from_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_company_id uuid;
  v_new_company_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_company_id := OLD.my_company_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_company_id := NEW.my_company_id;
  END IF;

  UPDATE public.bank_ai_reconciliation_reports report
  SET is_stale = true
  WHERE report.is_stale = false
    AND (
      report.my_company_id IS NULL
      OR report.my_company_id = v_old_company_id
      OR report.my_company_id = v_new_company_id
    );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mark_bank_ai_reports_stale_from_external_invoice
  ON public.external_invoices;
CREATE TRIGGER mark_bank_ai_reports_stale_from_external_invoice
AFTER INSERT OR UPDATE OR DELETE ON public.external_invoices
FOR EACH ROW EXECUTE FUNCTION public.mark_bank_ai_reports_stale_from_invoice();

DROP TRIGGER IF EXISTS mark_bank_ai_reports_stale_from_crm_invoice
  ON public.invoices;
CREATE TRIGGER mark_bank_ai_reports_stale_from_crm_invoice
AFTER INSERT OR UPDATE OR DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.mark_bank_ai_reports_stale_from_invoice();

DROP TRIGGER IF EXISTS mark_bank_ai_reports_stale_from_ksef_invoice
  ON public.ksef_invoices;
CREATE TRIGGER mark_bank_ai_reports_stale_from_ksef_invoice
AFTER INSERT OR UPDATE OR DELETE ON public.ksef_invoices
FOR EACH ROW EXECUTE FUNCTION public.mark_bank_ai_reports_stale_from_invoice();

REVOKE ALL ON FUNCTION public.stamp_bank_ai_reconciliation_report() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_bank_ai_reports_stale_from_invoice() FROM PUBLIC;

COMMENT ON TABLE public.bank_ai_reconciliation_reports IS
  'Chronione raporty uzgodnienia AI wraz ze zminimalizowanym snapshotem potrzebnym do ręcznego zatwierdzania dopasowań.';
COMMENT ON COLUMN public.bank_ai_reconciliation_reports.is_stale IS
  'Raport wymaga ponownej analizy, ponieważ zmieniło się co najmniej jedno źródło faktur.';

NOTIFY pgrst, 'reload schema';

COMMIT;
