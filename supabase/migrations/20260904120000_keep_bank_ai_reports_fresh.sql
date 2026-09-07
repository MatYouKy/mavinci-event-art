/*
  Keep bank reconciliation reports fresh when a statement or one of its
  transactions changes. A report may search payments up to 12 months away,
  so changing one statement invalidates every overlapping report window.
*/

CREATE OR REPLACE FUNCTION public.mark_bank_ai_reports_stale_for_statement_period(
  p_company_id uuid,
  p_statement_year integer,
  p_statement_month integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_statement_year IS NULL OR p_statement_month IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.bank_ai_reconciliation_reports report
  SET is_stale = true
  WHERE report.is_stale = false
    AND (
      report.my_company_id IS NULL
      OR p_company_id IS NULL
      OR report.my_company_id = p_company_id
    )
    AND abs(
      (report.statement_year * 12 + report.statement_month)
      - (p_statement_year * 12 + p_statement_month)
    ) <= 12;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_bank_ai_reports_stale_from_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM public.mark_bank_ai_reports_stale_for_statement_period(
      OLD.my_company_id,
      OLD.statement_year,
      OLD.statement_month
    );
  END IF;

  IF TG_OP <> 'DELETE' THEN
    PERFORM public.mark_bank_ai_reports_stale_for_statement_period(
      NEW.my_company_id,
      NEW.statement_year,
      NEW.statement_month
    );
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mark_bank_ai_reports_stale_from_statement_trigger
  ON public.bank_statements;
CREATE TRIGGER mark_bank_ai_reports_stale_from_statement_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.bank_statements
FOR EACH ROW EXECUTE FUNCTION public.mark_bank_ai_reports_stale_from_statement();

CREATE OR REPLACE FUNCTION public.mark_bank_ai_reports_stale_from_bank_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_statement record;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.statement_id IS NOT NULL THEN
    SELECT statement.my_company_id, statement.statement_year, statement.statement_month
    INTO v_statement
    FROM public.bank_statements statement
    WHERE statement.id = OLD.statement_id;

    IF FOUND THEN
      PERFORM public.mark_bank_ai_reports_stale_for_statement_period(
        v_statement.my_company_id,
        v_statement.statement_year,
        v_statement.statement_month
      );
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.statement_id IS NOT NULL THEN
    SELECT statement.my_company_id, statement.statement_year, statement.statement_month
    INTO v_statement
    FROM public.bank_statements statement
    WHERE statement.id = NEW.statement_id;

    IF FOUND THEN
      PERFORM public.mark_bank_ai_reports_stale_for_statement_period(
        v_statement.my_company_id,
        v_statement.statement_year,
        v_statement.statement_month
      );
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mark_bank_ai_reports_stale_from_bank_transaction_trigger
  ON public.bank_transactions;
CREATE TRIGGER mark_bank_ai_reports_stale_from_bank_transaction_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.bank_transactions
FOR EACH ROW EXECUTE FUNCTION public.mark_bank_ai_reports_stale_from_bank_transaction();

REVOKE ALL ON FUNCTION public.mark_bank_ai_reports_stale_for_statement_period(uuid, integer, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_bank_ai_reports_stale_from_statement()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_bank_ai_reports_stale_from_bank_transaction()
  FROM PUBLIC;

COMMENT ON FUNCTION public.mark_bank_ai_reports_stale_for_statement_period(uuid, integer, integer)
IS 'Invalidates AI reconciliation reports whose +/-12 month payment-search window overlaps a changed bank statement.';
