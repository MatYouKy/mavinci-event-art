BEGIN;

-- A pro forma is not a second receivable or receipt. Keep its document status
-- and zero manual ledger balance; project only the payment display from the
-- one fully paid advance created for it. No historical backfill is performed.
CREATE OR REPLACE FUNCTION public.project_proforma_advance_payment_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_targets bigint;
  v_received_date date;
BEGIN
  IF NOT COALESCE(NEW.is_proforma, false) THEN RETURN NEW; END IF;

  IF NEW.status IN ('draft', 'proforma') THEN
    NEW.manual_paid_amount := 0;
    NEW.payment_status := 'unpaid';
    NEW.paid_amount := 0;
    NEW.paid_date := NULL;
    NEW.paid_at := NULL;

    -- Real pro formas cannot be KSeF aliases. This also prevents the existing
    -- local-to-KSeF payment forwarding trigger from creating a second receipt.
    IF NEW.total_gross > 0
       AND NEW.my_company_id IS NOT NULL
       AND NULLIF(BTRIM(NEW.ksef_reference_number), '') IS NULL THEN
      SELECT COUNT(*), MIN(CASE WHEN
        target.invoice_type = 'advance'
        AND NOT COALESCE(target.is_proforma, false)
        AND target.status IN ('issued', 'sent', 'paid', 'overdue')
        AND target.my_company_id = NEW.my_company_id
        AND target.organization_id IS NOT DISTINCT FROM NEW.organization_id
        AND COALESCE(target.currency_code, 'PLN') = COALESCE(NEW.currency_code, 'PLN')
        AND ABS(target.total_net - NEW.total_net) <= 0.01
        AND ABS(target.total_vat - NEW.total_vat) <= 0.01
        AND ABS(target.total_gross - NEW.total_gross) <= 0.01
        AND public.invoice_confirmed_received_amount(target.id) >= NEW.total_gross - 0.01
        AND COALESCE(target.paid_date, target.paid_at::date) <= CURRENT_DATE
        AND COALESCE(target.paid_date, target.paid_at::date) <= target.issue_date
        THEN COALESCE(target.paid_date, target.paid_at::date)
        ELSE NULL END)
      INTO v_targets, v_received_date
      FROM public.invoice_source_links link
      JOIN public.invoices target ON target.id = link.target_invoice_id
      WHERE link.source_invoice_id = NEW.id
        AND link.link_type = 'proforma_to_advance'
        AND target.status <> 'cancelled';

      IF v_targets = 1 AND v_received_date IS NOT NULL THEN
        -- Conversion also supports a draft pro forma. Only a real, fully paid
        -- advance can promote it; a draft advance or a paid label cannot.
        NEW.status := 'proforma';
        NEW.payment_status := 'paid';
        NEW.paid_amount := NEW.total_gross;
        NEW.paid_date := v_received_date;
        NEW.paid_at := v_received_date::timestamptz;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.payment_status, NEW.paid_amount, NEW.paid_date, NEW.paid_at)
       IS DISTINCT FROM ROW(OLD.payment_status, OLD.paid_amount, OLD.paid_date, OLD.paid_at) THEN
      -- Regenerate the visualization instead of serving an unpaid cached PDF.
      NEW.pdf_url := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.project_proforma_advance_payment_state()
  FROM PUBLIC, anon, authenticated;

-- Runs after trg_capture_invoice_manual_paid_amount and
-- trg_normalize_invoice_payment_state, before the existing sales write guard.
CREATE TRIGGER zz_project_proforma_advance_payment
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.project_proforma_advance_payment_state();

CREATE OR REPLACE FUNCTION public.refresh_proforma_advance_payment_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_source_ids uuid[] := ARRAY[]::uuid[];
  v_source_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'invoice_source_links' THEN
    IF TG_OP <> 'INSERT' THEN
      IF OLD.link_type = 'proforma_to_advance' THEN
        v_source_ids := array_append(v_source_ids, OLD.source_invoice_id);
      END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      IF NEW.link_type = 'proforma_to_advance' THEN
        v_source_ids := array_append(v_source_ids, NEW.source_invoice_id);
      END IF;
    END IF;
  ELSE
    IF OLD.invoice_type IS DISTINCT FROM 'advance'
       AND NEW.invoice_type IS DISTINCT FROM 'advance' THEN RETURN NULL; END IF;
    IF ROW(NEW.status, NEW.payment_status, NEW.paid_amount, NEW.manual_paid_amount,
           NEW.paid_date, NEW.paid_at, NEW.total_net, NEW.total_vat, NEW.total_gross,
           NEW.my_company_id, NEW.organization_id, NEW.currency_code,
           NEW.invoice_type, NEW.is_proforma, NEW.issue_date)
       IS NOT DISTINCT FROM ROW(OLD.status, OLD.payment_status, OLD.paid_amount, OLD.manual_paid_amount,
           OLD.paid_date, OLD.paid_at, OLD.total_net, OLD.total_vat, OLD.total_gross,
           OLD.my_company_id, OLD.organization_id, OLD.currency_code,
           OLD.invoice_type, OLD.is_proforma, OLD.issue_date) THEN RETURN NULL; END IF;
    SELECT COALESCE(array_agg(DISTINCT link.source_invoice_id), ARRAY[]::uuid[])
    INTO v_source_ids
    FROM public.invoice_source_links link
    WHERE link.target_invoice_id = NEW.id AND link.link_type = 'proforma_to_advance';
  END IF;

  FOR v_source_id IN SELECT DISTINCT source_id FROM unnest(v_source_ids) AS ids(source_id)
  LOOP
    -- The usual normalizer clears stale payment state; the projection above
    -- restores it only if a valid paid advance still exists. Insertion of the
    -- conversion link and this update are in the same transaction as issuance.
    -- Existing ownership/company guards remain in force for this update.
    UPDATE public.invoices
    SET payment_status = payment_status, updated_at = now()
    WHERE id = v_source_id AND is_proforma AND status IN ('draft', 'proforma');
  END LOOP;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_proforma_advance_payment_state()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER refresh_proforma_payment_from_source_link
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_source_links
FOR EACH ROW EXECUTE FUNCTION public.refresh_proforma_advance_payment_state();

CREATE TRIGGER zz_refresh_proforma_payment_from_advance
AFTER UPDATE OF status, payment_status, paid_amount, manual_paid_amount,
  paid_date, paid_at, total_net, total_vat, total_gross, my_company_id,
  organization_id, currency_code, invoice_type, is_proforma, issue_date
ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.refresh_proforma_advance_payment_state();

COMMIT;
