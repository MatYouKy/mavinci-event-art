BEGIN;

-- One-way lifecycle projection. It never creates payments, rewrites invoice
-- totals, sends messages, or backfills historical events when installed.
-- An operational event status is NOT evidence that an invoice was paid.
DROP TRIGGER IF EXISTS trg_event_settled_sync_invoices ON public.events;
DROP TRIGGER IF EXISTS trg_invoice_paid_sync_event ON public.invoices;

CREATE OR REPLACE FUNCTION public.event_invoice_lifecycle_state(p_event_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH linked_ids AS (
    SELECT i.id
    FROM public.invoices i
    WHERE EXISTS (
      SELECT 1 FROM public.invoice_event_allocations a
      WHERE a.invoice_id = i.id AND a.event_id = p_event_id AND a.allocation_weight > 0
    ) OR (
      i.event_id = p_event_id
      AND NOT EXISTS (SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id = i.id)
    )
  ), issued AS (
    SELECT i.*
    FROM public.invoices i JOIN linked_ids l ON l.id = i.id
    WHERE i.status IN ('issued', 'sent', 'paid', 'overdue')
      AND i.is_proforma IS NOT TRUE
      AND i.invoice_type IN ('vat', 'advance', 'final', 'corrective')
  ), obligation_ids AS (
    SELECT id FROM issued
    UNION
    -- A final invoice can deduct advances that have not actually been paid.
    SELECT s.advance_invoice_id
    FROM public.invoice_settlements s JOIN issued i ON i.id = s.final_invoice_id
    WHERE i.invoice_type = 'final'
  ), obligations AS (
    SELECT i.*, public.bank_document_due_amount(i.id, NULL, NULL) AS amount_due
    FROM public.invoices i JOIN obligation_ids o ON o.id = i.id
  ), official_candidates AS (
    SELECT k.id, k.invoice_id
    FROM public.ksef_invoices k JOIN obligations i ON i.id = k.invoice_id
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
    WHERE (SELECT COUNT(*) FROM official_candidates other WHERE other.invoice_id = k.invoice_id) = 1
  ), evidence AS (
    SELECT i.*,
      GREATEST(
        -- The normalized paid flag can be sticky after removing a bank match.
        -- Read the manual confirmation plus the actual current local ledger.
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
        -- CRM and KSeF are aliases, not two payments. Never add both ledgers.
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
      ) AS confirmed_amount
    FROM obligations i
  ), assessed AS (
    SELECT i.id,
      CASE
        WHEN i.status NOT IN ('issued', 'sent', 'paid', 'overdue') OR i.is_proforma IS TRUE THEN false
        -- A historical final snapshot alone must not assert that advances were paid.
        WHEN i.invoice_type = 'final'
          AND COALESCE((i.settlement_summary->>'settledGross')::numeric, 0) > 0
          AND NOT EXISTS (SELECT 1 FROM public.invoice_settlements s WHERE s.final_invoice_id = i.id)
          THEN false
        WHEN i.amount_due = 0 THEN true
        ELSE i.confirmed_amount > 0 AND i.confirmed_amount >= i.amount_due - 0.01
      END AS fully_settled
    FROM evidence i
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM issued WHERE invoice_type IN ('vat', 'advance', 'final')) THEN NULL
    WHEN EXISTS (SELECT 1 FROM issued WHERE invoice_type IN ('vat', 'final'))
      AND NOT EXISTS (SELECT 1 FROM assessed WHERE NOT fully_settled)
      THEN 'settled'
    ELSE 'invoiced'
  END;
$function$;

REVOKE ALL ON FUNCTION public.event_invoice_lifecycle_state(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.event_invoice_lifecycle_state(uuid) IS
'Centralna ocena faktur wydarzenia: dokumenty wystawione, zaliczki, dopłaty końcowe, zwroty i kanoniczne płatności CRM/KSeF; bez modyfikacji danych.';

CREATE OR REPLACE FUNCTION public.sync_event_invoice_lifecycle(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_current text;
  v_target text;
BEGIN
  SELECT e.status::text INTO v_current
  FROM public.events e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_current = 'cancelled' THEN RETURN; END IF;
  v_target := public.event_invoice_lifecycle_state(p_event_id);
  -- Do not invent a previous operational stage after the last invoice is removed.
  IF v_target IS NULL OR v_target = v_current THEN RETURN; END IF;
  IF v_target = 'settled' THEN
    UPDATE public.events SET status = 'settled', updated_at = now() WHERE id = p_event_id;
  ELSE
    UPDATE public.events SET status = 'invoiced', updated_at = now() WHERE id = p_event_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_event_invoice_lifecycle(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_event_invoice_lifecycle_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  v_fields text[];
  v_row jsonb;
  v_invoice_ids uuid[] := ARRAY[]::uuid[];
  v_ksef_ids uuid[] := ARRAY[]::uuid[];
  v_event_ids uuid[] := ARRAY[]::uuid[];
  v_event_id uuid;
BEGIN
  v_fields := CASE TG_TABLE_NAME
    WHEN 'invoices' THEN ARRAY['id','event_id','status','payment_status','manual_paid_amount','paid_amount','invoice_type','is_proforma','total_gross','settlement_summary','my_company_id','currency_code','ksef_reference_number']
    WHEN 'ksef_invoices' THEN ARRAY['id','invoice_id','payment_status','invoice_type','my_company_id','currency','ksef_reference_number','sync_status','gross_amount','amount_to_pay_gross']
    WHEN 'ksef_invoice_payments' THEN ARRAY['ksef_invoice_id','amount','bank_match_id']
    WHEN 'bank_transaction_invoice_matches' THEN ARRAY['invoice_id','ksef_invoice_id','bank_transaction_id','amount','currency','document_amount','document_currency']
    WHEN 'invoice_event_allocations' THEN ARRAY['invoice_id','event_id','allocation_weight']
    WHEN 'invoice_settlements' THEN ARRAY['final_invoice_id','advance_invoice_id','settled_gross']
  END;
  IF TG_OP = 'UPDATE' AND
    (SELECT jsonb_object_agg(key, v_old->key) FROM unnest(v_fields) key) IS NOT DISTINCT FROM
    (SELECT jsonb_object_agg(key, v_new->key) FROM unnest(v_fields) key)
  THEN RETURN NULL; END IF;

  FOREACH v_row IN ARRAY ARRAY[v_old, v_new] LOOP
    IF TG_TABLE_NAME = 'invoices' THEN
      v_invoice_ids := array_append(v_invoice_ids, (v_row->>'id')::uuid);
      v_event_ids := array_append(v_event_ids, (v_row->>'event_id')::uuid);
    ELSIF TG_TABLE_NAME = 'ksef_invoices' THEN
      v_invoice_ids := array_append(v_invoice_ids, (v_row->>'invoice_id')::uuid);
    ELSIF TG_TABLE_NAME = 'ksef_invoice_payments' THEN
      v_ksef_ids := array_append(v_ksef_ids, (v_row->>'ksef_invoice_id')::uuid);
    ELSIF TG_TABLE_NAME = 'bank_transaction_invoice_matches' THEN
      v_invoice_ids := array_append(v_invoice_ids, (v_row->>'invoice_id')::uuid);
      v_ksef_ids := array_append(v_ksef_ids, (v_row->>'ksef_invoice_id')::uuid);
    ELSIF TG_TABLE_NAME = 'invoice_event_allocations' THEN
      v_invoice_ids := array_append(v_invoice_ids, (v_row->>'invoice_id')::uuid);
      v_event_ids := array_append(v_event_ids, (v_row->>'event_id')::uuid);
    ELSIF TG_TABLE_NAME = 'invoice_settlements' THEN
      v_invoice_ids := array_append(v_invoice_ids, (v_row->>'final_invoice_id')::uuid);
      v_invoice_ids := array_append(v_invoice_ids, (v_row->>'advance_invoice_id')::uuid);
    END IF;
  END LOOP;
  SELECT v_invoice_ids || COALESCE(array_agg(k.invoice_id), ARRAY[]::uuid[])
  INTO v_invoice_ids FROM public.ksef_invoices k WHERE k.id = ANY(v_ksef_ids);

  -- A changed advance affects all events billed by its related final invoice.
  SELECT v_invoice_ids || COALESCE(array_agg(s.final_invoice_id), ARRAY[]::uuid[])
  INTO v_invoice_ids FROM public.invoice_settlements s WHERE s.advance_invoice_id = ANY(v_invoice_ids);

  SELECT v_event_ids || COALESCE(array_agg(candidate.event_id), ARRAY[]::uuid[])
  INTO v_event_ids
  FROM (
    SELECT i.event_id FROM public.invoices i WHERE i.id = ANY(v_invoice_ids)
    UNION
    SELECT a.event_id FROM public.invoice_event_allocations a WHERE a.invoice_id = ANY(v_invoice_ids)
  ) candidate;
  FOR v_event_id IN
    SELECT DISTINCT id FROM unnest(v_event_ids) id WHERE id IS NOT NULL ORDER BY id
  LOOP
    PERFORM public.sync_event_invoice_lifecycle(v_event_id);
  END LOOP;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_event_invoice_lifecycle_after_change() FROM PUBLIC, anon, authenticated;

-- Deferred derivation sees the committed shape of invoice items, payments and
-- shared-event allocations, not intermediate DELETE+INSERT or partial inserts.
CREATE CONSTRAINT TRIGGER event_invoice_lifecycle_from_invoice
AFTER INSERT OR UPDATE OR DELETE ON public.invoices
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.refresh_event_invoice_lifecycle_after_change();

CREATE CONSTRAINT TRIGGER event_invoice_lifecycle_from_ksef
AFTER INSERT OR UPDATE OR DELETE ON public.ksef_invoices
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.refresh_event_invoice_lifecycle_after_change();

CREATE CONSTRAINT TRIGGER event_invoice_lifecycle_from_ksef_payment
AFTER INSERT OR UPDATE OR DELETE ON public.ksef_invoice_payments
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.refresh_event_invoice_lifecycle_after_change();

CREATE CONSTRAINT TRIGGER event_invoice_lifecycle_from_bank_match
AFTER INSERT OR UPDATE OR DELETE ON public.bank_transaction_invoice_matches
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.refresh_event_invoice_lifecycle_after_change();

CREATE CONSTRAINT TRIGGER event_invoice_lifecycle_from_allocation
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_event_allocations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.refresh_event_invoice_lifecycle_after_change();

CREATE CONSTRAINT TRIGGER event_invoice_lifecycle_from_advance_settlement
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_settlements
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.refresh_event_invoice_lifecycle_after_change();

-- Keep all unrelated workflow requirements and their permission model intact,
-- replacing only the two invoice gates with the same lifecycle evaluation.
DO $migration$
DECLARE
  v_definition text;
  v_original text;
BEGIN
  SELECT pg_get_functiondef('public.event_workflow_requirement_is_met(uuid,uuid)'::regprocedure)
  INTO v_original;
  v_definition := replace(v_original,
    $old$WHEN 'invoice_issued' THEN RETURN EXISTS (
      SELECT 1 FROM public.invoices invoice WHERE invoice.event_id = p_event_id AND invoice.status IN ('issued','sent','paid','overdue'));$old$,
    $new$WHEN 'invoice_issued' THEN RETURN public.event_invoice_lifecycle_state(p_event_id) IS NOT NULL;$new$);
  v_definition := replace(v_definition,
    $old$WHEN 'invoice_paid' THEN RETURN EXISTS (SELECT 1 FROM public.invoices invoice WHERE invoice.event_id = p_event_id AND invoice.status = 'paid');$old$,
    $new$WHEN 'invoice_paid' THEN RETURN COALESCE(public.event_invoice_lifecycle_state(p_event_id) = 'settled', false);$new$);
  IF v_definition = v_original
    OR position($new$WHEN 'invoice_issued' THEN RETURN public.event_invoice_lifecycle_state$new$ IN v_definition) = 0
    OR position($new$WHEN 'invoice_paid' THEN RETURN COALESCE(public.event_invoice_lifecycle_state$new$ IN v_definition) = 0
  THEN
    RAISE EXCEPTION 'Reguły workflow zmieniły się; wymagane bezpieczne połączenie reguł fakturowania przed wdrożeniem.';
  END IF;
  EXECUTE v_definition;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
COMMIT;
