BEGIN;

DO $$
BEGIN
  IF to_regclass('public.personnel_contracts') IS NULL
    OR to_regclass('public.personnel_contract_payments') IS NULL
    OR to_regclass('public.bank_ai_reconciliation_reports') IS NULL
  THEN
    RAISE EXCEPTION
      'Najpierw uruchom migracje 20260903209000 i 20260903212000, a nastepnie ponownie te migracje.';
  END IF;
END;
$$;

ALTER TABLE public.bank_ai_reconciliation_reports
  ADD COLUMN IF NOT EXISTS contains_personnel_data boolean NOT NULL DEFAULT false;

UPDATE public.bank_ai_reconciliation_reports report
SET contains_personnel_data = EXISTS (
  SELECT 1
  FROM jsonb_array_elements(report.documents) document_entry
  WHERE document_entry -> 1 ->> 'source' = 'personnel'
);

-- Raport zawierający wynagrodzenia zachowuje dodatkową granicę kadrową.
-- Pozostałe raporty nadal są dostępne na dotychczasowych zasadach finansowych.
DROP POLICY IF EXISTS "Bank AI reports are visible to authorized staff"
  ON public.bank_ai_reconciliation_reports;
CREATE POLICY "Bank AI reports are visible to authorized staff"
  ON public.bank_ai_reconciliation_reports FOR SELECT TO authenticated
  USING (
    public.can_view_invoices()
    AND (NOT contains_personnel_data OR public.can_view_personnel_contracts())
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
    AND (NOT contains_personnel_data OR public.can_manage_personnel_contracts())
    AND (my_company_id IS NULL OR public.can_manage_invoice_company(my_company_id))
  );

DROP POLICY IF EXISTS "Bank AI reports are updated by authorized staff"
  ON public.bank_ai_reconciliation_reports;
CREATE POLICY "Bank AI reports are updated by authorized staff"
  ON public.bank_ai_reconciliation_reports FOR UPDATE TO authenticated
  USING (
    public.can_manage_invoices()
    AND (NOT contains_personnel_data OR public.can_manage_personnel_contracts())
    AND (
      (my_company_id IS NOT NULL AND public.can_manage_invoice_company(my_company_id))
      OR (my_company_id IS NULL AND created_by = public.current_invoice_employee_id())
    )
  )
  WITH CHECK (
    public.can_manage_invoices()
    AND (NOT contains_personnel_data OR public.can_manage_personnel_contracts())
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
    AND (NOT contains_personnel_data OR public.can_manage_personnel_contracts())
    AND (
      (my_company_id IS NOT NULL AND public.can_manage_invoice_company(my_company_id))
      OR (my_company_id IS NULL AND created_by = public.current_invoice_employee_id())
    )
  );

COMMENT ON COLUMN public.bank_ai_reconciliation_reports.contains_personnel_data IS
  'Włącza dodatkowe ograniczenie RLS dla raportów zawierających dane wynagrodzeń.';

