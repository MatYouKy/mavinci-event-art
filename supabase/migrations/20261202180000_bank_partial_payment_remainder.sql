-- Płatność częściowa: kolejna płatność do tej samej faktury i propozycja brakującej części
-- (docs/bank-reconciliation.md, sekcja 17).
--
-- Przykład: faktura kosztowa V/093/10/2026 na 15 185,58 zł płacona dwoma przelewami po 7 592,79 zł (08.10 i 19.10).
-- Faktura miała ręczne oznaczenie zapłaty 7 592,79 zł; po dopasowaniu przelewu z 19.10 ręczny wpis i przelew dały razem
-- „opłacona”, a okno „Dopasuj dokument do płatności” blokowało fakturę dla przelewu z 08.10 („Dokument ma już zapisane
-- powiązanie z płatnością”) — wybór dokumentu dopuszczał tylko dokumenty bez żadnego powiązania z wyciągiem.
--
-- 1. `get_bank_transaction_document_picker_items` — dokument z częściowym powiązaniem z wyciągiem można dopasować do
--    kolejnej płatności, dopóki część jego kwoty nie jest potwierdzona przelewem. Nowe kolumny: `bank_matched_amount`
--    (ile potwierdzają już przelewy z wyciągu) i `manual_paid_amount` (ile oznaczono ręcznie bez przelewu). Zmiana
--    zwracanych kolumn wymaga DROP i CREATE — uprawnienia jak dotąd (authenticated, service_role).
-- 2. `match_bank_transaction_to_document` — faktura KSeF: do powiązania zostaje kwota do zapłaty minus przelewy z wyciągu,
--    a ręczne oznaczenie zapłaty ustępuje przelewowi (jak w `reconcile_paid_ksef_invoice_with_bank_transaction`): gdy
--    przelew razem z ręcznymi wpisami przekroczyłby kwotę faktury, najnowsze ręczne wpisy są zmniejszane albo usuwane.
--    Pozostałe źródła bez zmian (faktury CRM i dokumenty spoza KSeF już przyjmują kolejne przelewy).
-- 3. Propozycja brakującej części (reguła `reszta_platnosci`): po ręcznym powiązaniu (wybór dokumentu, zatwierdzona
--    propozycja), gdy dokumentu nie potwierdza jeszcze w całości wyciąg, system szuka płatności tej działalności na
--    dokładnie brakującą kwotę od tego samego kontrahenta (ten sam rachunek co płatność właśnie powiązana, NIP albo nazwa
--    w treści przelewu) i zapisuje propozycję do zatwierdzenia przez człowieka. Wyzwalacz po zapisie powiązania; błąd
--    propozycji nie zatrzymuje dopasowania. Odrzucona propozycja nie wraca.
--
-- Ponowne uruchomienie niczego nie psuje (DROP … IF EXISTS, CREATE OR REPLACE).

-- MARK: 1. Wybór dokumentu do płatności

DROP FUNCTION IF EXISTS public.get_bank_transaction_document_picker_items(uuid);

