/*
  # Dokumenty spoza KSeF opłacone po przewalutowaniu

  Kwota alokowana z wyciągu pozostaje w walucie rachunku, natomiast
  document_amount zapisuje wartość rozliczoną w walucie faktury.
*/

ALTER TABLE public.bank_transaction_invoice_matches
  ADD COLUMN IF NOT EXISTS document_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS document_currency text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,8);

-- Backfill nie może ponownie materializować istniejących płatności KSeF.
-- Wartości są tylko kopią dotychczasowej kwoty i waluty dopasowania.
ALTER TABLE public.bank_transaction_invoice_matches
  DISABLE TRIGGER trg_sync_bank_match_payment_state;

UPDATE public.bank_transaction_invoice_matches
SET document_amount = COALESCE(document_amount, amount),
    document_currency = COALESCE(document_currency, currency),
    exchange_rate = COALESCE(exchange_rate, 1)
WHERE document_amount IS NULL OR document_currency IS NULL OR exchange_rate IS NULL;

ALTER TABLE public.bank_transaction_invoice_matches
  ENABLE TRIGGER trg_sync_bank_match_payment_state;

ALTER TABLE public.bank_transaction_invoice_matches
  DROP CONSTRAINT IF EXISTS bank_match_document_amount_check;
ALTER TABLE public.bank_transaction_invoice_matches
  ADD CONSTRAINT bank_match_document_amount_check
  CHECK (document_amount IS NULL OR document_amount > 0);

ALTER TABLE public.bank_transaction_invoice_matches
  DROP CONSTRAINT IF EXISTS bank_match_document_currency_check;
ALTER TABLE public.bank_transaction_invoice_matches
  ADD CONSTRAINT bank_match_document_currency_check
  CHECK (document_currency IS NULL OR document_currency ~ '^[A-Z]{3}$');

ALTER TABLE public.bank_transaction_invoice_matches
  DROP CONSTRAINT IF EXISTS bank_match_exchange_rate_check;
ALTER TABLE public.bank_transaction_invoice_matches
  ADD CONSTRAINT bank_match_exchange_rate_check
  CHECK (exchange_rate IS NULL OR exchange_rate > 0);

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
  SELECT COALESCE(SUM(COALESCE(m.document_amount, m.amount)), 0), MAX(bt.transaction_date)
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
  SELECT COALESCE(SUM(COALESCE(document_amount, amount)), 0) INTO v_bank
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

