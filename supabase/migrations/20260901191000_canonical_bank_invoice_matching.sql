BEGIN;

-- Rozliczenie przelewu i dokumentu jest relacja wiele-do-wielu. Stara kolumna
-- bank_transactions.matched_invoice_id pozostaje jedynie polem kompatybilnosci
-- dla pojedynczego dopasowania KSeF i nie jest juz zrodlem prawdy.
ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS allocated_amount numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS matched_document_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS match_status text NOT NULL DEFAULT 'unmatched';

ALTER TABLE public.bank_transactions DROP CONSTRAINT IF EXISTS bank_transactions_match_status_check;
ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_match_status_check
  CHECK (match_status IN ('unmatched', 'partial', 'matched'));

ALTER TABLE public.bank_transactions DROP CONSTRAINT IF EXISTS bank_transactions_allocated_amount_check;
ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_allocated_amount_check CHECK (allocated_amount >= 0);

-- Kwota ustawiona recznie jest przechowywana osobno od sumy dopasowan bankowych.
-- Dzieki temu odpiecie wyciagu nie usuwa platnosci wprowadzonej recznie.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS manual_paid_amount numeric(14,2) NOT NULL DEFAULT 0;

UPDATE public.invoices
SET manual_paid_amount = GREATEST(COALESCE(paid_amount, 0), 0)
WHERE manual_paid_amount = 0 AND COALESCE(paid_amount, 0) > 0;

ALTER TABLE public.external_invoices
  ADD COLUMN IF NOT EXISTS paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS manual_paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_amount_needs_review boolean NOT NULL DEFAULT false;

UPDATE public.external_invoices
SET paid_amount = CASE
      WHEN payment_status = 'paid' THEN ABS(COALESCE(amount_gross, 0))
      ELSE COALESCE(paid_amount, 0)
    END,
    manual_paid_amount = CASE
      WHEN payment_status = 'paid' THEN ABS(COALESCE(amount_gross, 0))
      ELSE COALESCE(manual_paid_amount, 0)
    END,
    payment_amount_needs_review = (payment_status = 'partially_paid' AND COALESCE(paid_amount, 0) <= 0);

ALTER TABLE public.external_invoices DROP CONSTRAINT IF EXISTS external_invoices_paid_amount_check;
ALTER TABLE public.external_invoices
  ADD CONSTRAINT external_invoices_paid_amount_check CHECK (paid_amount >= 0 AND manual_paid_amount >= 0);