CREATE FUNCTION public.get_bank_transaction_document_picker_items(p_transaction_id uuid)
 RETURNS TABLE(document_source text, document_id uuid, document_number text, gross_amount numeric, outstanding_amount numeric,
   issue_date date, due_date date, counterparty_name text, currency text, payment_status text, payment_method text,
   is_matched boolean, is_matchable boolean, bank_matched_amount numeric, manual_paid_amount numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id uuid;
  v_direction text;
  v_can_view_personnel boolean;
BEGIN
  SELECT bs.my_company_id, bt.transaction_type
  INTO v_company_id, v_direction
  FROM public.bank_transactions bt
  JOIN public.bank_statements bs ON bs.id = bt.statement_id
  WHERE bt.id = p_transaction_id;

  IF NOT FOUND OR v_company_id IS NULL THEN RETURN; END IF;
  IF auth.role() <> 'service_role' AND NOT (
    public.finance_can_view() AND public.finance_company_visible(v_company_id)
  ) THEN RETURN; END IF;

  v_can_view_personnel := auth.role() = 'service_role'
    OR public.can_view_personnel_contracts();

  RETURN QUERY
  WITH documents AS (
    -- Faktura CRM: kolejny przelew, dopóki zapłacono mniej niż kwota do zapłaty (także po częściowym powiązaniu).
    SELECT
      'invoice'::text AS source,
      i.id,
      i.invoice_number::text AS number,
      ABS(public.bank_document_due_amount(i.id, NULL, NULL))::numeric AS gross,
      GREATEST(
        ABS(public.bank_document_due_amount(i.id, NULL, NULL)) - COALESCE(i.paid_amount, 0),
        0
      )::numeric AS outstanding,
      i.issue_date,
      i.payment_due_date AS due,
      i.buyer_name::text AS counterparty,
      UPPER(COALESCE(i.currency_code, 'PLN'))::text AS document_currency,
      COALESCE(i.payment_status::text, i.status::text, 'unpaid') AS status,
      i.payment_method::text AS method,
      bank.n > 0 AS matched,
      COALESCE(i.paid_amount, 0) < ABS(public.bank_document_due_amount(i.id, NULL, NULL)) - 0.01 AS matchable,
      CASE
        WHEN i.invoice_type = 'corrective' AND COALESCE(i.total_gross, 0) < 0 THEN 'debit'
        ELSE 'credit'
      END::text AS direction,
      bank.amount::numeric AS bank_amount,
      COALESCE(i.manual_paid_amount, 0)::numeric AS manual_amount
    FROM public.invoices i
    CROSS JOIN LATERAL (
      SELECT COUNT(*) AS n, COALESCE(SUM(m.amount), 0) AS amount
      FROM public.bank_transaction_invoice_matches m
      WHERE m.invoice_id = i.id
    ) bank
    WHERE i.my_company_id = v_company_id
      AND i.status NOT IN ('draft', 'cancelled', 'proforma')
      AND i.invoice_type <> 'proforma'
      AND NOT EXISTS (
        SELECT 1 FROM public.ksef_invoices ki
        WHERE ki.invoice_id = i.id
          AND NULLIF(ki.ksef_reference_number, '') IS NOT NULL
      )

    UNION ALL

    -- Faktura KSeF: kolejny przelew, dopóki wyciąg nie potwierdza całej kwoty (ręczne oznaczenie zapłaty ustępuje przelewowi).
    SELECT
      'ksef'::text,
      ki.id,
      COALESCE(ki.invoice_number, ki.ksef_reference_number, 'bez numeru')::text,
      ABS(public.bank_document_due_amount(NULL, ki.id, NULL))::numeric,
      GREATEST(ABS(public.bank_document_due_amount(NULL, ki.id, NULL)) - pay.total, 0)::numeric,
      ki.issue_date,
      ki.payment_due_date,
      CASE WHEN ki.invoice_type::text = 'issued' THEN ki.buyer_name ELSE ki.seller_name END,
      UPPER(COALESCE(ki.currency, 'PLN'))::text,
      COALESCE(ki.payment_status, 'unpaid')::text,
      ki.payment_method::text,
      pay.bank_n > 0,
      ABS(public.bank_document_due_amount(NULL, ki.id, NULL)) - pay.bank > 0.01,
      CASE
        WHEN ki.invoice_type::text = 'issued'
          AND COALESCE(ki.amount_to_pay_gross, ki.gross_amount, 0) >= 0 THEN 'credit'
        WHEN ki.invoice_type::text = 'issued' THEN 'debit'
        WHEN COALESCE(ki.amount_to_pay_gross, ki.gross_amount, 0) >= 0 THEN 'debit'
        ELSE 'credit'
      END::text,
      pay.bank::numeric,
      CASE
        WHEN ki.payment_status = 'paid' THEN GREATEST(ABS(public.bank_document_due_amount(NULL, ki.id, NULL)) - pay.bank, 0)
        ELSE GREATEST(pay.total - pay.bank, 0)
      END::numeric
    FROM public.ksef_invoices ki
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(payment.amount), 0) AS total,
             COALESCE(SUM(payment.amount) FILTER (WHERE payment.bank_match_id IS NOT NULL), 0) AS bank,
             COUNT(*) FILTER (WHERE payment.bank_match_id IS NOT NULL) AS bank_n
      FROM public.ksef_invoice_payments payment
      WHERE payment.ksef_invoice_id = ki.id
    ) pay
    WHERE ki.my_company_id = v_company_id
      AND ki.sync_status::text <> 'error'

    UNION ALL

    -- Dokument spoza KSeF: kolejny przelew, dopóki wyciąg nie potwierdza całej kwoty (w walucie dokumentu).
    SELECT
      'external'::text,
      ei.id,
      COALESCE(ei.invoice_number, 'bez numeru')::text,
      ABS(public.bank_document_due_amount(NULL, NULL, ei.id))::numeric,
      GREATEST(
        ABS(public.bank_document_due_amount(NULL, NULL, ei.id)) - COALESCE(ei.paid_amount, 0),
        0
      )::numeric,
      ei.invoice_date,
      NULL::date,
      ei.seller_name::text,
      UPPER(COALESCE(ei.currency, 'PLN'))::text,
      COALESCE(ei.payment_status, 'unpaid')::text,
      ei.payment_method::text,
      bank.n > 0,
      ABS(public.bank_document_due_amount(NULL, NULL, ei.id)) - bank.amount > 0.01,
      CASE WHEN COALESCE(ei.amount_gross, 0) >= 0 THEN 'debit' ELSE 'credit' END::text,
      bank.amount::numeric,
      CASE
        WHEN ei.payment_status = 'paid' THEN GREATEST(ABS(public.bank_document_due_amount(NULL, NULL, ei.id)) - bank.amount, 0)
        ELSE COALESCE(ei.manual_paid_amount, 0)
      END::numeric
    FROM public.external_invoices ei
    CROSS JOIN LATERAL (
      SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(m.document_amount, m.amount)), 0) AS amount
      FROM public.bank_transaction_invoice_matches m
      WHERE m.external_invoice_id = ei.id
    ) bank
    WHERE (ei.my_company_id = v_company_id OR ei.my_company_id IS NULL)
      AND ei.payment_status <> 'cancelled'

    UNION ALL

    SELECT
      'personnel'::text,
      payment.id,
      CONCAT(
        COALESCE(contract.contract_number, 'Umowa bez numeru'),
        ' · ',
        CASE payment.payment_type
          WHEN 'salary' THEN 'Wynagrodzenie'
          WHEN 'advance' THEN 'Zaliczka'
          WHEN 'tax' THEN 'Podatek'
          WHEN 'zus' THEN 'ZUS'
          WHEN 'reimbursement' THEN 'Zwrot kosztów'
          ELSE 'Inna opłata'
        END
      )::text,
      ABS(payment.amount)::numeric,
      CASE WHEN payment.bank_transaction_id IS NULL THEN ABS(payment.amount) ELSE 0 END::numeric,
      payment.payment_date,
      payment.payment_date,
      COALESCE(payment.recipient_name, contract.party_name)::text,
      UPPER(COALESCE(payment.currency, 'PLN'))::text,
      CASE WHEN payment.bank_transaction_id IS NULL THEN 'unpaid' ELSE 'paid' END::text,
      'bank_transfer'::text,
      payment.bank_transaction_id IS NOT NULL,
      payment.bank_transaction_id IS NULL,
      'debit'::text,
      CASE WHEN payment.bank_transaction_id IS NULL THEN 0 ELSE ABS(payment.amount) END::numeric,
      0::numeric
    FROM public.personnel_contract_payments payment
    JOIN public.personnel_contracts contract ON contract.id = payment.personnel_contract_id
    WHERE v_can_view_personnel
      AND (contract.my_company_id = v_company_id OR contract.my_company_id IS NULL)
  )
  SELECT
    document.source,
    document.id,
    document.number,
    document.gross,
    document.outstanding,
    document.issue_date,
    document.due,
    document.counterparty,
    document.document_currency,
    document.status,
    document.method,
    document.matched,
    document.matchable,
    ROUND(document.bank_amount, 2),
    ROUND(document.manual_amount, 2)
  FROM documents document
  WHERE document.direction = v_direction
  ORDER BY document.issue_date DESC NULLS LAST, document.number;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_bank_transaction_document_picker_items(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_bank_transaction_document_picker_items(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_bank_transaction_document_picker_items(uuid) TO authenticated, service_role;

-- MARK: 2. Powiązanie płatności z dokumentem — faktura KSeF: przelew zastępuje ręczne oznaczenie zapłaty

CREATE OR REPLACE FUNCTION public.match_bank_transaction_to_document(p_transaction_id uuid, p_document_source text, p_document_id uuid, p_amount numeric DEFAULT NULL::numeric, p_confidence numeric DEFAULT NULL::numeric, p_match_method text DEFAULT 'manual'::text, p_match_reasons text[] DEFAULT ARRAY[]::text[])
 RETURNS bank_transaction_invoice_matches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_ksef_status text;
  v_ksef_payment_date date;
  v_ledger numeric(14,2);
  v_excess numeric(14,2);
  v_remaining numeric(14,2);
  v_payment record;
  v_reasons text[] := COALESCE(p_match_reasons, ARRAY[]::text[]);
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
    public.finance_company_manageable(v_company_id)
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
           ki.payment_status,
           ki.payment_date
    INTO v_target_company, v_target_currency, v_raw_amount, v_expected_direction, v_document_active, v_ksef_status, v_ksef_payment_date
    FROM public.ksef_invoices ki WHERE ki.id = p_document_id FOR UPDATE;
    v_due := public.bank_document_due_amount(NULL, p_document_id, NULL);
    -- Saldo do powiązania: kwota do zapłaty minus to, co już potwierdzają przelewy z wyciągu (wpisy historii wpłat z
    -- powiązaniem bankowym — także przelewy faktury CRM tej sprzedaży). Ręczne oznaczenie zapłaty nie blokuje przelewu.
    SELECT COALESCE(SUM(kp.amount), 0),
           COALESCE(SUM(kp.amount) FILTER (WHERE kp.bank_match_id IS NOT NULL), 0)
    INTO v_ledger, v_paid
    FROM public.ksef_invoice_payments kp
    WHERE kp.ksef_invoice_id = p_document_id;
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

  IF p_document_source = 'ksef' THEN
    -- Starsze rekordy ze statusem „opłacona” bez pozycji w historii wpłat: brakująca część jako wpłata ręczna (jak przy
    -- zamianie ręcznego oznaczenia), żeby zostało zachowane to, co oznaczono — ustąpi przelewom poniżej.
    IF v_ksef_status = 'paid' AND v_ledger < v_due - 0.01 THEN
      INSERT INTO public.ksef_invoice_payments (ksef_invoice_id, amount, payment_date, notes, created_by, payment_source)
      VALUES (p_document_id, ROUND(v_due - v_ledger, 2), COALESCE(v_ksef_payment_date, v_bt.transaction_date),
        'Zachowane historyczne oznaczenie platnosci przed powiazaniem z wyciagiem', public.current_invoice_employee_id(), 'manual');
      v_ledger := v_due;
    END IF;
    -- Ręczne oznaczenie zapłaty ustępuje przelewowi: nadwyżka ponad kwotę faktury zdejmowana z najnowszych ręcznych wpisów.
    v_excess := ROUND(v_ledger + v_allocate - v_due, 2);
    IF v_excess > 0.009 THEN
      v_remaining := v_excess;
      FOR v_payment IN
        SELECT kp.id, kp.amount
        FROM public.ksef_invoice_payments kp
        WHERE kp.ksef_invoice_id = p_document_id
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
      IF v_remaining > 0.01 THEN
        RAISE EXCEPTION 'Suma platnosci przekroczylaby kwote dokumentu KSeF';
      END IF;
      v_reasons := v_reasons || ARRAY['Zastapiono reczne oznaczenie platnosci powiazaniem z wyciagiem'];
    END IF;
  END IF;

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
        match_reasons = match_reasons || v_reasons
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
    v_reasons, public.current_invoice_employee_id()
  ) RETURNING * INTO v_result;

  RETURN v_result;
END;
$function$;

-- MARK: 3. Propozycja brakującej części płatności

-- Dokument po ręcznym powiązaniu z przelewem, którego wyciąg nie potwierdza jeszcze w całości: płatność tej działalności na
-- dokładnie brakującą kwotę, od tego samego kontrahenta, w okolicy dat dokumentu → propozycja `reszta_platnosci`
-- (zatwierdza człowiek). Zwraca liczbę zapisanych propozycji (0 albo 1 — najbliższa terminowi płatności).
CREATE OR REPLACE FUNCTION private.propose_bank_payment_remainder(p_source text, p_document_id uuid, p_transaction_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_company uuid;
  v_number text;
  v_party text;
  v_nip text;
  v_dir text;
  v_currency text;
  v_issue date;
  v_due_date date;
  v_due numeric;
  v_bank numeric;
  v_manual numeric;
  v_open numeric;
  v_manual_open numeric;
  v_rest numeric;
  v_token text;
  v_iban text;
  v_anchor date;
  v_doc jsonb;
  v_reason text;
  t record;
BEGIN
  IF p_source = 'ksef' THEN
    SELECT k.my_company_id, k.invoice_number,
           CASE WHEN k.invoice_type::text = 'issued' THEN k.buyer_name ELSE k.seller_name END,
           regexp_replace(CASE WHEN k.invoice_type::text = 'issued' THEN coalesce(k.buyer_nip, '') ELSE coalesce(k.seller_nip, '') END, '\D', '', 'g'),
           CASE
             WHEN k.invoice_type::text = 'issued' AND coalesce(k.amount_to_pay_gross, k.gross_amount, 0) >= 0 THEN 'credit'
             WHEN k.invoice_type::text = 'issued' THEN 'debit'
             WHEN coalesce(k.amount_to_pay_gross, k.gross_amount, 0) >= 0 THEN 'debit'
             ELSE 'credit'
           END,
           upper(coalesce(k.currency, 'PLN')), k.issue_date, k.payment_due_date,
           abs(coalesce(k.amount_to_pay_gross, k.gross_amount, 0)),
           CASE WHEN k.payment_status = 'paid' THEN NULL
                ELSE (SELECT coalesce(sum(p.amount), 0) FROM public.ksef_invoice_payments p
                      WHERE p.ksef_invoice_id = k.id AND p.bank_match_id IS NULL) END
    INTO v_company, v_number, v_party, v_nip, v_dir, v_currency, v_issue, v_due_date, v_due, v_manual
    FROM public.ksef_invoices k
    WHERE k.id = p_document_id AND k.sync_status IS DISTINCT FROM 'error';
  ELSIF p_source = 'invoice' THEN
    SELECT i.my_company_id, i.invoice_number, i.buyer_name, regexp_replace(coalesce(i.buyer_nip, ''), '\D', '', 'g'),
           CASE WHEN i.invoice_type = 'corrective' AND i.total_gross < 0 THEN 'debit' ELSE 'credit' END,
           upper(coalesce(i.currency_code, 'PLN')), i.issue_date, i.payment_due_date,
           public.bank_document_due_amount(i.id, NULL, NULL),
           CASE WHEN i.status = 'paid' OR i.payment_status = 'paid' THEN NULL ELSE coalesce(i.manual_paid_amount, 0) END
    INTO v_company, v_number, v_party, v_nip, v_dir, v_currency, v_issue, v_due_date, v_due, v_manual
    FROM public.invoices i
    WHERE i.id = p_document_id AND i.status NOT IN ('draft', 'cancelled', 'proforma') AND i.invoice_type <> 'proforma';
  ELSIF p_source = 'external' THEN
    SELECT e.my_company_id, e.invoice_number, e.seller_name, regexp_replace(coalesce(e.seller_nip, ''), '\D', '', 'g'),
           CASE WHEN coalesce(e.amount_gross, 0) >= 0 THEN 'debit' ELSE 'credit' END,
           upper(coalesce(e.currency, 'PLN')), e.invoice_date, NULL::date, abs(coalesce(e.amount_gross, 0)),
           CASE WHEN e.payment_status = 'paid' THEN NULL ELSE coalesce(e.manual_paid_amount, 0) END
    INTO v_company, v_number, v_party, v_nip, v_dir, v_currency, v_issue, v_due_date, v_due, v_manual
    FROM public.external_invoices e
    WHERE e.id = p_document_id AND e.payment_status <> 'cancelled';
  ELSE
    RETURN 0;
  END IF;
  IF v_company IS NULL OR coalesce(v_due, 0) <= 0.009 THEN RETURN 0; END IF;

  -- Przelewy z wyciągu przy dokumencie i jego kopiach w innych źródłach (jak kontrola podwójnego rozliczenia).
  SELECT coalesce(sum(coalesce(m.document_amount, m.amount)), 0)
  INTO v_bank
  FROM public.bank_transaction_invoice_matches m
  JOIN private.bank_document_twins(p_source, p_document_id) tw
    ON (tw.source = 'ksef' AND m.ksef_invoice_id = tw.document_id)
    OR (tw.source = 'invoice' AND m.invoice_id = tw.document_id)
    OR (tw.source = 'external' AND m.external_invoice_id = tw.document_id);

  -- Jak w uzgodnieniu (`reconcile_bank_month`): część otwarta i część oznaczona ręcznie, której nie potwierdza wyciąg.
  v_manual := coalesce(v_manual, greatest(v_due - v_bank, 0));
  v_open := round(greatest(v_due - v_bank - v_manual, 0), 2);
  v_manual_open := round(least(v_manual, greatest(v_due - v_bank, 0)), 2);
  v_rest := round(v_open + v_manual_open, 2);
  -- Tylko po części zapłaconej przelewem, gdy czegoś jeszcze brakuje.
  IF v_bank <= 0.009 OR v_rest <= 0.009 THEN RETURN 0; END IF;
  -- Zatwierdzenie propozycji umie: część otwartą (każde źródło), część oznaczoną ręcznie (KSeF i spoza KSeF) i obie naraz
  -- (KSeF — ręczny wpis ustępuje przelewowi).
  IF p_source <> 'ksef' AND v_open > 0.009 AND v_manual_open > 0.009 THEN RETURN 0; END IF;
  IF p_source = 'invoice' AND v_open <= 0.009 THEN RETURN 0; END IF;

  SELECT regexp_replace(coalesce(bt.counterparty_account, ''), '\D', '', 'g')
  INTO v_iban
  FROM public.bank_transactions bt WHERE bt.id = p_transaction_id;
  v_iban := coalesce(v_iban, '');
  v_token := coalesce(private.bank_party_token(v_party), '');
  v_anchor := coalesce(v_due_date, v_issue);
  v_doc := jsonb_build_object('source', p_source, 'document_id', p_document_id, 'number', v_number, 'party', v_party,
    'due', v_due, 'open_bank', v_open, 'manual_open', v_manual_open, 'due_date', v_due_date, 'issue_date', v_issue);

  FOR t IN
    WITH candidates AS (
      SELECT bt.id, bt.transaction_date,
             regexp_replace(coalesce(bt.counterparty_account, ''), '\D', '', 'g') AS iban,
             private.bank_norm(concat_ws(' ', bt.title, bt.raw_description, bt.counterparty_name, bt.raw_counterparty, bt.reference_number,
               (SELECT string_agg(concat_ws(' ', c.title, c.raw_description, c.counterparty_name, c.raw_counterparty), ' ')
                FROM public.bank_transactions c WHERE c.canonical_transaction_id = bt.id))) AS text_norm
      FROM public.bank_transactions bt
      JOIN public.bank_statements s ON s.id = bt.statement_id
      WHERE s.my_company_id = v_company AND s.processed AND s.validation_status = 'valid'
        AND bt.canonical_transaction_id IS NULL AND bt.id <> p_transaction_id
        AND bt.transaction_type = v_dir AND upper(coalesce(bt.currency, 'PLN')) = v_currency
        AND abs(abs(bt.amount) - v_rest) <= 0.01
        AND abs(abs(bt.amount) - private.bank_transaction_allocated(bt.id) - v_rest) <= 0.01
        AND bt.transaction_date BETWEEN coalesce(v_issue, v_due_date) - 120 AND coalesce(v_due_date, v_issue) + 180
        AND bt.paired_bank_transaction_id IS NULL AND NOT coalesce(bt.private_transfer_detected, false)
        AND bt.accounting_review_status IS DISTINCT FROM 'explained'
        AND NOT EXISTS (SELECT 1 FROM public.bank_reconciliation_proposals pr
                        WHERE pr.bank_transaction_id = bt.id AND pr.status = 'open')
        AND NOT EXISTS (SELECT 1 FROM public.bank_reconciliation_proposals pr
                        WHERE pr.bank_transaction_id = bt.id AND pr.status = 'rejected'
                          AND pr.documents @> jsonb_build_array(jsonb_build_object('id', p_document_id::text)))
    ), evidence AS (
      SELECT c.id, c.transaction_date,
             CASE
               WHEN length(v_iban) >= 20 AND c.iban = v_iban THEN 'ten sam rachunek kontrahenta co przy płatności właśnie powiązanej'
               WHEN length(v_nip) = 10 AND position(v_nip IN replace(c.text_norm, ' ', '')) > 0 THEN 'NIP ' || v_nip || ' w treści przelewu'
               WHEN v_token <> '' AND position(' ' || v_token || ' ' IN ' ' || c.text_norm || ' ') > 0
                 THEN 'nazwa kontrahenta („' || v_token || '”) w przelewie'
             END AS ev
      FROM candidates c
    )
    SELECT e.id, e.transaction_date, e.ev, count(*) OVER () AS total
    FROM evidence e
    WHERE e.ev IS NOT NULL
    ORDER BY abs(e.transaction_date - coalesce(v_anchor, e.transaction_date)), e.transaction_date, e.id
    LIMIT 1
  LOOP
    v_reason := 'Druga część płatności za ' || coalesce(v_number, 'dokument') || ': wyciąg potwierdza ' || private.money_pl(v_bank)
      || ' z ' || private.money_pl(v_due) || ', brakuje ' || private.money_pl(v_rest) || ' — ta płatność ma dokładnie tę kwotę; potwierdza to '
      || t.ev || '.'
      || CASE WHEN t.total > 1 THEN ' Takich płatności jest ' || t.total || ' — wybrano najbliższą terminowi; sprawdź przed zatwierdzeniem.' ELSE '' END;
    IF private.add_bank_proposal(t.id, 'allocate', 'reszta_platnosci',
         jsonb_build_array(private.bank_proposal_document(v_doc, v_rest, t.ev)), v_reason) THEN
      RETURN 1;
    END IF;
  END LOOP;
  RETURN 0;
END;
$function$;

REVOKE ALL ON FUNCTION private.propose_bank_payment_remainder(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.propose_bank_payment_remainder(text, uuid, uuid) FROM anon, authenticated, service_role;

-- Po zapisie ręcznego powiązania (wybór dokumentu, zatwierdzona propozycja, zamiana ręcznego oznaczenia) — propozycja
-- brakującej części. Błąd propozycji nie zatrzymuje powiązania (ostrzeżenie w logu bazy).
CREATE OR REPLACE FUNCTION private.bank_match_remainder_proposal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.match_method IS DISTINCT FROM 'manual' THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND coalesce(NEW.document_amount, NEW.amount) <= coalesce(OLD.document_amount, OLD.amount) THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM private.propose_bank_payment_remainder(NEW.document_source,
      coalesce(NEW.ksef_invoice_id, NEW.invoice_id, NEW.external_invoice_id), NEW.bank_transaction_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Propozycja brakującej części płatności pominięta: %', SQLERRM;
  END;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.bank_match_remainder_proposal() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.bank_match_remainder_proposal() FROM anon, authenticated, service_role;

DROP TRIGGER IF EXISTS zzz_bank_match_remainder_proposal ON public.bank_transaction_invoice_matches;
CREATE TRIGGER zzz_bank_match_remainder_proposal
  AFTER INSERT OR UPDATE OF amount, document_amount ON public.bank_transaction_invoice_matches
  FOR EACH ROW EXECUTE FUNCTION private.bank_match_remainder_proposal();
