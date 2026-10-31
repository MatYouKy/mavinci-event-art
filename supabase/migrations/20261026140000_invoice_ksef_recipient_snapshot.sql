BEGIN;

-- No historical backfill: the recipient is captured on new documents, issuance,
-- or explicitly before the first KSeF send of a legacy document.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS ksef_recipient_snapshot jsonb;

COMMENT ON COLUMN public.invoices.ksef_recipient_snapshot IS
  'Versioned Podmiot3 recipient data frozen with the invoice. SQL NULL means not captured; recipient:null means deliberately no additional recipient.';

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_ksef_recipient_snapshot_shape CHECK (
    ksef_recipient_snapshot IS NULL OR (
      jsonb_typeof(ksef_recipient_snapshot) = 'object'
      AND ksef_recipient_snapshot ? 'version'
      AND ksef_recipient_snapshot ->> 'version' = '1'
      AND ksef_recipient_snapshot ? 'recipient'
      AND (
        ksef_recipient_snapshot -> 'recipient' = 'null'::jsonb
        OR (
          jsonb_typeof(ksef_recipient_snapshot -> 'recipient') = 'object'
          AND (ksef_recipient_snapshot -> 'recipient') ? 'role'
          AND ksef_recipient_snapshot #>> '{recipient,role}' = '2'
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.build_invoice_ksef_recipient_snapshot(p_invoice public.invoices)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_organization public.organizations%ROWTYPE;
  v_source public.invoices%ROWTYPE;
  v_internal_id text;
  v_country text;
BEGIN
  -- A correction starts from the original immutable recipient, not from a
  -- contact card which may have been edited after the original was issued.
  IF p_invoice.invoice_type = 'corrective' AND p_invoice.related_invoice_id IS NOT NULL THEN
    SELECT * INTO v_source FROM public.invoices
    WHERE id = p_invoice.related_invoice_id FOR SHARE;
    IF FOUND AND v_source.ksef_recipient_snapshot IS NOT NULL
      AND ROW(p_invoice.organization_id, p_invoice.service_recipient_organization_id,
              p_invoice.service_recipient_contact_id, p_invoice.billing_arrangement)
        IS NOT DISTINCT FROM
          ROW(v_source.organization_id, v_source.service_recipient_organization_id,
              v_source.service_recipient_contact_id, v_source.billing_arrangement)
    THEN
      RETURN v_source.ksef_recipient_snapshot;
    END IF;
  END IF;

  IF p_invoice.service_recipient_organization_id IS NULL THEN
    RETURN jsonb_build_object('version', 1, 'recipient', NULL);
  END IF;

  SELECT * INTO v_organization FROM public.organizations
  WHERE id = p_invoice.service_recipient_organization_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nie znaleziono organizacji odbiorcy faktury.' USING ERRCODE = '23503';
  END IF;

  v_internal_id := NULLIF(btrim(v_organization.ksef_internal_id), '');
  -- Equal NIP does NOT mean equal recipient: an organizational branch can use
  -- the buyer's NIP together with its own KSeF internal identifier.
  IF p_invoice.service_recipient_organization_id = p_invoice.organization_id
     AND v_internal_id IS NULL THEN
    RETURN jsonb_build_object('version', 1, 'recipient', NULL);
  END IF;

  v_country := upper(COALESCE(NULLIF(btrim(v_organization.country), ''), 'PL'));
  v_country := CASE v_country
    WHEN 'POLSKA' THEN 'PL' WHEN 'POLAND' THEN 'PL'
    WHEN 'NIEMCY' THEN 'DE' WHEN 'GERMANY' THEN 'DE' WHEN 'DEUTSCHLAND' THEN 'DE'
    WHEN 'CZECHY' THEN 'CZ' WHEN 'CZECHIA' THEN 'CZ' WHEN 'CZECH REPUBLIC' THEN 'CZ'
    WHEN 'SŁOWACJA' THEN 'SK' WHEN 'SLOVAKIA' THEN 'SK'
    WHEN 'WIELKA BRYTANIA' THEN 'GB' WHEN 'UNITED KINGDOM' THEN 'GB' WHEN 'UK' THEN 'GB'
    ELSE v_country END;

  RETURN jsonb_build_object('version', 1, 'recipient', jsonb_build_object(
    'organizationId', v_organization.id,
    'name', btrim(COALESCE(v_organization.name, '')),
    'nip', NULLIF(btrim(v_organization.nip), ''),
    'internalId', v_internal_id,
    'street', btrim(COALESCE(v_organization.address, '')),
    'postalCode', btrim(COALESCE(v_organization.postal_code, '')),
    'city', btrim(COALESCE(v_organization.city, '')),
    'countryCode', v_country,
    'role', 2
  ));
END;
$$;
REVOKE ALL ON FUNCTION public.build_invoice_ksef_recipient_snapshot(public.invoices)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.capture_invoice_ksef_recipient_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ksef_locked boolean;
  v_issued boolean;
  v_context_changed boolean;
  v_explicit_capture boolean;
  v_initial_snapshot jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_initial_snapshot := NEW.ksef_recipient_snapshot;
    NEW.ksef_recipient_snapshot := public.build_invoice_ksef_recipient_snapshot(NEW);
    IF NEW.ksef_recipient_snapshot IS DISTINCT FROM v_initial_snapshot THEN
      NEW.pdf_url := NULL;
    END IF;
    RETURN NEW;
  END IF;

  v_ksef_locked := COALESCE(OLD.ksef_status, '') IN ('pending', 'accepted')
    OR NULLIF(btrim(OLD.ksef_reference_number), '') IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.ksef_invoices k
      WHERE k.invoice_id = OLD.id AND k.sync_status = 'synced');
  v_issued := v_ksef_locked OR OLD.status IN ('issued', 'sent', 'paid', 'overdue', 'cancelled');
  v_context_changed := ROW(NEW.organization_id, NEW.service_recipient_organization_id,
    NEW.service_recipient_contact_id, NEW.billing_arrangement, NEW.buyer_is_private_person)
    IS DISTINCT FROM ROW(OLD.organization_id, OLD.service_recipient_organization_id,
    OLD.service_recipient_contact_id, OLD.billing_arrangement, OLD.buyer_is_private_person);
  v_explicit_capture := current_setting('mavinci.invoice_ksef_recipient_capture', true) = OLD.id::text;

  IF v_issued AND v_context_changed THEN
    RAISE EXCEPTION 'Dane odbiorcy wystawionej faktury są zapisane na dokumencie. Zmianę wprowadź fakturą korygującą.'
      USING ERRCODE = '55000';
  END IF;

  IF v_ksef_locked THEN
    IF NEW.ksef_recipient_snapshot IS DISTINCT FROM OLD.ksef_recipient_snapshot THEN
      RAISE EXCEPTION 'Nie można zmienić odbiorcy dokumentu wysyłanego lub przyjętego przez KSeF.'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF v_issued THEN
    IF OLD.ksef_recipient_snapshot IS NULL AND v_explicit_capture THEN
      NEW.ksef_recipient_snapshot := public.build_invoice_ksef_recipient_snapshot(NEW);
    ELSIF NEW.ksef_recipient_snapshot IS DISTINCT FROM OLD.ksef_recipient_snapshot THEN
      RAISE EXCEPTION 'Dane odbiorcy wystawionej faktury są niezmienne.' USING ERRCODE = '55000';
    END IF;
    IF NEW.ksef_recipient_snapshot IS DISTINCT FROM OLD.ksef_recipient_snapshot THEN
      NEW.pdf_url := NULL;
    END IF;
    -- In particular, marking an invoice paid must never refresh its recipient.
    RETURN NEW;
  END IF;

  IF v_context_changed OR v_explicit_capture
    OR (NEW.status IN ('issued', 'sent', 'paid', 'overdue') AND OLD.status NOT IN ('issued', 'sent', 'paid', 'overdue'))
    OR (NEW.ksef_status = 'pending' AND OLD.ksef_status IS DISTINCT FROM 'pending')
  THEN
    NEW.ksef_recipient_snapshot := public.build_invoice_ksef_recipient_snapshot(NEW);
  ELSIF NEW.ksef_recipient_snapshot IS DISTINCT FROM OLD.ksef_recipient_snapshot THEN
    RAISE EXCEPTION 'Dane odbiorcy są zapisywane automatycznie z wybranej organizacji.' USING ERRCODE = '55000';
  END IF;
  IF NEW.ksef_recipient_snapshot IS DISTINCT FROM OLD.ksef_recipient_snapshot THEN
    NEW.pdf_url := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_invoice_ksef_recipient_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_capture_invoice_ksef_recipient_snapshot
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.capture_invoice_ksef_recipient_snapshot();

CREATE OR REPLACE FUNCTION public.ensure_invoice_ksef_recipient_snapshot(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_snapshot jsonb;
  v_previous_capture text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
    AND (auth.uid() IS NULL OR NOT COALESCE(public.can_manage_invoice(p_invoice_id), false)) THEN
    RAISE EXCEPTION 'Brak uprawnień do przygotowania tej faktury do KSeF.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono faktury.'; END IF;
  IF COALESCE(v_invoice.is_proforma, false) OR v_invoice.invoice_type = 'proforma'
    OR v_invoice.status = 'cancelled' THEN
    RAISE EXCEPTION 'Tego dokumentu nie można przygotować do wysyłki do KSeF.';
  END IF;
  IF v_invoice.ksef_status IN ('pending', 'accepted')
    OR NULLIF(btrim(v_invoice.ksef_reference_number), '') IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.ksef_invoices k
      WHERE k.invoice_id = p_invoice_id AND k.sync_status = 'synced') THEN
    RAISE EXCEPTION 'Dokument jest już wysyłany albo został przyjęty przez KSeF.' USING ERRCODE = '55000';
  END IF;

  IF v_invoice.ksef_recipient_snapshot IS NOT NULL
    AND v_invoice.status IN ('issued', 'sent', 'paid', 'overdue') THEN
    RETURN v_invoice.ksef_recipient_snapshot;
  END IF;

  v_snapshot := public.build_invoice_ksef_recipient_snapshot(v_invoice);
  IF v_snapshot IS DISTINCT FROM v_invoice.ksef_recipient_snapshot THEN
    v_previous_capture := current_setting('mavinci.invoice_ksef_recipient_capture', true);
    PERFORM set_config('mavinci.invoice_ksef_recipient_capture', p_invoice_id::text, true);
    UPDATE public.invoices SET ksef_recipient_snapshot = v_snapshot, updated_at = now()
    WHERE id = p_invoice_id RETURNING ksef_recipient_snapshot INTO v_snapshot;
    PERFORM set_config('mavinci.invoice_ksef_recipient_capture', COALESCE(v_previous_capture, ''), true);

    INSERT INTO public.invoice_history (invoice_id, action, changed_by, changes)
    VALUES (p_invoice_id, 'ksef_recipient_captured', public.current_invoice_employee_id(),
      jsonb_build_object('snapshot_version', 1, 'has_recipient', v_snapshot -> 'recipient' <> 'null'::jsonb));
  END IF;
  RETURN v_snapshot;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_invoice_ksef_recipient_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_invoice_ksef_recipient_snapshot(uuid) TO authenticated, service_role;

-- Keep the existing duplicate-send logic, but expose an authorized, optimistic
-- claim which checks the exact recipient snapshot used for the preflight.
CREATE OR REPLACE FUNCTION public.begin_ksef_send_with_snapshot_atomic(
  p_invoice_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_snapshot jsonb,
  p_actor uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_actor uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
    AND (auth.uid() IS NULL OR NOT COALESCE(public.can_manage_invoice(p_invoice_id), false)) THEN
    RAISE EXCEPTION 'Brak uprawnień do wysłania tej faktury do KSeF.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono faktury.'; END IF;
  IF p_expected_snapshot IS NULL OR v_invoice.ksef_recipient_snapshot IS NULL
    OR v_invoice.ksef_recipient_snapshot IS DISTINCT FROM p_expected_snapshot
    OR v_invoice.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Dane faktury zmieniły się podczas przygotowania wysyłki. Odśwież fakturę i spróbuj ponownie.'
      USING ERRCODE = '40001';
  END IF;
  v_actor := CASE WHEN auth.role() = 'service_role' THEN p_actor ELSE public.current_invoice_employee_id() END;
  RETURN public.begin_ksef_send_atomic(p_invoice_id, v_actor);
END;
$$;
REVOKE ALL ON FUNCTION public.begin_ksef_send_with_snapshot_atomic(uuid, timestamptz, jsonb, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_ksef_send_with_snapshot_atomic(uuid, timestamptz, jsonb, uuid)
  TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.begin_ksef_send_atomic(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_ksef_send_atomic(uuid, uuid) TO service_role;

-- The older core-field guard remains in place. During a pending request the
-- additional XML inputs must also stay fixed; after acceptance normal payment
-- reconciliation is still allowed.
CREATE OR REPLACE FUNCTION public.protect_pending_ksef_invoice_inputs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.ksef_status = 'pending' AND ROW(
    NEW.payment_method, NEW.payment_due_date, NEW.paid_date, NEW.paid_amount,
    NEW.payment_status, NEW.paid_at, NEW.manual_paid_amount, NEW.bank_account,
    NEW.bank_name, NEW.bank_swift_code, NEW.notes, NEW.footer_note,
    NEW.invoice_footer_text, NEW.buyer_is_private_person, NEW.issue_place,
    NEW.corrected_invoice_was_in_ksef, NEW.original_invoice_number,
    NEW.original_invoice_date, NEW.correction_scope
  ) IS DISTINCT FROM ROW(
    OLD.payment_method, OLD.payment_due_date, OLD.paid_date, OLD.paid_amount,
    OLD.payment_status, OLD.paid_at, OLD.manual_paid_amount, OLD.bank_account,
    OLD.bank_name, OLD.bank_swift_code, OLD.notes, OLD.footer_note,
    OLD.invoice_footer_text, OLD.buyer_is_private_person, OLD.issue_place,
    OLD.corrected_invoice_was_in_ksef, OLD.original_invoice_number,
    OLD.original_invoice_date, OLD.correction_scope
  ) THEN
    RAISE EXCEPTION 'Trwa wysyłka do KSeF. Poczekaj na jej wynik przed zmianą danych faktury lub płatności.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_pending_ksef_invoice_inputs()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER zzz_protect_pending_ksef_invoice_inputs
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.protect_pending_ksef_invoice_inputs();

-- Serialize item edits with the parent send claim, including edits which do
-- not alter totals. Keep the original accepted-item guard unchanged.
CREATE OR REPLACE FUNCTION public.lock_invoice_parent_before_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_id uuid;
  v_new_id uuid;
  v_invoice record;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old_id := OLD.invoice_id; END IF;
  IF TG_OP <> 'DELETE' THEN v_new_id := NEW.invoice_id; END IF;
  FOR v_invoice IN
    SELECT i.id, i.ksef_status, i.ksef_reference_number
    FROM public.invoices i WHERE i.id IN (v_old_id, v_new_id)
    ORDER BY i.id FOR UPDATE
  LOOP
    IF v_invoice.ksef_status IN ('pending', 'accepted')
      OR NULLIF(btrim(v_invoice.ksef_reference_number), '') IS NOT NULL THEN
      RAISE EXCEPTION 'Pozycji faktury wysyłanej lub przyjętej przez KSeF nie można zmieniać. Wystaw fakturę korygującą.'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_invoice_parent_before_item_change()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER aaa_lock_invoice_before_item_change
BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.lock_invoice_parent_before_item_change();

CREATE TRIGGER aaa_lock_invoice_before_order_item_change
BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_order_items
FOR EACH ROW EXECUTE FUNCTION public.lock_invoice_parent_before_item_change();

NOTIFY pgrst, 'reload schema';
COMMIT;
