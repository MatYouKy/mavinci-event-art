BEGIN;

-- Payment evidence uses the same CRM/KSeF alias rules as the event lifecycle.
-- A paid status alone is not evidence, and the two ledgers are never added.
CREATE OR REPLACE FUNCTION public.invoice_confirmed_received_amount(p_invoice_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH document AS (
    SELECT i.*, public.bank_document_due_amount(i.id, NULL, NULL) AS amount_due
    FROM public.invoices i WHERE i.id = p_invoice_id
  ), official_candidates AS (
    SELECT k.id, k.invoice_id
    FROM public.ksef_invoices k JOIN document i ON i.id = k.invoice_id
    WHERE k.invoice_type = 'issued'
      AND k.my_company_id = i.my_company_id
      AND NULLIF(BTRIM(k.ksef_reference_number), '') IS NOT NULL
      AND k.sync_status IS DISTINCT FROM 'error'
      AND UPPER(COALESCE(k.currency, 'PLN')) = i.currency_code
      AND (NULLIF(BTRIM(i.ksef_reference_number), '') IS NULL
           OR k.ksef_reference_number = i.ksef_reference_number)
      AND ABS(k.gross_amount - i.total_gross) <= 0.01
      AND ABS(ABS(COALESCE(k.amount_to_pay_gross, k.gross_amount)) - i.amount_due) <= 0.01
  ), official AS (
    SELECT k.* FROM official_candidates k
    WHERE (SELECT COUNT(*) FROM official_candidates) = 1
  )
  SELECT COALESCE((
    SELECT GREATEST(
      COALESCE(i.manual_paid_amount, 0) + COALESCE((
        SELECT SUM(COALESCE(m.document_amount, m.amount))
        FROM public.bank_transaction_invoice_matches m
        JOIN public.bank_transactions b ON b.id = m.bank_transaction_id
        JOIN public.bank_statements s ON s.id = b.statement_id
        WHERE m.invoice_id = i.id AND s.my_company_id = i.my_company_id
          AND COALESCE(m.document_currency, m.currency) = i.currency_code
          AND (m.document_amount IS NOT NULL OR m.currency = i.currency_code)
          AND b.transaction_type = CASE
            WHEN i.invoice_type = 'corrective' AND i.total_gross < 0 THEN 'debit' ELSE 'credit' END
      ), 0),
      COALESCE((
        SELECT SUM(p.amount)
        FROM public.ksef_invoice_payments p
        JOIN official k ON k.id = p.ksef_invoice_id
        WHERE k.invoice_id = i.id AND (
          p.bank_match_id IS NULL OR EXISTS (
            SELECT 1
            FROM public.bank_transaction_invoice_matches m
            JOIN public.bank_transactions b ON b.id = m.bank_transaction_id
            JOIN public.bank_statements s ON s.id = b.statement_id
            WHERE m.id = p.bank_match_id AND m.ksef_invoice_id = k.id
              AND s.my_company_id = i.my_company_id
              AND COALESCE(m.document_currency, m.currency) = i.currency_code
              AND b.transaction_type = CASE
                WHEN i.invoice_type = 'corrective' AND i.total_gross < 0 THEN 'debit' ELSE 'credit' END
          )
        )
      ), 0)
    ) FROM document i
  ), 0);
$function$;

REVOKE ALL ON FUNCTION public.invoice_confirmed_received_amount(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.convert_proforma_atomic(
  p_proforma_id uuid,
  p_invoice jsonb,
  p_items jsonb,
  p_order_items jsonb DEFAULT '[]'::jsonb,
  p_actor uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_proforma public.invoices%ROWTYPE;
  v_target public.invoices%ROWTYPE;
  v_target_id uuid;
  v_target_type text := p_invoice->>'invoice_type';
  v_link_type text;
  v_actor uuid;
  v_items jsonb := p_items;
  v_order_items jsonb := p_order_items;
  v_invoice jsonb := p_invoice;
  v_received_date date;
  v_received_source text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_invoice(p_proforma_id) THEN
    RAISE EXCEPTION 'Brak uprawnień do konwersji proformy' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_proforma FROM public.invoices WHERE id = p_proforma_id FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(v_proforma.is_proforma, false) THEN
    RAISE EXCEPTION 'Nie znaleziono proformy';
  END IF;
  IF v_proforma.status = 'cancelled' THEN
    RAISE EXCEPTION 'Anulowanej proformy nie można konwertować';
  END IF;
  IF v_target_type IS NULL OR v_target_type NOT IN ('vat', 'advance') THEN
    RAISE EXCEPTION 'Proformę można przekształcić tylko w fakturę VAT albo zaliczkową';
  END IF;

  v_actor := public.current_invoice_employee_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Nie znaleziono profilu pracownika dla zalogowanego użytkownika'
      USING ERRCODE = '42501';
  END IF;

  IF v_proforma.my_company_id IS DISTINCT FROM NULLIF(p_invoice->>'my_company_id', '')::uuid
     OR v_proforma.event_id IS DISTINCT FROM NULLIF(p_invoice->>'event_id', '')::uuid
     OR v_proforma.organization_id IS DISTINCT FROM NULLIF(p_invoice->>'organization_id', '')::uuid
     OR COALESCE(v_proforma.currency_code, 'PLN') IS DISTINCT FROM COALESCE(p_invoice->>'currency_code', 'PLN') THEN
    RAISE EXCEPTION 'Faktura musi zachować sprzedawcę, płatnika, wydarzenie i walutę proformy';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_source_links link
    JOIN public.invoices target ON target.id = link.target_invoice_id
    WHERE link.source_invoice_id = p_proforma_id AND target.status <> 'cancelled'
  ) OR EXISTS (
    SELECT 1 FROM public.invoices target
    WHERE target.id = v_proforma.proforma_converted_to_invoice_id
      AND target.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Dla tej proformy istnieje już faktura VAT albo zaliczkowa'
      USING ERRCODE = '23505';
  END IF;

  -- Keep the existing unique VAT conversion rule, including its audit links.
  IF v_target_type = 'vat' AND EXISTS (
    SELECT 1 FROM public.invoice_source_links
    WHERE source_invoice_id = p_proforma_id AND link_type = 'proforma_to_vat'
  ) THEN
    RAISE EXCEPTION 'Dla tej proformy wystawiono już fakturę VAT' USING ERRCODE = '23505';
  END IF;

  IF v_target_type = 'advance' THEN
    -- Legacy proformas can carry ledger links despite the current payment
    -- normalizer. Do not turn that same bank/KSeF receipt into a new manual
    -- payment: removing the original match would then leave the advance paid.
    -- Supporting these records requires an atomic transfer of the real links.
    IF EXISTS (
      SELECT 1 FROM public.bank_transaction_invoice_matches m
      WHERE m.invoice_id = p_proforma_id
    ) OR EXISTS (
      SELECT 1
      FROM public.ksef_invoices k
      JOIN public.ksef_invoice_payments payment ON payment.ksef_invoice_id = k.id
      WHERE k.invoice_id = p_proforma_id
        AND k.invoice_type = 'issued'
        AND k.my_company_id = v_proforma.my_company_id
        AND NULLIF(BTRIM(k.ksef_reference_number), '') IS NOT NULL
        AND k.sync_status IS DISTINCT FROM 'error'
        AND UPPER(COALESCE(k.currency, 'PLN')) = v_proforma.currency_code
        AND (NULLIF(BTRIM(v_proforma.ksef_reference_number), '') IS NULL
             OR k.ksef_reference_number = v_proforma.ksef_reference_number)
        AND ABS(k.gross_amount - v_proforma.total_gross) <= 0.01
        AND ABS(ABS(COALESCE(k.amount_to_pay_gross, k.gross_amount)) - v_proforma.total_gross) <= 0.01
    ) THEN
      RAISE EXCEPTION 'Proforma ma powiązaną wpłatę bankową lub płatność KSeF. Konwersja wymaga przeniesienia istniejącego powiązania płatności na zaliczkę, czego ten formularz jeszcze nie obsługuje. Nie utworzono faktury.';
    END IF;

    IF COALESCE(v_proforma.total_gross, 0) <= 0 THEN
      RAISE EXCEPTION 'Proforma musi mieć dodatnią wartość zaliczki';
    END IF;

    -- Convert the entire proforma. Its amount may itself already be an advance.
    SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.position_number), '[]'::jsonb)
    INTO v_items FROM public.invoice_items item WHERE item.invoice_id = p_proforma_id;
    SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item.position_number), '[]'::jsonb)
    INTO v_order_items FROM public.invoice_order_items item WHERE item.invoice_id = p_proforma_id;
    IF jsonb_array_length(v_order_items) = 0 THEN v_order_items := v_items; END IF;

    IF public.invoice_confirmed_received_amount(p_proforma_id) >= v_proforma.total_gross - 0.01
       AND COALESCE(v_proforma.paid_date, v_proforma.paid_at::date) IS NOT NULL THEN
      v_received_date := COALESCE(v_proforma.paid_date, v_proforma.paid_at::date);
      v_received_source := 'proforma_payment';
    ELSIF COALESCE((p_invoice->>'received_payment_confirmed')::boolean, false) THEN
      v_received_date := NULLIF(p_invoice->>'received_payment_date', '')::date;
      v_received_source := 'user_confirmation';
    ELSE
      RAISE EXCEPTION 'Potwierdź otrzymanie całej kwoty proformy i podaj datę otrzymania wpłaty';
    END IF;

    IF v_received_date IS NULL THEN
      RAISE EXCEPTION 'Podaj datę otrzymania wpłaty za proformę';
    END IF;
    IF v_received_date > CURRENT_DATE
       OR v_received_date > (p_invoice->>'issue_date')::date THEN
      RAISE EXCEPTION 'Data otrzymania wpłaty nie może być przyszła ani późniejsza niż data wystawienia faktury';
    END IF;

    -- Item triggers calculate totals while building the document. Record the
    -- confirmed receipt only after all positions have reached their final value.
    v_invoice := p_invoice || jsonb_build_object(
      'status', 'draft', 'payment_status', 'unpaid', 'paid_amount', 0, 'paid_at', NULL
    );
  END IF;

  v_target_id := public.create_invoice_atomic(v_invoice, v_items, v_order_items, v_actor);
  IF v_target_type = 'advance' THEN
    SELECT * INTO v_target FROM public.invoices WHERE id = v_target_id;
    IF ABS(v_target.total_net - v_proforma.total_net) > 0.01
       OR ABS(v_target.total_vat - v_proforma.total_vat) > 0.01
       OR ABS(v_target.total_gross - v_proforma.total_gross) > 0.01 THEN
      RAISE EXCEPTION 'Kwota zaliczki musi odpowiadać całej kwocie proformy';
    END IF;
    IF v_target.order_total_gross < v_target.total_gross - 0.01 THEN
      RAISE EXCEPTION 'Wartość całego zamówienia nie może być mniejsza niż kwota zaliczki';
    END IF;

    UPDATE public.invoices
    SET status = 'issued', paid_amount = total_gross,
        paid_date = v_received_date, paid_at = v_received_date::timestamptz,
        updated_at = now()
    WHERE id = v_target_id;
  END IF;

  v_link_type := CASE WHEN v_target_type = 'vat' THEN 'proforma_to_vat' ELSE 'proforma_to_advance' END;
  INSERT INTO public.invoice_source_links (
    source_invoice_id, target_invoice_id, link_type, created_by
  ) VALUES (p_proforma_id, v_target_id, v_link_type, v_actor);

  INSERT INTO public.invoice_event_allocations (
    invoice_id, event_id, settlement_group_id, is_primary, allocation_method, allocation_weight
  )
  SELECT v_target_id, event_id, settlement_group_id, is_primary, allocation_method, allocation_weight
  FROM public.invoice_event_allocations WHERE invoice_id = p_proforma_id;

  IF v_target_type = 'vat' THEN
    UPDATE public.invoices
    SET proforma_converted_to_invoice_id = v_target_id, updated_at = now()
    WHERE id = p_proforma_id;
  END IF;

  INSERT INTO public.invoice_history (invoice_id, action, changed_by, changes)
  VALUES (
    v_target_id, 'created_from_proforma', v_actor,
    jsonb_build_object(
      'source_proforma_id', p_proforma_id,
      'source_proforma_number', v_proforma.invoice_number,
      'target_type', v_target_type,
      'received_payment_source', v_received_source,
      'received_payment_date', v_received_date,
      'received_payment_amount', CASE WHEN v_target_type = 'advance' THEN v_target.total_gross ELSE NULL END
    )
  );

  RETURN v_target_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.convert_proforma_atomic(uuid, jsonb, jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_proforma_atomic(uuid, jsonb, jsonb, jsonb, uuid) TO authenticated;

-- The client uses a new entry point so an older database cannot silently ignore
-- the receipt confirmation fields and create an unpaid draft instead.
CREATE OR REPLACE FUNCTION public.convert_proforma_with_payment_atomic(
  p_proforma_id uuid,
  p_invoice jsonb,
  p_items jsonb,
  p_order_items jsonb DEFAULT '[]'::jsonb,
  p_actor uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SET search_path = public, pg_temp
AS $function$
  SELECT public.convert_proforma_atomic(p_proforma_id, p_invoice, p_items, p_order_items, p_actor);
$function$;

REVOKE ALL ON FUNCTION public.convert_proforma_with_payment_atomic(uuid, jsonb, jsonb, jsonb, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_proforma_with_payment_atomic(uuid, jsonb, jsonb, jsonb, uuid)
  TO authenticated;

-- Apply to new settlements only. Historical invoices and payments are not
-- rewritten. An unpaid advance cannot reduce a newly created final invoice.
CREATE OR REPLACE FUNCTION public.require_paid_advance_for_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_advance public.invoices%ROWTYPE;
BEGIN
  SELECT * INTO v_advance FROM public.invoices
  WHERE id = NEW.advance_invoice_id FOR UPDATE;

  IF NOT FOUND OR v_advance.invoice_type <> 'advance'
     OR v_advance.status NOT IN ('issued', 'sent', 'paid', 'overdue')
     OR COALESCE(v_advance.total_gross, 0) <= 0 THEN
    RAISE EXCEPTION 'Faktura końcowa może rozliczać tylko wystawione faktury zaliczkowe';
  END IF;
  IF public.invoice_confirmed_received_amount(v_advance.id) < v_advance.total_gross - 0.01 THEN
    RAISE EXCEPTION 'Zaliczka % nie jest w pełni opłacona. Najpierw rozlicz jej wpłatę.', v_advance.invoice_number;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.require_paid_advance_for_settlement() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_require_paid_advance_for_settlement
BEFORE INSERT OR UPDATE OF advance_invoice_id, settled_gross ON public.invoice_settlements
FOR EACH ROW EXECUTE FUNCTION public.require_paid_advance_for_settlement();

-- Require the migration's canonical receipt guard when the client creates a
-- final invoice. A missing entry point fails before the old RPC can write.
CREATE OR REPLACE FUNCTION public.create_paid_final_invoice_atomic(
  p_invoice jsonb,
  p_items jsonb,
  p_advance_ids uuid[],
  p_actor uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SET search_path = public, pg_temp
AS $function$
  SELECT public.create_final_invoice_atomic(p_invoice, p_items, p_advance_ids, p_actor);
$function$;

REVOKE ALL ON FUNCTION public.create_paid_final_invoice_atomic(jsonb, jsonb, uuid[], uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_paid_final_invoice_atomic(jsonb, jsonb, uuid[], uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