-- Płatność kadrowa ma już własne powiązanie z wyciągiem. Rozszerzamy
-- przeliczenie transakcji tak, aby faktury i wypłaty korzystały z jednego salda.
CREATE OR REPLACE FUNCTION public.recalculate_bank_transaction_match_state(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total numeric(15,2);
  v_invoice_allocated numeric(15,2);
  v_personnel_allocated numeric(15,2);
  v_invoice_count integer;
  v_personnel_count integer;
  v_allocated numeric(15,2);
  v_count integer;
  v_single_ksef uuid;
  v_confidence numeric(4,3);
  v_manual boolean;
BEGIN
  SELECT ABS(bt.amount)
  INTO v_total
  FROM public.bank_transactions bt
  WHERE bt.id = p_transaction_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT
    COALESCE(SUM(bank_match.amount), 0),
    COUNT(*),
    CASE WHEN COUNT(*) = 1 THEN (ARRAY_AGG(bank_match.ksef_invoice_id))[1] END,
    MAX(bank_match.confidence),
    COALESCE(BOOL_OR(bank_match.match_method IN ('manual', 'legacy')), false)
  INTO
    v_invoice_allocated,
    v_invoice_count,
    v_single_ksef,
    v_confidence,
    v_manual
  FROM public.bank_transaction_invoice_matches bank_match
  WHERE bank_match.bank_transaction_id = p_transaction_id;

  SELECT COALESCE(SUM(personnel_payment.amount), 0), COUNT(*)
  INTO v_personnel_allocated, v_personnel_count
  FROM public.personnel_contract_payments personnel_payment
  WHERE personnel_payment.bank_transaction_id = p_transaction_id;

  v_allocated := ROUND(COALESCE(v_invoice_allocated, 0) + COALESCE(v_personnel_allocated, 0), 2);
  v_count := COALESCE(v_invoice_count, 0) + COALESCE(v_personnel_count, 0);

  UPDATE public.bank_transactions
  SET allocated_amount = v_allocated,
      matched_document_count = v_count,
      match_status = CASE
        WHEN v_allocated <= 0.009 THEN 'unmatched'
        WHEN v_allocated >= v_total - 0.01 THEN 'matched'
        ELSE 'partial'
      END,
      matched_invoice_id = CASE WHEN v_count = 1 AND v_personnel_count = 0 THEN v_single_ksef END,
      match_confidence = v_confidence,
      manual_match = v_manual OR v_personnel_count > 0
  WHERE id = p_transaction_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_personnel_payment_bank_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.bank_transaction_id IS NOT NULL THEN
    PERFORM public.recalculate_bank_transaction_match_state(NEW.bank_transaction_id);
  END IF;

  IF TG_OP <> 'INSERT'
    AND OLD.bank_transaction_id IS NOT NULL
    AND (TG_OP = 'DELETE' OR OLD.bank_transaction_id IS DISTINCT FROM NEW.bank_transaction_id)
  THEN
    PERFORM public.recalculate_bank_transaction_match_state(OLD.bank_transaction_id);
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_personnel_payment_bank_state_trigger
  ON public.personnel_contract_payments;
CREATE TRIGGER sync_personnel_payment_bank_state_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.personnel_contract_payments
FOR EACH ROW EXECUTE FUNCTION public.sync_personnel_payment_bank_state();

CREATE OR REPLACE FUNCTION public.reconcile_personnel_payment_with_bank_transaction(
  p_transaction_id uuid,
  p_personnel_payment_id uuid,
  p_amount numeric DEFAULT NULL,
  p_confidence numeric DEFAULT NULL,
  p_match_reasons text[] DEFAULT ARRAY[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_transaction public.bank_transactions%ROWTYPE;
  v_statement_company_id uuid;
  v_contract_id uuid;
  v_contract_company_id uuid;
  v_payment_amount numeric(14,2);
  v_payment_currency text;
  v_existing_transaction_id uuid;
  v_available numeric(14,2);
  v_allocate numeric(14,2);
BEGIN
  SELECT bt.*
  INTO v_transaction
  FROM public.bank_transactions bt
  WHERE bt.id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono transakcji bankowej'; END IF;

  SELECT bank_statement.my_company_id
  INTO v_statement_company_id
  FROM public.bank_statements bank_statement
  WHERE bank_statement.id = v_transaction.statement_id;
  IF v_statement_company_id IS NULL THEN
    RAISE EXCEPTION 'Wyciag nie ma przypisanej dzialalnosci';
  END IF;

  IF auth.role() <> 'service_role' AND NOT (
    public.finance_can_manage()
    AND public.finance_company_visible(v_statement_company_id)
    AND public.can_manage_personnel_contracts()
  ) THEN
    RAISE EXCEPTION 'Brak uprawnien do dopasowania wynagrodzenia' USING ERRCODE = '42501';
  END IF;

  SELECT
    personnel_payment.personnel_contract_id,
    personnel_contract.my_company_id,
    personnel_payment.amount,
    UPPER(COALESCE(personnel_payment.currency, 'PLN')),
    personnel_payment.bank_transaction_id
  INTO
    v_contract_id,
    v_contract_company_id,
    v_payment_amount,
    v_payment_currency,
    v_existing_transaction_id
  FROM public.personnel_contract_payments personnel_payment
  JOIN public.personnel_contracts personnel_contract
    ON personnel_contract.id = personnel_payment.personnel_contract_id
  WHERE personnel_payment.id = p_personnel_payment_id
  FOR UPDATE OF personnel_payment, personnel_contract;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono zapisanej wyplaty lub oplaty kadrowej'; END IF;

  IF v_contract_company_id IS NOT NULL
    AND v_contract_company_id IS DISTINCT FROM v_statement_company_id
  THEN
    RAISE EXCEPTION 'Wyplata i transakcja naleza do roznych dzialalnosci';
  END IF;
  IF v_transaction.transaction_type <> 'debit' THEN
    RAISE EXCEPTION 'Wyplata lub oplata kadrowa wymaga transakcji wychodzacej';
  END IF;
  IF UPPER(COALESCE(v_transaction.currency, 'PLN')) <> v_payment_currency THEN
    RAISE EXCEPTION 'Waluta transakcji i zapisanej wyplaty jest rozna';
  END IF;
  IF v_existing_transaction_id IS NOT NULL AND v_existing_transaction_id <> p_transaction_id THEN
    RAISE EXCEPTION 'Ta wyplata jest juz powiazana z inna transakcja';
  END IF;

  v_allocate := ROUND(COALESCE(p_amount, v_payment_amount), 2);
  IF v_allocate <= 0 OR ABS(v_allocate - v_payment_amount) > 0.01 THEN
    RAISE EXCEPTION 'Dopasowanie musi obejmowac pelna kwote zapisanej wyplaty';
  END IF;

  IF v_existing_transaction_id = p_transaction_id THEN
    RETURN jsonb_build_object(
      'personnel_payment_id', p_personnel_payment_id,
      'bank_transaction_id', p_transaction_id,
      'amount', v_payment_amount,
      'already_matched', true
    );
  END IF;

  v_available := ROUND(ABS(v_transaction.amount) - COALESCE(v_transaction.allocated_amount, 0), 2);
  IF v_available <= 0.009 THEN RAISE EXCEPTION 'Transakcja jest juz w calosci rozliczona'; END IF;
  IF v_allocate > v_available + 0.01 THEN
    RAISE EXCEPTION 'Kwota wyplaty przekracza pozostala wartosc transakcji';
  END IF;

  IF v_contract_company_id IS NULL THEN
    UPDATE public.personnel_contracts
    SET my_company_id = v_statement_company_id
    WHERE id = v_contract_id;
  END IF;

  UPDATE public.personnel_contract_payments
  SET bank_transaction_id = p_transaction_id
  WHERE id = p_personnel_payment_id;

  RETURN jsonb_build_object(
    'personnel_payment_id', p_personnel_payment_id,
    'bank_transaction_id', p_transaction_id,
    'amount', v_allocate,
    'confidence', p_confidence,
    'match_reasons', COALESCE(to_jsonb(p_match_reasons), '[]'::jsonb)
  );
END;
$$;

-- Usunięcie wszystkich dopasowań transakcji usuwa również powiązania kadrowe.
CREATE OR REPLACE FUNCTION public.unmatch_bank_transaction(
  p_transaction_id uuid,
  p_match_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_deleted integer := 0;
  v_invoice_deleted integer := 0;
  v_personnel_deleted integer := 0;
BEGIN
  SELECT bank_statement.my_company_id
  INTO v_company_id
  FROM public.bank_transactions bt
  JOIN public.bank_statements bank_statement ON bank_statement.id = bt.statement_id
  WHERE bt.id = p_transaction_id
  FOR UPDATE OF bt;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono transakcji'; END IF;

  IF auth.role() <> 'service_role' AND NOT (
    public.finance_can_manage() AND public.finance_company_visible(v_company_id)
  ) THEN
    RAISE EXCEPTION 'Brak uprawnien do usuniecia dopasowania' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.bank_transaction_invoice_matches
  WHERE bank_transaction_id = p_transaction_id
    AND (p_match_id IS NULL OR id = p_match_id);
  GET DIAGNOSTICS v_invoice_deleted = ROW_COUNT;

  IF p_match_id IS NULL THEN
    UPDATE public.personnel_contract_payments
    SET bank_transaction_id = NULL
    WHERE bank_transaction_id = p_transaction_id;
    GET DIAGNOSTICS v_personnel_deleted = ROW_COUNT;
  END IF;

  v_deleted := v_invoice_deleted + v_personnel_deleted;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_bank_ai_reports_stale_from_personnel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'personnel_contracts' THEN
    IF TG_OP = 'UPDATE' AND OLD.my_company_id IS DISTINCT FROM NEW.my_company_id THEN
      v_company_id := NULL;
    ELSE
      v_company_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.my_company_id ELSE NEW.my_company_id END;
    END IF;
  ELSE
    SELECT contract.my_company_id
    INTO v_company_id
    FROM public.personnel_contracts contract
    WHERE contract.id = CASE
      WHEN TG_OP = 'DELETE' THEN OLD.personnel_contract_id
      ELSE NEW.personnel_contract_id
    END;
  END IF;

  UPDATE public.bank_ai_reconciliation_reports report
  SET is_stale = true
  WHERE report.is_stale = false
    AND (
      v_company_id IS NULL
      OR report.my_company_id IS NULL
      OR report.my_company_id = v_company_id
    );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mark_bank_ai_reports_stale_from_personnel_contract
  ON public.personnel_contracts;
CREATE TRIGGER mark_bank_ai_reports_stale_from_personnel_contract
AFTER INSERT OR UPDATE OR DELETE ON public.personnel_contracts
FOR EACH ROW EXECUTE FUNCTION public.mark_bank_ai_reports_stale_from_personnel();

DROP TRIGGER IF EXISTS mark_bank_ai_reports_stale_from_personnel_payment
  ON public.personnel_contract_payments;
CREATE TRIGGER mark_bank_ai_reports_stale_from_personnel_payment
AFTER INSERT OR UPDATE OR DELETE ON public.personnel_contract_payments
FOR EACH ROW EXECUTE FUNCTION public.mark_bank_ai_reports_stale_from_personnel();

REVOKE ALL ON FUNCTION public.reconcile_personnel_payment_with_bank_transaction(uuid, uuid, numeric, numeric, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_personnel_payment_with_bank_transaction(uuid, uuid, numeric, numeric, text[])
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sync_personnel_payment_bank_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_bank_ai_reports_stale_from_personnel() FROM PUBLIC;

DO $$
DECLARE
  linked_transaction record;
BEGIN
  FOR linked_transaction IN
    SELECT DISTINCT payment.bank_transaction_id
    FROM public.personnel_contract_payments payment
    WHERE payment.bank_transaction_id IS NOT NULL
  LOOP
    PERFORM public.recalculate_bank_transaction_match_state(linked_transaction.bank_transaction_id);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.reconcile_personnel_payment_with_bank_transaction(uuid, uuid, numeric, numeric, text[])
IS 'Atomowo laczy zapisana wyplate lub oplate kadrowa z transakcja bankowa i aktualizuje saldo uzgodnienia.';

NOTIFY pgrst, 'reload schema';

COMMIT;
