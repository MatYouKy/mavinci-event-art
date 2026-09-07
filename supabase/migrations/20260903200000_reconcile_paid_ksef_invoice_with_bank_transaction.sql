/*
  # Zamiana recznego oznaczenia platnosci KSeF na powiazanie bankowe

  Faktura oznaczona wczesniej jako oplacona nie trafia do standardowej listy
  kandydatow. Ta funkcja pozwala uzytkownikowi swiadomie zastapic odpowiadajaca
  czesc platnosci recznej powiazaniem z konkretna transakcja bankowa, bez
  podwojnego naliczenia zaplaty.
*/

CREATE OR REPLACE FUNCTION public.reconcile_paid_ksef_invoice_with_bank_transaction(
  p_transaction_id uuid,
  p_ksef_invoice_id uuid,
  p_amount numeric DEFAULT NULL,
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
  v_invoice_type text;
  v_invoice_sync_status text;
  v_invoice_payment_status text;
  v_invoice_payment_date date;
  v_due numeric(14,2);
  v_available numeric(14,2);
  v_existing_bank numeric(14,2);
  v_ledger_total numeric(14,2);
  v_manual_total numeric(14,2);
  v_missing_legacy_payment numeric(14,2);
  v_allocate numeric(14,2);
  v_remaining numeric(14,2);
  v_expected_direction text;
  v_payment record;
  v_result public.bank_transaction_invoice_matches%ROWTYPE;
BEGIN
  SELECT bt.*
  INTO v_bt
  FROM public.bank_transactions bt
  WHERE bt.id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono transakcji'; END IF;

  SELECT bs.my_company_id
  INTO v_company_id
  FROM public.bank_statements bs
  WHERE bs.id = v_bt.statement_id;

  IF auth.role() <> 'service_role' AND NOT (
    public.finance_can_manage() AND public.finance_company_visible(v_company_id)
  ) THEN
    RAISE EXCEPTION 'Brak uprawnien do dopasowania platnosci' USING ERRCODE = '42501';
  END IF;

  SELECT
    ki.my_company_id,
    UPPER(COALESCE(ki.currency, 'PLN')),
    ki.invoice_type::text,
    ki.sync_status::text,
    ki.payment_status,
    ki.payment_date,
    public.bank_document_due_amount(NULL, ki.id, NULL)
  INTO
    v_invoice_company,
    v_invoice_currency,
    v_invoice_type,
    v_invoice_sync_status,
    v_invoice_payment_status,
    v_invoice_payment_date,
    v_due
  FROM public.ksef_invoices ki
  WHERE ki.id = p_ksef_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono dokumentu KSeF'; END IF;

  IF v_invoice_company IS NULL THEN RAISE EXCEPTION 'Dokument nie ma przypisanej dzialalnosci'; END IF;
  IF v_invoice_company IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION 'Transakcja i dokument naleza do roznych dzialalnosci';
  END IF;
  IF v_invoice_sync_status = 'error' THEN RAISE EXCEPTION 'Dokument KSeF ma blad synchronizacji'; END IF;
  IF UPPER(COALESCE(v_bt.currency, 'PLN')) <> v_invoice_currency THEN
    RAISE EXCEPTION 'Waluta transakcji i dokumentu jest rozna';
  END IF;

  v_expected_direction := CASE
    WHEN v_invoice_type = 'issued' AND v_due >= 0 THEN 'credit'
    WHEN v_invoice_type = 'issued' THEN 'debit'
    WHEN v_due >= 0 THEN 'debit'
    ELSE 'credit'
  END;
  IF v_bt.transaction_type <> v_expected_direction THEN
    RAISE EXCEPTION 'Kierunek transakcji nie odpowiada rodzajowi dokumentu';
  END IF;
  v_due := ABS(COALESCE(v_due, 0));
  IF v_due <= 0.009 THEN RAISE EXCEPTION 'Dokument nie ma kwoty do rozliczenia'; END IF;

  SELECT ROUND(ABS(v_bt.amount) - COALESCE(SUM(m.amount), 0), 2)
  INTO v_available
  FROM public.bank_transaction_invoice_matches m
  WHERE m.bank_transaction_id = p_transaction_id;
  v_available := COALESCE(v_available, ROUND(ABS(v_bt.amount), 2));
  IF v_available <= 0.009 THEN RAISE EXCEPTION 'Transakcja jest juz w calosci rozliczona'; END IF;

  SELECT COALESCE(SUM(m.amount), 0)
  INTO v_existing_bank
  FROM public.bank_transaction_invoice_matches m
  WHERE m.ksef_invoice_id = p_ksef_invoice_id;

  SELECT COALESCE(SUM(kp.amount), 0)
  INTO v_ledger_total
  FROM public.ksef_invoice_payments kp
  WHERE kp.ksef_invoice_id = p_ksef_invoice_id;

  -- Starsze rekordy mogly miec sam status "paid", bez pozycji w historii wplat.
  -- Materializujemy brakujaca czesc jako platnosc reczna, aby jej zamiana na
  -- powiazanie bankowe zachowala laczna zaplacona kwote.
  IF v_invoice_payment_status = 'paid' AND v_ledger_total < v_due - 0.01 THEN
    v_missing_legacy_payment := ROUND(v_due - v_ledger_total, 2);
    INSERT INTO public.ksef_invoice_payments (
      ksef_invoice_id,
      amount,
      payment_date,
      notes,
      created_by,
      payment_source
    ) VALUES (
      p_ksef_invoice_id,
      v_missing_legacy_payment,
      COALESCE(v_invoice_payment_date, v_bt.transaction_date),
      'Zachowane historyczne oznaczenie platnosci przed powiazaniem z wyciagiem',
      public.current_invoice_employee_id(),
      'manual'
    );
  END IF;

  SELECT COALESCE(SUM(kp.amount), 0)
  INTO v_manual_total
  FROM public.ksef_invoice_payments kp
  WHERE kp.ksef_invoice_id = p_ksef_invoice_id
    AND COALESCE(kp.payment_source, 'manual') = 'manual'
    AND kp.bank_match_id IS NULL;

  v_allocate := ROUND(COALESCE(p_amount, LEAST(v_available, v_manual_total)), 2);
  IF v_allocate <= 0 THEN
    RAISE EXCEPTION 'Dokument nie ma platnosci recznej, ktora mozna zastapic powiazaniem bankowym';
  END IF;
  IF v_allocate > v_available + 0.01 THEN
    RAISE EXCEPTION 'Kwota przekracza pozostala wartosc transakcji';
  END IF;
  IF v_allocate > v_manual_total + 0.01 THEN
    RAISE EXCEPTION 'Kwota przekracza czesc dokumentu oznaczona recznie jako zaplacona';
  END IF;
  IF v_existing_bank + v_allocate > v_due + 0.01 THEN
    RAISE EXCEPTION 'Kwota przekracza saldo dokumentu dostepne do powiazania bankowego';
  END IF;

  v_remaining := v_allocate;
  FOR v_payment IN
    SELECT kp.id, kp.amount
    FROM public.ksef_invoice_payments kp
    WHERE kp.ksef_invoice_id = p_ksef_invoice_id
      AND COALESCE(kp.payment_source, 'manual') = 'manual'
      AND kp.bank_match_id IS NULL
    ORDER BY kp.payment_date DESC, kp.created_at DESC, kp.id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0.009;
    IF v_payment.amount <= v_remaining + 0.009 THEN
      DELETE FROM public.ksef_invoice_payments WHERE id = v_payment.id;
      v_remaining := ROUND(GREATEST(v_remaining - v_payment.amount, 0), 2);
    ELSE
      UPDATE public.ksef_invoice_payments
      SET amount = ROUND(amount - v_remaining, 2),
          notes = CONCAT_WS(' | ', NULLIF(notes, ''), 'Czesc zastapiona powiazaniem bankowym')
      WHERE id = v_payment.id;
      v_remaining := 0;
    END IF;
  END LOOP;

  IF v_remaining > 0.009 THEN
    RAISE EXCEPTION 'Nie udalo sie przygotowac platnosci recznej do zamiany';
  END IF;

  SELECT *
  INTO v_result
  FROM public.match_bank_transaction_to_document(
    p_transaction_id,
    'ksef',
    p_ksef_invoice_id,
    v_allocate,
    p_confidence,
    'manual',
    COALESCE(p_match_reasons, ARRAY[]::text[])
      || ARRAY['Zastapiono reczne oznaczenie platnosci powiazaniem z wyciagiem']
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_paid_ksef_invoice_with_bank_transaction(uuid, uuid, numeric, numeric, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_paid_ksef_invoice_with_bank_transaction(uuid, uuid, numeric, numeric, text[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.reconcile_paid_ksef_invoice_with_bank_transaction(uuid, uuid, numeric, numeric, text[])
IS 'Atomowo zastepuje reczna platnosc KSeF dopasowaniem do transakcji bankowej.';