CREATE TABLE IF NOT EXISTS public.bank_transaction_invoice_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id uuid NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  document_source text NOT NULL CHECK (document_source IN ('invoice', 'ksef', 'external')),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
  ksef_invoice_id uuid REFERENCES public.ksef_invoices(id) ON DELETE CASCADE,
  external_invoice_id uuid REFERENCES public.external_invoices(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'PLN' CHECK (currency ~ '^[A-Z]{3}$'),
  confidence numeric(4,3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  match_method text NOT NULL DEFAULT 'manual' CHECK (match_method IN ('automatic', 'manual', 'legacy')),
  match_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_match_exactly_one_document CHECK (
    num_nonnulls(invoice_id, ksef_invoice_id, external_invoice_id) = 1
    AND (document_source = 'invoice') = (invoice_id IS NOT NULL)
    AND (document_source = 'ksef') = (ksef_invoice_id IS NOT NULL)
    AND (document_source = 'external') = (external_invoice_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_match_transaction_invoice
  ON public.bank_transaction_invoice_matches(bank_transaction_id, invoice_id)
  WHERE invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_match_transaction_ksef
  ON public.bank_transaction_invoice_matches(bank_transaction_id, ksef_invoice_id)
  WHERE ksef_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_match_transaction_external
  ON public.bank_transaction_invoice_matches(bank_transaction_id, external_invoice_id)
  WHERE external_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bank_matches_transaction
  ON public.bank_transaction_invoice_matches(bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_bank_matches_invoice
  ON public.bank_transaction_invoice_matches(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bank_matches_ksef
  ON public.bank_transaction_invoice_matches(ksef_invoice_id) WHERE ksef_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bank_matches_external
  ON public.bank_transaction_invoice_matches(external_invoice_id) WHERE external_invoice_id IS NOT NULL;

ALTER TABLE public.ksef_invoice_payments
  ADD COLUMN IF NOT EXISTS bank_match_id uuid REFERENCES public.bank_transaction_invoice_matches(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS payment_source text NOT NULL DEFAULT 'manual';
CREATE UNIQUE INDEX IF NOT EXISTS uq_ksef_invoice_payment_bank_match
  ON public.ksef_invoice_payments(bank_match_id) WHERE bank_match_id IS NOT NULL;

ALTER TABLE public.ksef_invoice_payments DROP CONSTRAINT IF EXISTS ksef_invoice_payments_source_check;
ALTER TABLE public.ksef_invoice_payments
  ADD CONSTRAINT ksef_invoice_payments_source_check
  CHECK (payment_source IN ('manual', 'bank'));

CREATE OR REPLACE FUNCTION public.validate_ksef_invoice_payment_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_due numeric(14,2);
  v_other_payments numeric(14,2);
BEGIN
  SELECT ABS(COALESCE(ki.amount_to_pay_gross, ki.gross_amount, 0))
  INTO v_due
  FROM public.ksef_invoices ki
  WHERE ki.id = NEW.ksef_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono dokumentu KSeF'; END IF;
  IF NEW.amount <= 0 THEN RAISE EXCEPTION 'Kwota platnosci musi byc dodatnia'; END IF;

  SELECT COALESCE(SUM(kp.amount), 0)
  INTO v_other_payments
  FROM public.ksef_invoice_payments kp
  WHERE kp.ksef_invoice_id = NEW.ksef_invoice_id
    AND (TG_OP = 'INSERT' OR kp.id <> NEW.id);

  IF v_other_payments + NEW.amount > v_due + 0.01 THEN
    RAISE EXCEPTION 'Suma platnosci przekracza kwote dokumentu KSeF';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_ksef_invoice_payment_amount ON public.ksef_invoice_payments;
CREATE TRIGGER trg_validate_ksef_invoice_payment_amount
BEFORE INSERT OR UPDATE OF amount, ksef_invoice_id ON public.ksef_invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.validate_ksef_invoice_payment_amount();

CREATE OR REPLACE FUNCTION public.recalculate_ksef_invoice_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice_id uuid;
  v_sum numeric(14,2);
  v_due_amount numeric(14,2);
  v_due_date date;
  v_latest_date date;
BEGIN
  v_invoice_id := COALESCE(NEW.ksef_invoice_id, OLD.ksef_invoice_id);
  SELECT COALESCE(SUM(kp.amount), 0), MAX(kp.payment_date)
  INTO v_sum, v_latest_date
  FROM public.ksef_invoice_payments kp
  WHERE kp.ksef_invoice_id = v_invoice_id;

  SELECT ABS(COALESCE(ki.amount_to_pay_gross, ki.gross_amount, 0)), ki.payment_due_date
  INTO v_due_amount, v_due_date
  FROM public.ksef_invoices ki WHERE ki.id = v_invoice_id;
  IF NOT FOUND THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE public.ksef_invoices
  SET payment_status = CASE
        WHEN v_sum <= 0.009 AND v_due_date IS NOT NULL AND v_due_date < CURRENT_DATE THEN 'overdue'
        WHEN v_sum <= 0.009 THEN 'unpaid'
        WHEN v_due_amount > 0 AND v_sum >= v_due_amount - 0.01 THEN 'paid'
        ELSE 'partially_paid'
      END,
      payment_date = CASE WHEN v_sum > 0.009 THEN v_latest_date ELSE NULL END
  WHERE id = v_invoice_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Zachowujemy wszystkie stare wskazania jako audyt. Tylko dopasowania reczne
-- albo automatyczne o bardzo wysokiej pewnosci sa migrowane jako platnosci.
CREATE TABLE IF NOT EXISTS public.legacy_bank_transaction_match_audit (
  bank_transaction_id uuid PRIMARY KEY,
  ksef_invoice_id uuid NOT NULL,
  confidence numeric(4,3),
  manual_match boolean NOT NULL DEFAULT false,
  migrated_as_payment boolean NOT NULL DEFAULT false,
  audit_reason text NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.financial_payment_review_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_source text NOT NULL CHECK (document_source IN ('invoice', 'ksef', 'external')),
  document_id uuid NOT NULL,
  my_company_id uuid REFERENCES public.my_companies(id) ON DELETE CASCADE,
  issue_code text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_source, document_id, issue_code)
);

CREATE OR REPLACE FUNCTION public.resolve_ksef_payment_review_on_ledger_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.financial_payment_review_issues
  SET resolved_at = COALESCE(resolved_at, now()),
      resolved_by = COALESCE(resolved_by, NEW.created_by)
  WHERE document_source = 'ksef'
    AND document_id = NEW.ksef_invoice_id
    AND issue_code = 'payment_status_without_ledger'
    AND resolved_at IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resolve_ksef_payment_review ON public.ksef_invoice_payments;
CREATE TRIGGER trg_resolve_ksef_payment_review
AFTER INSERT ON public.ksef_invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.resolve_ksef_payment_review_on_ledger_entry();

ALTER TABLE public.bank_transaction_invoice_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_bank_transaction_match_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_payment_review_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can manage bank statements" ON public.bank_statements;
DROP POLICY IF EXISTS bank_statements_finance_read ON public.bank_statements;
CREATE POLICY bank_statements_finance_read ON public.bank_statements
  FOR SELECT TO authenticated USING (
    public.finance_can_view() AND public.finance_company_visible(my_company_id)
  );
DROP POLICY IF EXISTS bank_statements_finance_manage ON public.bank_statements;
CREATE POLICY bank_statements_finance_manage ON public.bank_statements
  FOR ALL TO authenticated
  USING (public.finance_can_manage() AND public.finance_company_visible(my_company_id))
  WITH CHECK (public.finance_can_manage() AND public.finance_company_visible(my_company_id));

DROP POLICY IF EXISTS "Admin can manage bank transactions" ON public.bank_transactions;
DROP POLICY IF EXISTS bank_transactions_finance_read ON public.bank_transactions;
CREATE POLICY bank_transactions_finance_read ON public.bank_transactions
  FOR SELECT TO authenticated USING (
    public.finance_can_view()
    AND EXISTS (
      SELECT 1 FROM public.bank_statements bs
      WHERE bs.id = statement_id AND public.finance_company_visible(bs.my_company_id)
    )
  );
DROP POLICY IF EXISTS bank_transactions_finance_manage ON public.bank_transactions;
CREATE POLICY bank_transactions_finance_manage ON public.bank_transactions
  FOR ALL TO authenticated
  USING (
    public.finance_can_manage()
    AND EXISTS (
      SELECT 1 FROM public.bank_statements bs
      WHERE bs.id = statement_id AND public.finance_company_visible(bs.my_company_id)
    )
  )
  WITH CHECK (
    public.finance_can_manage()
    AND EXISTS (
      SELECT 1 FROM public.bank_statements bs
      WHERE bs.id = statement_id AND public.finance_company_visible(bs.my_company_id)
    )
  );

DROP POLICY IF EXISTS bank_matches_read ON public.bank_transaction_invoice_matches;
CREATE POLICY bank_matches_read ON public.bank_transaction_invoice_matches
  FOR SELECT TO authenticated
  USING (
    public.finance_can_view()
    AND EXISTS (
      SELECT 1
      FROM public.bank_transactions bt
      JOIN public.bank_statements bs ON bs.id = bt.statement_id
      WHERE bt.id = bank_transaction_id
        AND public.finance_company_visible(bs.my_company_id)
    )
  );

DROP POLICY IF EXISTS legacy_bank_matches_read ON public.legacy_bank_transaction_match_audit;
CREATE POLICY legacy_bank_matches_read ON public.legacy_bank_transaction_match_audit
  FOR SELECT TO authenticated USING (public.finance_can_manage());

REVOKE ALL ON public.bank_transaction_invoice_matches FROM anon, authenticated;
GRANT SELECT ON public.bank_transaction_invoice_matches TO authenticated;
REVOKE ALL ON public.legacy_bank_transaction_match_audit FROM anon, authenticated;
GRANT SELECT ON public.legacy_bank_transaction_match_audit TO authenticated;
DROP POLICY IF EXISTS financial_payment_review_read ON public.financial_payment_review_issues;
CREATE POLICY financial_payment_review_read ON public.financial_payment_review_issues
  FOR SELECT TO authenticated USING (
    public.finance_can_view() AND public.finance_company_visible(my_company_id)
  );
DROP POLICY IF EXISTS financial_payment_review_manage ON public.financial_payment_review_issues;
CREATE POLICY financial_payment_review_manage ON public.financial_payment_review_issues
  FOR UPDATE TO authenticated
  USING (public.finance_can_manage() AND public.finance_company_visible(my_company_id))
  WITH CHECK (public.finance_can_manage() AND public.finance_company_visible(my_company_id));
REVOKE ALL ON public.financial_payment_review_issues FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.financial_payment_review_issues TO authenticated;

-- Poprzednie polityki platnosci KSeF dawaly kazdemu zalogowanemu uzytkownikowi
-- pelny zapis. Ograniczamy je do uprawnien finansowych i firmy dokumentu.
DROP POLICY IF EXISTS "Authenticated can view ksef invoice payments" ON public.ksef_invoice_payments;
DROP POLICY IF EXISTS "Authenticated can insert ksef invoice payments" ON public.ksef_invoice_payments;
DROP POLICY IF EXISTS "Authenticated can update ksef invoice payments" ON public.ksef_invoice_payments;
DROP POLICY IF EXISTS "Authenticated can delete ksef invoice payments" ON public.ksef_invoice_payments;
DROP POLICY IF EXISTS ksef_invoice_payments_read ON public.ksef_invoice_payments;
CREATE POLICY ksef_invoice_payments_read ON public.ksef_invoice_payments
  FOR SELECT TO authenticated USING (
    public.finance_can_view()
    AND EXISTS (
      SELECT 1 FROM public.ksef_invoices ki
      WHERE ki.id = ksef_invoice_id
        AND public.finance_company_visible(ki.my_company_id)
    )
  );
DROP POLICY IF EXISTS ksef_invoice_payments_manage ON public.ksef_invoice_payments;
CREATE POLICY ksef_invoice_payments_manage ON public.ksef_invoice_payments
  FOR ALL TO authenticated
  USING (
    public.finance_can_manage()
    AND EXISTS (
      SELECT 1 FROM public.ksef_invoices ki
      WHERE ki.id = ksef_invoice_id
        AND public.finance_company_visible(ki.my_company_id)
    )
  )
  WITH CHECK (
    public.finance_can_manage()
    AND EXISTS (
      SELECT 1 FROM public.ksef_invoices ki
      WHERE ki.id = ksef_invoice_id
        AND public.finance_company_visible(ki.my_company_id)
    )
  );

CREATE OR REPLACE FUNCTION public.bank_document_due_amount(
  p_invoice_id uuid DEFAULT NULL,
  p_ksef_invoice_id uuid DEFAULT NULL,
  p_external_invoice_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_due numeric(14,2);
BEGIN
  IF p_invoice_id IS NOT NULL THEN
    SELECT ABS(CASE
      WHEN i.invoice_type = 'final' AND i.settlement_summary IS NOT NULL
        THEN COALESCE(NULLIF(i.settlement_summary->>'remainingGross', '')::numeric, i.total_gross)
      ELSE i.total_gross
    END) INTO v_due
    FROM public.invoices i WHERE i.id = p_invoice_id;
  ELSIF p_ksef_invoice_id IS NOT NULL THEN
    SELECT ABS(COALESCE(ki.amount_to_pay_gross, ki.gross_amount, 0)) INTO v_due
    FROM public.ksef_invoices ki WHERE ki.id = p_ksef_invoice_id;
  ELSIF p_external_invoice_id IS NOT NULL THEN
    SELECT ABS(COALESCE(ei.amount_gross, 0)) INTO v_due
    FROM public.external_invoices ei WHERE ei.id = p_external_invoice_id;
  END IF;
  RETURN COALESCE(v_due, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_bank_transaction_match_state(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total numeric(15,2);
  v_allocated numeric(15,2);
  v_count integer;
  v_single_ksef uuid;
  v_confidence numeric(4,3);
  v_manual boolean;
BEGIN
  SELECT ABS(bt.amount) INTO v_total
  FROM public.bank_transactions bt WHERE bt.id = p_transaction_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM(m.amount), 0), COUNT(*),
         CASE WHEN COUNT(*) = 1 THEN (ARRAY_AGG(m.ksef_invoice_id))[1] END,
         MAX(m.confidence),
         COALESCE(BOOL_OR(m.match_method IN ('manual', 'legacy')), false)
  INTO v_allocated, v_count, v_single_ksef, v_confidence, v_manual
  FROM public.bank_transaction_invoice_matches m
  WHERE m.bank_transaction_id = p_transaction_id;

  UPDATE public.bank_transactions
  SET allocated_amount = ROUND(v_allocated, 2),
      matched_document_count = v_count,
      match_status = CASE
        WHEN v_allocated <= 0.009 THEN 'unmatched'
        WHEN v_allocated >= v_total - 0.01 THEN 'matched'
        ELSE 'partial'
      END,
      matched_invoice_id = v_single_ksef,
      match_confidence = v_confidence,
      manual_match = v_manual
  WHERE id = p_transaction_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_local_invoice_bank_payment(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bank numeric(14,2);
  v_latest date;
  v_manual numeric(14,2);
BEGIN
  SELECT COALESCE(SUM(m.amount), 0), MAX(bt.transaction_date)
  INTO v_bank, v_latest
  FROM public.bank_transaction_invoice_matches m
  JOIN public.bank_transactions bt ON bt.id = m.bank_transaction_id
  WHERE m.invoice_id = p_invoice_id;

  SELECT COALESCE(i.manual_paid_amount, 0) INTO v_manual
  FROM public.invoices i WHERE i.id = p_invoice_id;
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM set_config('app.bank_match_recalc', '1', true);
  UPDATE public.invoices
  SET paid_amount = ROUND(v_manual + v_bank, 2),
      paid_at = CASE
        WHEN v_manual + v_bank <= 0 THEN NULL
        WHEN v_latest IS NOT NULL THEN GREATEST(COALESCE(paid_at, v_latest::timestamptz), v_latest::timestamptz)
        ELSE paid_at
      END,
      paid_date = CASE
        WHEN v_manual + v_bank <= 0 THEN NULL
        WHEN v_latest IS NOT NULL THEN GREATEST(COALESCE(paid_date, v_latest), v_latest)
        ELSE paid_date
      END
  WHERE id = p_invoice_id;
  PERFORM set_config('app.bank_match_recalc', '0', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_external_invoice_bank_payment(p_external_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bank numeric(14,2);
  v_latest date;
  v_manual numeric(14,2);
  v_due numeric(14,2);
  v_total numeric(14,2);
BEGIN
  SELECT COALESCE(SUM(m.amount), 0), MAX(bt.transaction_date)
  INTO v_bank, v_latest
  FROM public.bank_transaction_invoice_matches m
  JOIN public.bank_transactions bt ON bt.id = m.bank_transaction_id
  WHERE m.external_invoice_id = p_external_invoice_id;

  SELECT COALESCE(ei.manual_paid_amount, 0), ABS(COALESCE(ei.amount_gross, 0))
  INTO v_manual, v_due
  FROM public.external_invoices ei WHERE ei.id = p_external_invoice_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_total := ROUND(v_manual + v_bank, 2);

  PERFORM set_config('app.bank_match_recalc', '1', true);
  UPDATE public.external_invoices
  SET paid_amount = v_total,
      payment_status = CASE
        WHEN payment_status = 'cancelled' THEN 'cancelled'
        WHEN v_total <= 0.009 THEN 'unpaid'
        WHEN v_due > 0 AND v_total >= v_due - 0.01 THEN 'paid'
        ELSE 'partially_paid'
      END,
      payment_date = CASE WHEN v_total <= 0.009 THEN NULL ELSE COALESCE(v_latest, payment_date, invoice_date) END,
      payment_amount_needs_review = false
  WHERE id = p_external_invoice_id;
  PERFORM set_config('app.bank_match_recalc', '0', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_invoice_manual_paid_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bank numeric(14,2);
  v_due numeric(14,2);
  v_requested numeric(14,2);
BEGIN
  IF current_setting('app.bank_match_recalc', true) = '1' THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_bank
  FROM public.bank_transaction_invoice_matches WHERE invoice_id = NEW.id;
  v_due := ABS(CASE
    WHEN NEW.invoice_type = 'final' AND NEW.settlement_summary IS NOT NULL
      THEN COALESCE(NULLIF(NEW.settlement_summary->>'remainingGross', '')::numeric, NEW.total_gross)
    ELSE NEW.total_gross
  END);
  v_requested := CASE
    WHEN NEW.status IN ('draft', 'cancelled', 'proforma') THEN 0
    WHEN NEW.status = 'paid' THEN v_due
    ELSE GREATEST(COALESCE(NEW.paid_amount, 0), 0)
  END;
  NEW.manual_paid_amount := GREATEST(v_requested - v_bank, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_invoice_manual_paid_amount ON public.invoices;
CREATE TRIGGER trg_capture_invoice_manual_paid_amount
BEFORE INSERT OR UPDATE OF paid_amount, status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.capture_invoice_manual_paid_amount();

CREATE OR REPLACE FUNCTION public.capture_external_invoice_manual_paid_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bank numeric(14,2);
  v_due numeric(14,2);
  v_requested numeric(14,2);
BEGIN
  IF current_setting('app.bank_match_recalc', true) = '1' THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_bank
  FROM public.bank_transaction_invoice_matches WHERE external_invoice_id = NEW.id;
  v_due := ABS(COALESCE(NEW.amount_gross, 0));
  v_requested := CASE
    WHEN NEW.payment_status IN ('unpaid', 'cancelled') THEN 0
    WHEN NEW.payment_status = 'paid' THEN v_due
    ELSE GREATEST(COALESCE(NEW.paid_amount, 0), 0)
  END;
  NEW.manual_paid_amount := GREATEST(v_requested - v_bank, 0);
  NEW.paid_amount := v_requested;
  NEW.payment_amount_needs_review := NEW.payment_status = 'partially_paid' AND v_requested <= 0;
  IF v_requested <= 0 THEN NEW.payment_date := NULL; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_external_invoice_manual_paid_amount ON public.external_invoices;
CREATE TRIGGER trg_capture_external_invoice_manual_paid_amount
BEFORE INSERT OR UPDATE OF paid_amount, payment_status, amount_gross ON public.external_invoices
FOR EACH ROW EXECUTE FUNCTION public.capture_external_invoice_manual_paid_amount();

CREATE OR REPLACE FUNCTION public.sync_bank_match_payment_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match public.bank_transaction_invoice_matches%ROWTYPE;
  v_payment_date date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_match := OLD;
    DELETE FROM public.ksef_invoice_payments WHERE bank_match_id = OLD.id;
  ELSE
    v_match := NEW;
    SELECT bt.transaction_date INTO v_payment_date
    FROM public.bank_transactions bt WHERE bt.id = NEW.bank_transaction_id;
    IF NEW.ksef_invoice_id IS NOT NULL THEN
      INSERT INTO public.ksef_invoice_payments (
        ksef_invoice_id, amount, payment_date, notes, created_by, bank_match_id, payment_source
      ) VALUES (
        NEW.ksef_invoice_id, NEW.amount, v_payment_date,
        'Dopasowanie z wyciagu bankowego', NEW.created_by, NEW.id, 'bank'
      )
      ON CONFLICT (bank_match_id) WHERE bank_match_id IS NOT NULL
      DO UPDATE SET amount = EXCLUDED.amount, payment_date = EXCLUDED.payment_date;
    END IF;
  END IF;

  IF v_match.invoice_id IS NOT NULL THEN
    PERFORM public.recalculate_local_invoice_bank_payment(v_match.invoice_id);
  ELSIF v_match.external_invoice_id IS NOT NULL THEN
    PERFORM public.recalculate_external_invoice_bank_payment(v_match.external_invoice_id);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.invoice_id IS DISTINCT FROM NEW.invoice_id AND OLD.invoice_id IS NOT NULL THEN
      PERFORM public.recalculate_local_invoice_bank_payment(OLD.invoice_id);
    END IF;
    IF OLD.external_invoice_id IS DISTINCT FROM NEW.external_invoice_id AND OLD.external_invoice_id IS NOT NULL THEN
      PERFORM public.recalculate_external_invoice_bank_payment(OLD.external_invoice_id);
    END IF;
  END IF;

  PERFORM public.recalculate_bank_transaction_match_state(v_match.bank_transaction_id);
  IF TG_OP = 'UPDATE' AND OLD.bank_transaction_id IS DISTINCT FROM NEW.bank_transaction_id THEN
    PERFORM public.recalculate_bank_transaction_match_state(OLD.bank_transaction_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_bank_match_payment_state ON public.bank_transaction_invoice_matches;
CREATE TRIGGER trg_sync_bank_match_payment_state
AFTER INSERT OR UPDATE OR DELETE ON public.bank_transaction_invoice_matches
FOR EACH ROW EXECUTE FUNCTION public.sync_bank_match_payment_state();

CREATE OR REPLACE FUNCTION public.touch_bank_match_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_touch_bank_match_updated_at ON public.bank_transaction_invoice_matches;
CREATE TRIGGER trg_touch_bank_match_updated_at
BEFORE UPDATE ON public.bank_transaction_invoice_matches
FOR EACH ROW EXECUTE FUNCTION public.touch_bank_match_updated_at();

CREATE OR REPLACE FUNCTION public.match_bank_transaction_to_document(
  p_transaction_id uuid,
  p_document_source text,
  p_document_id uuid,
  p_amount numeric DEFAULT NULL,
  p_confidence numeric DEFAULT NULL,
  p_match_method text DEFAULT 'manual',
  p_match_reasons text[] DEFAULT ARRAY[]::text[]
)
RETURNS public.bank_transaction_invoice_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bt public.bank_transactions%ROWTYPE;
  v_company_id uuid;
  v_available numeric(14,2);
  v_due numeric(14,2);
  v_paid numeric(14,2);
  v_outstanding numeric(14,2);
  v_allocate numeric(14,2);
  v_target_company uuid;
  v_target_currency text;
  v_expected_direction text;
  v_document_active boolean := true;
  v_raw_amount numeric(14,2);
  v_existing_match_id uuid;
  v_result public.bank_transaction_invoice_matches%ROWTYPE;
BEGIN
  IF p_document_source NOT IN ('invoice', 'ksef', 'external') THEN
    RAISE EXCEPTION 'Nieobslugiwane zrodlo dokumentu';
  END IF;
  IF p_match_method NOT IN ('automatic', 'manual', 'legacy') THEN
    RAISE EXCEPTION 'Nieobslugiwany sposob dopasowania';
  END IF;
  IF p_match_method = 'automatic' AND COALESCE(p_confidence, 0) < 0.90 THEN
    RAISE EXCEPTION 'Automatyczne dopasowanie ma zbyt niska pewnosc';
  END IF;

  SELECT bt.*
  INTO v_bt
  FROM public.bank_transactions bt
  WHERE bt.id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono transakcji'; END IF;

  SELECT bs.my_company_id INTO v_company_id
  FROM public.bank_statements bs WHERE bs.id = v_bt.statement_id;

  IF auth.role() <> 'service_role' AND NOT (
    public.finance_can_manage() AND public.finance_company_visible(v_company_id)
  ) THEN
    RAISE EXCEPTION 'Brak uprawnien do dopasowania platnosci' USING ERRCODE = '42501';
  END IF;

  SELECT ABS(v_bt.amount) - COALESCE(SUM(m.amount), 0)
  INTO v_available
  FROM public.bank_transaction_invoice_matches m
  WHERE m.bank_transaction_id = p_transaction_id;
  v_available := ROUND(COALESCE(v_available, ABS(v_bt.amount)), 2);
  IF v_available <= 0.009 THEN RAISE EXCEPTION 'Transakcja jest juz w calosci rozliczona'; END IF;

  IF p_document_source = 'invoice' THEN
    SELECT i.my_company_id, UPPER(COALESCE(i.currency_code, 'PLN')), i.total_gross,
           CASE WHEN i.invoice_type = 'corrective' AND i.total_gross < 0 THEN 'debit' ELSE 'credit' END,
           i.status NOT IN ('draft', 'cancelled', 'proforma') AND i.invoice_type <> 'proforma',
           COALESCE(i.paid_amount, 0)
    INTO v_target_company, v_target_currency, v_raw_amount, v_expected_direction, v_document_active, v_paid
    FROM public.invoices i WHERE i.id = p_document_id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM public.ksef_invoices ki
      WHERE ki.invoice_id = p_document_id AND NULLIF(ki.ksef_reference_number, '') IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Dokument ma reprezentacje KSeF; wybierz dokument KSeF';
    END IF;
    v_due := public.bank_document_due_amount(p_document_id, NULL, NULL);
  ELSIF p_document_source = 'ksef' THEN
    SELECT ki.my_company_id, UPPER(COALESCE(ki.currency, 'PLN')),
           COALESCE(ki.amount_to_pay_gross, ki.gross_amount, 0),
           CASE
             WHEN ki.invoice_type::text = 'issued' AND COALESCE(ki.amount_to_pay_gross, ki.gross_amount, 0) >= 0 THEN 'credit'
             WHEN ki.invoice_type::text = 'issued' THEN 'debit'
             WHEN COALESCE(ki.amount_to_pay_gross, ki.gross_amount, 0) >= 0 THEN 'debit'
             ELSE 'credit'
           END,
           ki.sync_status::text <> 'error'
             AND NOT (
               ki.payment_status = 'partially_paid'
               AND COALESCE((SELECT SUM(kp.amount) FROM public.ksef_invoice_payments kp WHERE kp.ksef_invoice_id = ki.id), 0) <= 0
             ),
           CASE
             WHEN ki.payment_status = 'paid' THEN ABS(COALESCE(ki.amount_to_pay_gross, ki.gross_amount, 0))
             ELSE COALESCE((SELECT SUM(kp.amount) FROM public.ksef_invoice_payments kp WHERE kp.ksef_invoice_id = ki.id), 0)
           END
    INTO v_target_company, v_target_currency, v_raw_amount, v_expected_direction, v_document_active, v_paid
    FROM public.ksef_invoices ki WHERE ki.id = p_document_id FOR UPDATE;
    v_due := public.bank_document_due_amount(NULL, p_document_id, NULL);
  ELSE
    SELECT ei.my_company_id, UPPER(COALESCE(ei.currency, 'PLN')), COALESCE(ei.amount_gross, 0),
           CASE WHEN COALESCE(ei.amount_gross, 0) >= 0 THEN 'debit' ELSE 'credit' END,
           ei.payment_status <> 'cancelled' AND NOT ei.payment_amount_needs_review,
           COALESCE(ei.paid_amount, 0)
    INTO v_target_company, v_target_currency, v_raw_amount, v_expected_direction, v_document_active, v_paid
    FROM public.external_invoices ei WHERE ei.id = p_document_id FOR UPDATE;
    v_due := public.bank_document_due_amount(NULL, NULL, p_document_id);
  END IF;

  IF v_target_company IS NULL THEN RAISE EXCEPTION 'Dokument nie ma przypisanej dzialalnosci'; END IF;
  IF v_target_company IS DISTINCT FROM v_company_id THEN RAISE EXCEPTION 'Transakcja i dokument naleza do roznych dzialalnosci'; END IF;
  IF NOT v_document_active THEN RAISE EXCEPTION 'Dokument nie moze zostac rozliczony'; END IF;
  IF UPPER(COALESCE(v_bt.currency, 'PLN')) <> v_target_currency THEN RAISE EXCEPTION 'Waluta transakcji i dokumentu jest rozna'; END IF;
  IF v_bt.transaction_type <> v_expected_direction THEN RAISE EXCEPTION 'Kierunek transakcji nie odpowiada rodzajowi dokumentu'; END IF;
  IF v_due <= 0.009 THEN RAISE EXCEPTION 'Dokument nie ma kwoty do rozliczenia'; END IF;

  v_outstanding := ROUND(GREATEST(v_due - COALESCE(v_paid, 0), 0), 2);
  IF v_outstanding <= 0.009 THEN RAISE EXCEPTION 'Dokument jest juz rozliczony'; END IF;
  v_allocate := ROUND(COALESCE(p_amount, LEAST(v_available, v_outstanding)), 2);
  IF v_allocate <= 0 THEN RAISE EXCEPTION 'Kwota alokacji musi byc dodatnia'; END IF;
  IF v_allocate > v_available + 0.01 THEN RAISE EXCEPTION 'Kwota przekracza pozostala wartosc transakcji'; END IF;
  IF v_allocate > v_outstanding + 0.01 THEN RAISE EXCEPTION 'Kwota przekracza saldo dokumentu'; END IF;

  SELECT m.id INTO v_existing_match_id
  FROM public.bank_transaction_invoice_matches m
  WHERE m.bank_transaction_id = p_transaction_id
    AND (
      (p_document_source = 'invoice' AND m.invoice_id = p_document_id)
      OR (p_document_source = 'ksef' AND m.ksef_invoice_id = p_document_id)
      OR (p_document_source = 'external' AND m.external_invoice_id = p_document_id)
    )
  FOR UPDATE;

  IF v_existing_match_id IS NOT NULL THEN
    UPDATE public.bank_transaction_invoice_matches
    SET amount = amount + v_allocate,
        confidence = GREATEST(confidence, p_confidence),
        match_method = CASE WHEN p_match_method = 'manual' THEN 'manual' ELSE match_method END,
        match_reasons = match_reasons || COALESCE(p_match_reasons, ARRAY[]::text[])
    WHERE id = v_existing_match_id
    RETURNING * INTO v_result;
    RETURN v_result;
  END IF;

  INSERT INTO public.bank_transaction_invoice_matches (
    bank_transaction_id, document_source, invoice_id, ksef_invoice_id, external_invoice_id,
    amount, currency, confidence, match_method, match_reasons, created_by
  ) VALUES (
    p_transaction_id, p_document_source,
    CASE WHEN p_document_source = 'invoice' THEN p_document_id END,
    CASE WHEN p_document_source = 'ksef' THEN p_document_id END,
    CASE WHEN p_document_source = 'external' THEN p_document_id END,
    v_allocate, v_target_currency, p_confidence, p_match_method,
    COALESCE(p_match_reasons, ARRAY[]::text[]), public.current_invoice_employee_id()
  ) RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

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
  v_deleted integer;
BEGIN
  SELECT bs.my_company_id INTO v_company_id
  FROM public.bank_transactions bt
  JOIN public.bank_statements bs ON bs.id = bt.statement_id
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
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_bank_match_candidates(p_transaction_id uuid)
RETURNS TABLE (
  document_source text,
  document_id uuid,
  document_number text,
  ksef_reference_number text,
  gross_amount numeric,
  outstanding_amount numeric,
  issue_date date,
  due_date date,
  counterparty_name text,
  counterparty_nip text,
  currency text,
  expected_direction text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_currency text;
  v_direction text;
BEGIN
  SELECT bs.my_company_id, UPPER(COALESCE(bt.currency, 'PLN')), bt.transaction_type
  INTO v_company_id, v_currency, v_direction
  FROM public.bank_transactions bt
  JOIN public.bank_statements bs ON bs.id = bt.statement_id
  WHERE bt.id = p_transaction_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF auth.role() <> 'service_role' AND NOT (
    public.finance_can_view() AND public.finance_company_visible(v_company_id)
  ) THEN RETURN; END IF;

  RETURN QUERY
  WITH documents AS (
    SELECT
      'invoice'::text AS source,
      i.id,
      i.invoice_number,
      NULL::text AS ksef_number,
      public.bank_document_due_amount(i.id, NULL, NULL) AS gross,
      GREATEST(public.bank_document_due_amount(i.id, NULL, NULL) - COALESCE(i.paid_amount, 0), 0) AS outstanding,
      i.issue_date,
      i.payment_due_date,
      i.buyer_name,
      i.buyer_nip,
      UPPER(COALESCE(i.currency_code, 'PLN')) AS doc_currency,
      CASE WHEN i.invoice_type = 'corrective' AND i.total_gross < 0 THEN 'debit' ELSE 'credit' END AS direction
    FROM public.invoices i
    WHERE i.my_company_id = v_company_id
      AND i.status NOT IN ('draft', 'cancelled', 'proforma')
      AND i.invoice_type <> 'proforma'
      AND NOT EXISTS (
        SELECT 1 FROM public.ksef_invoices ki
        WHERE ki.invoice_id = i.id AND NULLIF(ki.ksef_reference_number, '') IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.bank_transaction_invoice_matches m
        WHERE m.bank_transaction_id = p_transaction_id AND m.invoice_id = i.id
      )

    UNION ALL

    SELECT
      'ksef'::text,
      ki.id,
      COALESCE(ki.invoice_number, ki.ksef_reference_number),
      ki.ksef_reference_number,
      public.bank_document_due_amount(NULL, ki.id, NULL),
      GREATEST(
        public.bank_document_due_amount(NULL, ki.id, NULL)
        - COALESCE((SELECT SUM(kp.amount) FROM public.ksef_invoice_payments kp WHERE kp.ksef_invoice_id = ki.id), 0),
        0
      ),
      ki.issue_date,
      ki.payment_due_date,
      CASE WHEN ki.invoice_type::text = 'issued' THEN ki.buyer_name ELSE ki.seller_name END,
      CASE WHEN ki.invoice_type::text = 'issued' THEN ki.buyer_nip ELSE ki.seller_nip END,
      UPPER(COALESCE(ki.currency, 'PLN')),
      CASE
        WHEN ki.invoice_type::text = 'issued' AND COALESCE(ki.amount_to_pay_gross, ki.gross_amount, 0) >= 0 THEN 'credit'
        WHEN ki.invoice_type::text = 'issued' THEN 'debit'
        WHEN COALESCE(ki.amount_to_pay_gross, ki.gross_amount, 0) >= 0 THEN 'debit'
        ELSE 'credit'
      END
    FROM public.ksef_invoices ki
    WHERE ki.my_company_id = v_company_id
      AND ki.sync_status::text <> 'error'
      AND ki.payment_status <> 'paid'
      AND NOT (
        ki.payment_status = 'partially_paid'
        AND COALESCE((SELECT SUM(kp.amount) FROM public.ksef_invoice_payments kp WHERE kp.ksef_invoice_id = ki.id), 0) <= 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.bank_transaction_invoice_matches m
        WHERE m.bank_transaction_id = p_transaction_id AND m.ksef_invoice_id = ki.id
      )

    UNION ALL

    SELECT
      'external'::text,
      ei.id,
      ei.invoice_number,
      NULL::text,
      public.bank_document_due_amount(NULL, NULL, ei.id),
      GREATEST(public.bank_document_due_amount(NULL, NULL, ei.id) - COALESCE(ei.paid_amount, 0), 0),
      ei.invoice_date,
      NULL::date,
      ei.seller_name,
      ei.seller_nip,
      UPPER(COALESCE(ei.currency, 'PLN')),
      CASE WHEN COALESCE(ei.amount_gross, 0) >= 0 THEN 'debit' ELSE 'credit' END
    FROM public.external_invoices ei
    WHERE ei.my_company_id = v_company_id
      AND ei.payment_status <> 'cancelled'
      AND NOT ei.payment_amount_needs_review
      AND NOT EXISTS (
        SELECT 1 FROM public.bank_transaction_invoice_matches m
        WHERE m.bank_transaction_id = p_transaction_id AND m.external_invoice_id = ei.id
      )
  )
  SELECT d.source, d.id, d.invoice_number, d.ksef_number, d.gross, d.outstanding,
         d.issue_date, d.payment_due_date, d.buyer_name, d.buyer_nip,
         d.doc_currency, d.direction
  FROM documents d
  WHERE d.outstanding > 0.009
    AND d.doc_currency = v_currency
    AND d.direction = v_direction
  ORDER BY d.issue_date DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.match_bank_transaction_to_document(uuid,text,uuid,numeric,numeric,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_bank_transaction_to_document(uuid,text,uuid,numeric,numeric,text,text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.unmatch_bank_transaction(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unmatch_bank_transaction(uuid,uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_bank_match_candidates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_bank_match_candidates(uuid) TO authenticated, service_role;

-- Migracja starych wskazan. Niepewne automatyczne sugestie nie sa uznawane za
-- dowod zaplaty; pozostaja w tabeli audytowej do recznego zatwierdzenia.
INSERT INTO public.legacy_bank_transaction_match_audit (
  bank_transaction_id, ksef_invoice_id, confidence, manual_match, migrated_as_payment, audit_reason
)
SELECT bt.id, bt.matched_invoice_id, bt.match_confidence, COALESCE(bt.manual_match, false), false,
       CASE
         WHEN COALESCE(bt.manual_match, false) THEN 'legacy_manual_match_pending_migration'
         WHEN COALESCE(bt.match_confidence, 0) >= 0.95 THEN 'legacy_high_confidence_match_pending_migration'
         ELSE 'legacy_suggestion_not_a_payment'
       END
FROM public.bank_transactions bt
WHERE bt.matched_invoice_id IS NOT NULL
ON CONFLICT (bank_transaction_id) DO NOTHING;

DO $$
DECLARE
  r record;
  v_due numeric(14,2);
  v_paid numeric(14,2);
  v_amount numeric(14,2);
  v_expected_direction text;
BEGIN
  FOR r IN
    SELECT bt.id AS transaction_id, bt.amount, bt.currency, bt.transaction_type,
           bt.match_confidence, bt.manual_match, bt.transaction_date,
           ki.id AS invoice_id, ki.invoice_type::text AS invoice_type,
           ki.currency AS invoice_currency, ki.amount_to_pay_gross, ki.gross_amount,
           bs.my_company_id AS statement_company, ki.my_company_id AS invoice_company
    FROM public.bank_transactions bt
    JOIN public.bank_statements bs ON bs.id = bt.statement_id
    JOIN public.ksef_invoices ki ON ki.id = bt.matched_invoice_id
    WHERE COALESCE(bt.manual_match, false) OR COALESCE(bt.match_confidence, 0) >= 0.95
    ORDER BY COALESCE(bt.manual_match, false) DESC, bt.match_confidence DESC NULLS LAST, bt.transaction_date, bt.id
  LOOP
    v_expected_direction := CASE
      WHEN r.invoice_type = 'issued'
        AND COALESCE(r.amount_to_pay_gross, r.gross_amount, 0) >= 0 THEN 'credit'
      WHEN r.invoice_type = 'issued' THEN 'debit'
      WHEN COALESCE(r.amount_to_pay_gross, r.gross_amount, 0) >= 0 THEN 'debit'
      ELSE 'credit'
    END;

    IF r.statement_company IS DISTINCT FROM r.invoice_company
       OR UPPER(COALESCE(r.currency, 'PLN')) <> UPPER(COALESCE(r.invoice_currency, 'PLN'))
       OR r.transaction_type <> v_expected_direction
    THEN
      UPDATE public.legacy_bank_transaction_match_audit
      SET audit_reason = 'legacy_match_rejected_by_company_currency_or_direction'
      WHERE bank_transaction_id = r.transaction_id;
      CONTINUE;
    END IF;

    v_due := public.bank_document_due_amount(NULL, r.invoice_id, NULL);
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.ksef_invoice_payments WHERE ksef_invoice_id = r.invoice_id;
    v_amount := ROUND(LEAST(ABS(r.amount), GREATEST(v_due - v_paid, 0)), 2);
    IF v_amount <= 0.009 THEN
      UPDATE public.legacy_bank_transaction_match_audit
      SET audit_reason = 'legacy_match_document_already_paid'
      WHERE bank_transaction_id = r.transaction_id;
      CONTINUE;
    END IF;

    INSERT INTO public.bank_transaction_invoice_matches (
      bank_transaction_id, document_source, ksef_invoice_id, amount, currency,
      confidence, match_method, match_reasons
    ) VALUES (
      r.transaction_id, 'ksef', r.invoice_id, v_amount, UPPER(COALESCE(r.currency, 'PLN')),
      r.match_confidence, 'legacy', ARRAY['Migracja zatwierdzonego starego dopasowania']
    ) ON CONFLICT DO NOTHING;

    UPDATE public.legacy_bank_transaction_match_audit
    SET migrated_as_payment = true, audit_reason = 'legacy_match_migrated_to_payment_ledger'
    WHERE bank_transaction_id = r.transaction_id;
  END LOOP;
END;
$$;

INSERT INTO public.financial_payment_review_issues (
  document_source, document_id, my_company_id, issue_code, details
)
SELECT 'ksef', ki.id, ki.my_company_id, 'payment_status_without_ledger',
       jsonb_build_object(
         'payment_status', ki.payment_status,
         'payment_date', ki.payment_date,
         'gross_amount', ki.gross_amount,
         'amount_to_pay_gross', ki.amount_to_pay_gross
       )
FROM public.ksef_invoices ki
WHERE ki.payment_status IN ('paid', 'partially_paid')
  AND NOT EXISTS (
    SELECT 1 FROM public.ksef_invoice_payments kp WHERE kp.ksef_invoice_id = ki.id
  )
ON CONFLICT (document_source, document_id, issue_code) DO NOTHING;

-- Pola kompatybilnosci sa odtwarzane wylacznie z kanonicznych alokacji.
UPDATE public.bank_transactions
SET matched_invoice_id = NULL,
    match_confidence = NULL,
    manual_match = false,
    allocated_amount = 0,
    matched_document_count = 0,
    match_status = 'unmatched';

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT bank_transaction_id FROM public.bank_transaction_invoice_matches LOOP
    PERFORM public.recalculate_bank_transaction_match_state(r.bank_transaction_id);
  END LOOP;
END;
$$;

COMMENT ON TABLE public.bank_transaction_invoice_matches IS
  'Kanoniczny rejestr alokacji transakcji bankowych do faktur CRM, KSeF i faktur zewnetrznych.';
COMMENT ON COLUMN public.bank_transactions.matched_invoice_id IS
  'Pole kompatybilnosci: wypelnione tylko dla pojedynczego dopasowania KSeF. Zrodlem prawdy jest bank_transaction_invoice_matches.';
COMMENT ON COLUMN public.external_invoices.payment_amount_needs_review IS
  'Dawny status czesciowej platnosci bez zapisanej kwoty wymaga uzupelnienia przed automatycznym dopasowaniem.';

COMMIT;
