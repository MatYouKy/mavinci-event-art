BEGIN;
SET LOCAL lock_timeout = '3s';
-- Use exactly the same payment evidence as the event lifecycle, including bank
-- matches and KSeF aliases. A paid status alone is not proof of receipt.
CREATE OR REPLACE FUNCTION public.event_payment_invoice_evidence(p_event_id uuid)
RETURNS TABLE(id uuid, confirmed_amount numeric, amount_due numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $evidence$
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

  )
 SELECT id, confirmed_amount, amount_due FROM evidence;
$evidence$;
REVOKE ALL ON FUNCTION public.event_payment_invoice_evidence(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_event_payment_plan_invoices(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Only unambiguous one-invoice / one-payment matches can be automated.
  WITH candidates AS (
    SELECT m.id AS milestone_id, i.id AS invoice_id,
      count(*) OVER (PARTITION BY m.id) AS milestone_matches,
      count(*) OVER (PARTITION BY i.id) AS invoice_matches
    FROM public.event_payment_milestones m
    JOIN public.invoices i ON i.event_id = m.event_id
    JOIN public.event_payment_invoice_evidence(p_event_id) evidence ON evidence.id = i.id
    WHERE m.event_id = p_event_id AND m.invoice_id IS NULL
      AND m.status NOT IN ('paid','waived') AND m.paid_amount = 0 AND m.paid_at IS NULL
      AND i.is_proforma IS NOT TRUE AND i.currency_code = 'PLN'
      AND i.status IN ('issued','sent','paid','overdue')
      AND ((m.milestone_type = 'deposit' AND i.invoice_type = 'advance')
        OR (m.milestone_type = 'balance' AND i.invoice_type IN ('vat','final')))
      AND abs(m.amount - evidence.amount_due) <= 0.01
      AND NOT EXISTS (SELECT 1 FROM public.event_payment_milestones linked WHERE linked.invoice_id = i.id)
      AND NOT EXISTS (SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id = i.id AND a.event_id <> p_event_id AND a.allocation_weight > 0)
  )
  UPDATE public.event_payment_milestones m SET invoice_id = c.invoice_id
  FROM candidates c WHERE m.id = c.milestone_id AND c.milestone_matches = 1 AND c.invoice_matches = 1;

  -- Re-run the projection for already linked payments, including partial payment reversals.
  UPDATE public.event_payment_milestones SET invoice_id = invoice_id
  WHERE event_id = p_event_id AND invoice_id IS NOT NULL AND status <> 'waived';
END;
$$;
REVOKE ALL ON FUNCTION public.sync_event_payment_plan_invoices(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.project_invoice_to_event_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE inv record; evidence record; active_invoice boolean;
BEGIN
  IF NEW.invoice_id IS NULL OR NEW.status = 'waived' THEN RETURN NEW; END IF;
  IF (TG_OP = 'INSERT' OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id)
    AND EXISTS (SELECT 1 FROM public.event_payment_milestones m WHERE m.invoice_id = NEW.invoice_id AND m.id <> NEW.id) THEN
    RAISE EXCEPTION 'Ta faktura jest już powiązana z inną płatnością. Nie można zliczyć tej samej wpłaty ponownie.';
  END IF;
  SELECT * INTO inv FROM public.invoices WHERE id = NEW.invoice_id;
  IF NOT FOUND OR inv.event_id IS DISTINCT FROM NEW.event_id OR inv.currency_code <> 'PLN'
    OR inv.is_proforma IS TRUE OR inv.invoice_type NOT IN ('vat','advance','final')
    OR EXISTS (SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id = inv.id AND a.event_id <> NEW.event_id AND a.allocation_weight > 0) THEN
    -- Do not distribute a shared or incompatible document's payment arbitrarily.
    IF TG_OP = 'INSERT' OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
      RAISE EXCEPTION 'Wybierz fakturę w PLN dotyczącą tylko tego wydarzenia, bez proformy i korekty.';
    END IF;
    RETURN NEW;
  END IF;
  active_invoice := inv.status IN ('issued','sent','paid','overdue');
  SELECT * INTO evidence FROM public.event_payment_invoice_evidence(NEW.event_id) e WHERE e.id = inv.id;
  NEW.paid_amount := CASE WHEN active_invoice THEN least(NEW.amount, greatest(coalesce(evidence.confirmed_amount,0),0)) ELSE 0 END;
  NEW.paid_at := CASE WHEN NEW.amount > 0 AND NEW.paid_amount >= NEW.amount - 0.01 THEN coalesce(NEW.paid_at,now()) ELSE NULL END;
  NEW.status := CASE WHEN NEW.paid_at IS NOT NULL THEN 'paid'
    WHEN NEW.due_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Warsaw')::date THEN 'overdue'
    WHEN active_invoice THEN 'invoiced' ELSE 'planned' END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.project_invoice_to_event_payment() FROM PUBLIC, anon, authenticated;
-- Alphabetical order: derive date -> refresh base status -> project actual receipt.
CREATE TRIGGER zz_project_invoice_to_event_payment
BEFORE INSERT OR UPDATE ON public.event_payment_milestones
FOR EACH ROW EXECUTE FUNCTION public.project_invoice_to_event_payment();
DROP TRIGGER IF EXISTS sync_paid_invoice_to_payment_milestone_trigger ON public.invoices;

DO $patch$
DECLARE definition text; needle text := '  v_target := public.event_invoice_lifecycle_state(p_event_id);';
BEGIN
  definition := pg_get_functiondef('public.sync_event_invoice_lifecycle(uuid)'::regprocedure);
  IF position(needle in definition) = 0 THEN RAISE EXCEPTION 'Zmieniona definicja synchronizacji wydarzenia — przerwano migrację.'; END IF;
  definition := replace(definition,needle,'  PERFORM public.sync_event_payment_plan_invoices(p_event_id);' || chr(10) || needle);
  EXECUTE definition;
END;
$patch$;

-- A plan created after its invoice was issued also needs a matching pass.
CREATE FUNCTION public.refresh_payment_plan_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.sync_event_invoice_lifecycle(NEW.event_id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_payment_plan_after_insert() FROM PUBLIC, anon, authenticated;
CREATE CONSTRAINT TRIGGER payment_plan_invoice_after_insert
AFTER INSERT ON public.event_payment_milestones DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.refresh_payment_plan_after_insert();

-- Read-time reconciliation repairs earlier issued documents without a global backfill.
CREATE FUNCTION public.refresh_event_payment_plan(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.can_view_event_commercials(p_event_id,true),false) THEN
    RAISE EXCEPTION 'Brak uprawnień do rozliczenia wydarzenia.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.sync_event_invoice_lifecycle(p_event_id);
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_event_payment_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_event_payment_plan(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