CREATE OR REPLACE FUNCTION public.reconcile_external_invoice_with_bank_transaction(
  p_transaction_id uuid,
  p_external_invoice_id uuid,
  p_transaction_amount numeric,
  p_document_amount numeric,
  p_confidence numeric DEFAULT NULL,
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
  v_invoice_company uuid;
  v_invoice_currency text;
  v_invoice_status text;
  v_due numeric(14,2);
  v_available numeric(14,2);
  v_existing_document_amount numeric(14,2);
  v_document_available numeric(14,2);
  v_transaction_allocate numeric(14,2);
  v_document_allocate numeric(14,2);
  v_existing_match_id uuid;
  v_result public.bank_transaction_invoice_matches%ROWTYPE;
BEGIN
  SELECT bt.* INTO v_bt
  FROM public.bank_transactions bt
  WHERE bt.id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono transakcji'; END IF;

  SELECT bs.my_company_id INTO v_company_id
  FROM public.bank_statements bs WHERE bs.id = v_bt.statement_id;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Wyciag nie ma przypisanej dzialalnosci'; END IF;

  IF auth.role() <> 'service_role' AND NOT (
    public.finance_can_manage() AND public.finance_company_visible(v_company_id)
  ) THEN
    RAISE EXCEPTION 'Brak uprawnien do dopasowania platnosci' USING ERRCODE = '42501';
  END IF;

  SELECT ei.my_company_id, UPPER(COALESCE(ei.currency, 'PLN')), ei.payment_status,
         ABS(COALESCE(ei.amount_gross, 0))
  INTO v_invoice_company, v_invoice_currency, v_invoice_status, v_due
  FROM public.external_invoices ei
  WHERE ei.id = p_external_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono dokumentu spoza KSeF'; END IF;
  IF v_invoice_status = 'cancelled' THEN RAISE EXCEPTION 'Dokument nie moze zostac rozliczony'; END IF;
  IF v_invoice_company IS NOT NULL AND v_invoice_company IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION 'Transakcja i dokument naleza do roznych dzialalnosci';
  END IF;
  IF v_bt.transaction_type <> 'debit' THEN
    RAISE EXCEPTION 'Dokument kosztowy wymaga transakcji wychodzacej';
  END IF;
  IF v_due <= 0.009 THEN RAISE EXCEPTION 'Dokument nie ma kwoty do rozliczenia'; END IF;

  SELECT ROUND(ABS(v_bt.amount) - COALESCE(SUM(m.amount), 0), 2)
  INTO v_available
  FROM public.bank_transaction_invoice_matches m
  WHERE m.bank_transaction_id = p_transaction_id;
  v_available := COALESCE(v_available, ROUND(ABS(v_bt.amount), 2));

  SELECT COALESCE(SUM(COALESCE(m.document_amount, m.amount)), 0)
  INTO v_existing_document_amount
  FROM public.bank_transaction_invoice_matches m
  WHERE m.external_invoice_id = p_external_invoice_id;
  v_document_available := ROUND(GREATEST(v_due - v_existing_document_amount, 0), 2);

  v_transaction_allocate := ROUND(COALESCE(p_transaction_amount, 0), 2);
  v_document_allocate := ROUND(COALESCE(p_document_amount, 0), 2);
  IF v_transaction_allocate <= 0 OR v_transaction_allocate > v_available + 0.01 THEN
    RAISE EXCEPTION 'Nieprawidlowa kwota alokacji transakcji';
  END IF;
  IF v_document_allocate <= 0 OR v_document_allocate > v_document_available + 0.01 THEN
    RAISE EXCEPTION 'Nieprawidlowa kwota rozliczenia dokumentu';
  END IF;

  IF v_invoice_company IS NULL THEN
    UPDATE public.external_invoices
    SET my_company_id = v_company_id
    WHERE id = p_external_invoice_id;
  END IF;

  UPDATE public.external_invoices
  SET manual_paid_amount = GREATEST(COALESCE(manual_paid_amount, 0) - v_document_allocate, 0)
  WHERE id = p_external_invoice_id;

  SELECT m.id INTO v_existing_match_id
  FROM public.bank_transaction_invoice_matches m
  WHERE m.bank_transaction_id = p_transaction_id
    AND m.external_invoice_id = p_external_invoice_id
  FOR UPDATE;

  IF v_existing_match_id IS NULL THEN
    INSERT INTO public.bank_transaction_invoice_matches (
      bank_transaction_id, document_source, external_invoice_id,
      amount, currency, document_amount, document_currency, exchange_rate,
      confidence, match_method, match_reasons, created_by
    ) VALUES (
      p_transaction_id, 'external', p_external_invoice_id,
      v_transaction_allocate, UPPER(COALESCE(v_bt.currency, 'PLN')),
      v_document_allocate, v_invoice_currency,
      ROUND(v_transaction_allocate / v_document_allocate, 8),
      p_confidence, 'manual',
      COALESCE(p_match_reasons, ARRAY[]::text[]) || ARRAY['Zapisano kwote rachunku i kwote dokumentu'],
      public.current_invoice_employee_id()
    ) RETURNING * INTO v_result;
  ELSE
    UPDATE public.bank_transaction_invoice_matches
    SET amount = amount + v_transaction_allocate,
        document_amount = COALESCE(document_amount, amount) + v_document_allocate,
        currency = UPPER(COALESCE(v_bt.currency, 'PLN')),
        document_currency = v_invoice_currency,
        exchange_rate = ROUND((amount + v_transaction_allocate)
          / (COALESCE(document_amount, amount) + v_document_allocate), 8),
        confidence = GREATEST(confidence, p_confidence),
        match_method = 'manual',
        match_reasons = match_reasons || COALESCE(p_match_reasons, ARRAY[]::text[])
    WHERE id = v_existing_match_id
    RETURNING * INTO v_result;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_external_invoice_with_bank_transaction(uuid, uuid, numeric, numeric, numeric, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_external_invoice_with_bank_transaction(uuid, uuid, numeric, numeric, numeric, text[])
TO authenticated, service_role;

COMMENT ON FUNCTION public.reconcile_external_invoice_with_bank_transaction(uuid, uuid, numeric, numeric, numeric, text[])
IS 'Dopasowuje dokument spoza KSeF do transakcji, zachowujac osobno kwote rachunku i kwote dokumentu po przewalutowaniu.';
