BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '25s';

-- Future-only data corrections. No invoice is created, sent or backfilled here.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS correction_kind text,
  ADD COLUMN IF NOT EXISTS correction_party_data_before jsonb;
COMMENT ON COLUMN public.invoices.correction_kind IS
  'party_data changes buyer/recipient details without any monetary adjustment; amount and legacy NULL retain the existing monetary correction behaviour.';
COMMENT ON COLUMN public.invoices.correction_party_data_before IS
  'Versioned immutable buyer/recipient BEFORE snapshot, captured server-side from the source invoice. Never supplied by the client or read from current CRM contacts.';

ALTER TABLE public.invoices
  ALTER COLUMN payment_due_date DROP NOT NULL,
  ALTER COLUMN payment_method DROP NOT NULL,
  DROP CONSTRAINT invoices_payment_status_check,
  ADD CONSTRAINT invoices_payment_status_check CHECK (payment_status IN (
    'unpaid', 'partially_paid', 'paid', 'overdue', 'refund_due',
    'partially_refunded', 'refunded', 'not_applicable'
  )),
  ADD CONSTRAINT invoices_correction_kind_check CHECK (
    correction_kind IS NULL OR (invoice_type = 'corrective' AND correction_kind IN ('amount', 'party_data'))
  ),
  ADD CONSTRAINT invoices_party_data_correction_state CHECK (COALESCE(
    (correction_kind IS DISTINCT FROM 'party_data'
      AND correction_party_data_before IS NULL
      AND payment_status IS DISTINCT FROM 'not_applicable'
      AND payment_due_date IS NOT NULL AND payment_method IS NOT NULL)
    OR (correction_kind = 'party_data' AND invoice_type = 'corrective'
      AND related_invoice_id IS NOT NULL AND is_proforma IS FALSE
      AND total_net = 0 AND total_vat = 0 AND total_gross = 0
      AND paid_amount = 0 AND manual_paid_amount = 0
      AND paid_at IS NULL AND paid_date IS NULL
      AND payment_status = 'not_applicable'
      AND payment_due_date IS NULL AND payment_method IS NULL
      AND status IN ('draft', 'issued', 'sent', 'cancelled')
      AND correction_type IS NULL
      AND order_total_net IS NULL AND order_total_vat IS NULL AND order_total_gross IS NULL
      AND settled_invoices IS NULL AND settlement_summary IS NULL
      AND invoice_recipient_mode IS NOT NULL
      AND jsonb_typeof(correction_party_data_before) = 'object'
      AND correction_party_data_before -> 'version' = '1'::jsonb
      AND jsonb_typeof(correction_party_data_before -> 'buyer') = 'object'
      AND correction_party_data_before ? 'recipient'
      AND (correction_party_data_before -> 'recipient' = 'null'::jsonb
        OR jsonb_typeof(correction_party_data_before -> 'recipient') = 'object')),
    false
  ));

CREATE UNIQUE INDEX uq_invoice_active_party_data_correction
  ON public.invoices (related_invoice_id)
  WHERE correction_kind = 'party_data' AND (
    status IS DISTINCT FROM 'cancelled' OR ksef_status IN ('pending', 'accepted')
    OR NULLIF(btrim(ksef_reference_number), '') IS NOT NULL
  );

CREATE FUNCTION public.guard_invoice_party_data_correction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE
  v_source public.invoices%ROWTYPE;
  v_conflict record;
  v_country text;
  v_nip text;
  v_frozen boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.correction_kind IS DISTINCT FROM NEW.correction_kind
      AND (OLD.correction_kind = 'party_data' OR NEW.correction_kind = 'party_data') THEN
      RAISE EXCEPTION 'Nie można zmienić istniejącego dokumentu na inny rodzaj korekty. Utwórz osobny szkic.' USING ERRCODE = '55000';
    END IF;
    IF OLD.correction_kind = 'party_data' THEN
      IF NEW.related_invoice_id IS DISTINCT FROM OLD.related_invoice_id
        OR NEW.correction_party_data_before IS DISTINCT FROM OLD.correction_party_data_before THEN
        RAISE EXCEPTION 'Dokument źródłowy i dane przed korektą są niezmienne.' USING ERRCODE = '55000';
      END IF;
      v_frozen := OLD.status IN ('issued', 'sent', 'paid', 'overdue', 'cancelled')
        OR OLD.ksef_status IN ('pending', 'accepted')
        OR NULLIF(btrim(OLD.ksef_reference_number), '') IS NOT NULL;
      IF v_frozen AND ROW(
        NEW.invoice_type, NEW.invoice_number, NEW.issue_date, NEW.sale_date,
        NEW.event_id, NEW.my_company_id, NEW.currency_code, NEW.organization_id,
        NEW.buyer_name, NEW.buyer_nip, NEW.buyer_street, NEW.buyer_postal_code,
        NEW.buyer_city, NEW.buyer_country, NEW.buyer_is_private_person,
        NEW.seller_name, NEW.seller_nip, NEW.seller_street, NEW.seller_postal_code,
        NEW.seller_city, NEW.seller_country, NEW.correction_reason,
        NEW.correction_type, NEW.correction_scope, NEW.corrected_invoice_number,
        NEW.corrected_invoice_issue_date, NEW.corrected_invoice_ksef_number,
        NEW.corrected_invoice_was_in_ksef
      ) IS DISTINCT FROM ROW(
        OLD.invoice_type, OLD.invoice_number, OLD.issue_date, OLD.sale_date,
        OLD.event_id, OLD.my_company_id, OLD.currency_code, OLD.organization_id,
        OLD.buyer_name, OLD.buyer_nip, OLD.buyer_street, OLD.buyer_postal_code,
        OLD.buyer_city, OLD.buyer_country, OLD.buyer_is_private_person,
        OLD.seller_name, OLD.seller_nip, OLD.seller_street, OLD.seller_postal_code,
        OLD.seller_city, OLD.seller_country, OLD.correction_reason,
        OLD.correction_type, OLD.correction_scope, OLD.corrected_invoice_number,
        OLD.corrected_invoice_issue_date, OLD.corrected_invoice_ksef_number,
        OLD.corrected_invoice_was_in_ksef
      ) THEN
        RAISE EXCEPTION 'Wystawionej korekty danych nie można edytować.' USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  IF NEW.correction_kind IS DISTINCT FROM 'party_data' THEN
    IF NEW.correction_party_data_before IS NOT NULL THEN
      RAISE EXCEPTION 'Stan danych przed korektą dotyczy wyłącznie korekty danych stron.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.invoice_type IS DISTINCT FROM 'corrective' OR NEW.related_invoice_id IS NULL
    OR NEW.is_proforma IS TRUE OR NULLIF(btrim(NEW.correction_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Korekta danych wymaga wystawionej faktury źródłowej i przyczyny korekty.' USING ERRCODE = '23514';
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
    AND (auth.uid() IS NULL OR NOT COALESCE(public.can_manage_invoice(NEW.related_invoice_id), false)) THEN
    RAISE EXCEPTION 'Brak uprawnień do korekty tej faktury źródłowej.' USING ERRCODE = '42501';
  END IF;

  -- Serializes simultaneous creations for the same source and reads only the
  -- source invoice. In particular, do not call the snapshot-ensure RPC here.
  SELECT * INTO v_source FROM public.invoices WHERE id = NEW.related_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_source.status NOT IN ('issued', 'sent', 'paid', 'overdue')
    OR v_source.is_proforma IS TRUE OR v_source.invoice_type = 'proforma'
    OR v_source.ksef_status = 'pending' THEN
    RAISE EXCEPTION 'Dokument źródłowy nie jest wystawioną fakturą albo trwa jego wysyłka do KSeF.' USING ERRCODE = '55000';
  END IF;
  IF v_source.correction_kind = 'party_data' THEN
    RAISE EXCEPTION 'Kolejna korekta danych wymaga sprawdzenia poprzedniej korekty. Ten formularz nie obsługuje łańcucha korekt danych.' USING ERRCODE = '55000';
  END IF;
  SELECT i.id, i.invoice_number INTO v_conflict FROM public.invoices i
  WHERE i.related_invoice_id = NEW.related_invoice_id AND i.id <> NEW.id
    AND i.correction_kind = 'party_data' AND (
      i.status IS DISTINCT FROM 'cancelled' OR i.ksef_status IN ('pending', 'accepted')
      OR NULLIF(btrim(i.ksef_reference_number), '') IS NOT NULL
    ) LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Dla tej faktury istnieje już korekta danych %. Otwórz ją zamiast tworzyć kolejną.', v_conflict.invoice_number USING ERRCODE = '23505';
  END IF;
  IF NEW.my_company_id IS DISTINCT FROM v_source.my_company_id
    OR NEW.event_id IS DISTINCT FROM v_source.event_id
    OR NEW.currency_code IS DISTINCT FROM v_source.currency_code THEN
    RAISE EXCEPTION 'Korekta danych musi zachować sprzedawcę, wydarzenie i walutę faktury źródłowej.' USING ERRCODE = '23514';
  END IF;

  v_nip := regexp_replace(COALESCE(v_source.buyer_nip, ''), '[^0-9]', '', 'g');
  IF v_nip !~ '^[0-9]{10}$' OR NEW.buyer_is_private_person IS TRUE
    OR regexp_replace(COALESCE(NEW.buyer_nip, ''), '[^0-9]', '', 'g') IS DISTINCT FROM v_nip THEN
    RAISE EXCEPTION 'Ten tryb poprawia dane tego samego podatnika. NIP nabywcy musi pozostać zgodny z fakturą źródłową.' USING ERRCODE = '23514';
  END IF;
  IF NEW.invoice_recipient_mode IS NULL THEN
    RAISE EXCEPTION 'Potwierdź jawnie, czy nabywca i odbiorca są tacy sami, czy mają osobne dane.' USING ERRCODE = '23514';
  END IF;
  IF NEW.status NOT IN ('draft', 'issued', 'sent', 'cancelled')
    OR COALESCE(NEW.total_net, 0) <> 0 OR COALESCE(NEW.total_vat, 0) <> 0 OR COALESCE(NEW.total_gross, 0) <> 0
    OR COALESCE(NEW.paid_amount, 0) <> 0 OR COALESCE(NEW.manual_paid_amount, 0) <> 0
    OR NEW.paid_at IS NOT NULL OR NEW.paid_date IS NOT NULL
    OR NEW.order_total_net IS NOT NULL OR NEW.order_total_vat IS NOT NULL OR NEW.order_total_gross IS NOT NULL
    OR NEW.settled_invoices IS NOT NULL OR NEW.settlement_summary IS NOT NULL THEN
    RAISE EXCEPTION 'Korekta danych nie może zawierać kwot, zaliczek ani płatności. Wartość faktury źródłowej pozostaje bez zmian.' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_source.ksef_recipient_snapshot IS NULL
      OR v_source.ksef_recipient_snapshot -> 'version' IS DISTINCT FROM '1'::jsonb
      OR NOT (v_source.ksef_recipient_snapshot ? 'recipient') THEN
      RAISE EXCEPTION 'Faktura źródłowa nie ma utrwalonych danych odbiorcy. Najpierw zweryfikuj archiwalny dokument KSeF; nie pobieramy danych przed korektą z bieżącej organizacji.' USING ERRCODE = '55000';
    END IF;
    v_country := upper(COALESCE(NULLIF(btrim(v_source.buyer_country), ''), 'PL'));
    v_country := CASE v_country
      WHEN 'POLSKA' THEN 'PL' WHEN 'POLAND' THEN 'PL'
      WHEN 'NIEMCY' THEN 'DE' WHEN 'GERMANY' THEN 'DE' WHEN 'DEUTSCHLAND' THEN 'DE'
      WHEN 'CZECHY' THEN 'CZ' WHEN 'CZECHIA' THEN 'CZ' WHEN 'CZECH REPUBLIC' THEN 'CZ'
      WHEN 'SŁOWACJA' THEN 'SK' WHEN 'SLOVAKIA' THEN 'SK'
      WHEN 'WIELKA BRYTANIA' THEN 'GB' WHEN 'UNITED KINGDOM' THEN 'GB' WHEN 'UK' THEN 'GB'
      ELSE v_country END;
    NEW.correction_party_data_before := jsonb_build_object(
      'version', 1,
      'buyer', jsonb_build_object(
        'name', btrim(COALESCE(v_source.buyer_name, '')), 'nip', v_nip,
        'street', btrim(COALESCE(v_source.buyer_street, '')),
        'postalCode', btrim(COALESCE(v_source.buyer_postal_code, '')),
        'city', btrim(COALESCE(v_source.buyer_city, '')), 'countryCode', v_country
      ),
      'recipient', v_source.ksef_recipient_snapshot -> 'recipient'
    );
    NEW.seller_name := v_source.seller_name;
    NEW.seller_nip := v_source.seller_nip;
    NEW.seller_street := v_source.seller_street;
    NEW.seller_postal_code := v_source.seller_postal_code;
    NEW.seller_city := v_source.seller_city;
    NEW.seller_country := v_source.seller_country;
    NEW.seller_email := v_source.seller_email;
    NEW.seller_phone := v_source.seller_phone;
    NEW.corrected_invoice_number := v_source.invoice_number;
    NEW.corrected_invoice_issue_date := v_source.issue_date;
    NEW.corrected_invoice_ksef_number := v_source.ksef_reference_number;
    NEW.corrected_invoice_was_in_ksef := v_source.ksef_status = 'accepted'
      OR NULLIF(btrim(v_source.ksef_reference_number), '') IS NOT NULL;
    NEW.pdf_url := NULL;
  ELSIF ROW(NEW.buyer_name, NEW.buyer_nip, NEW.buyer_street, NEW.buyer_postal_code,
    NEW.buyer_city, NEW.buyer_country) IS DISTINCT FROM ROW(OLD.buyer_name, OLD.buyer_nip,
    OLD.buyer_street, OLD.buyer_postal_code, OLD.buyer_city, OLD.buyer_country) THEN
    NEW.pdf_url := NULL;
  END IF;
  NEW.correction_type := NULL;
  NEW.total_net := 0; NEW.total_vat := 0; NEW.total_gross := 0;
  NEW.payment_status := 'not_applicable';
  NEW.paid_amount := 0; NEW.manual_paid_amount := 0;
  NEW.payment_due_date := NULL; NEW.payment_method := NULL;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_invoice_party_data_correction() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER aaa_guard_invoice_party_data_correction
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_party_data_correction();

CREATE FUNCTION public.prevent_party_data_correction_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
BEGIN
  PERFORM 1 FROM public.invoices i
  WHERE i.id = NEW.invoice_id AND i.correction_kind = 'party_data' FOR SHARE;
  IF FOUND THEN
    RAISE EXCEPTION 'Korekta danych stron nie zawiera pozycji ani zmian wartości zamówienia.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.prevent_party_data_correction_items() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER aab_prevent_party_data_correction_items
BEFORE INSERT OR UPDATE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.prevent_party_data_correction_items();
CREATE TRIGGER aab_prevent_party_data_correction_order_items
BEFORE INSERT OR UPDATE ON public.invoice_order_items
FOR EACH ROW EXECUTE FUNCTION public.prevent_party_data_correction_items();

CREATE FUNCTION public.prevent_party_data_correction_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE v_invoice_id uuid; v_ksef_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'bank_transaction_invoice_matches' THEN
    v_invoice_id := NEW.invoice_id;
  END IF;
  v_ksef_id := NEW.ksef_invoice_id;
  PERFORM 1 FROM public.invoices i
  WHERE i.correction_kind = 'party_data' AND (
    i.id = v_invoice_id OR i.id = (SELECT k.invoice_id FROM public.ksef_invoices k WHERE k.id = v_ksef_id)
  ) FOR SHARE;
  IF FOUND THEN
    RAISE EXCEPTION 'Do korekty danych stron nie przypisuje się płatności. Rozlicz wpłatę z fakturą źródłową.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.prevent_party_data_correction_payment() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER aaa_prevent_party_data_correction_bank_match
BEFORE INSERT OR UPDATE ON public.bank_transaction_invoice_matches
FOR EACH ROW EXECUTE FUNCTION public.prevent_party_data_correction_payment();
CREATE TRIGGER aaa_prevent_party_data_correction_payment
BEFORE INSERT OR UPDATE ON public.ksef_invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.prevent_party_data_correction_payment();

-- Extend current RPCs in place: keep all deployed authorization/numbering rules.
DO $migration$
DECLARE
  v_signature text; v_definition text; v_original text; v_replacement text;
  v_items_old text := $old$  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Dokument musi zawierać co najmniej jedną pozycję';
  END IF;$old$;
  v_items_new text := $new$  IF p_invoice->>'correction_kind' = 'party_data' THEN
    IF v_invoice_type IS DISTINCT FROM 'corrective'
      OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
      OR jsonb_typeof(p_order_items) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Korekta danych wymaga pustych list pozycji dokumentu i zamówienia';
    END IF;
    IF jsonb_array_length(p_items) <> 0 OR jsonb_array_length(p_order_items) <> 0 THEN
      RAISE EXCEPTION 'Korekta danych nie może zawierać pozycji kwotowych';
    END IF;
  ELSIF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Dokument musi zawierać co najmniej jedną pozycję';
  END IF;$new$;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.create_invoice_atomic(jsonb,jsonb,jsonb,uuid)',
    'public.update_invoice_draft_atomic(uuid,jsonb,jsonb,jsonb,uuid)'
  ] LOOP
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    IF strpos(v_definition, 'correction_party_data_before') > 0
      OR (length(v_definition) - length(replace(v_definition, v_items_old, ''))) / length(v_items_old) <> 1 THEN
      RAISE EXCEPTION 'Nie rozpoznano walidacji pozycji w %. Przerwano migrację.', v_signature;
    END IF;
    v_definition := replace(v_definition, v_items_old, v_items_new);
    v_original := 'OR COALESCE((p_invoice->>''correction_type'')::integer, 0) NOT IN (1, 2, 3)';
    v_replacement := 'OR (p_invoice->>''correction_kind'' IS DISTINCT FROM ''party_data'' AND COALESCE((p_invoice->>''correction_type'')::integer, 0) NOT IN (1, 2, 3))';
    IF (length(v_definition) - length(replace(v_definition, v_original, ''))) / length(v_original) <> 1 THEN
      RAISE EXCEPTION 'Nie rozpoznano walidacji rodzaju korekty w %.', v_signature;
    END IF;
    v_definition := replace(v_definition, v_original, v_replacement);
    IF v_signature LIKE 'public.create_invoice_atomic%' THEN
      v_original := '    related_invoice_id, correction_reason, correction_type, correction_scope,';
      v_replacement := '    related_invoice_id, correction_kind, correction_reason, correction_type, correction_scope,';
      IF (length(v_definition) - length(replace(v_definition, v_original, ''))) / length(v_original) <> 1 THEN
        RAISE EXCEPTION 'Nie rozpoznano kolumn korekty w %.', v_signature;
      END IF;
      v_definition := replace(v_definition, v_original, v_replacement);
      v_original := '    p_invoice->>''correction_reason'', NULLIF(p_invoice->>''correction_type'', '''')::smallint,';
      v_replacement := '    p_invoice->>''correction_kind'', p_invoice->>''correction_reason'', NULLIF(p_invoice->>''correction_type'', '''')::smallint,';
    ELSE
      v_original := '    related_invoice_id = CASE WHEN v_invoice_type = ''corrective'' THEN v_source_invoice.id END,';
      v_replacement := v_original || E'\n    correction_kind = CASE WHEN p_invoice ? ''correction_kind'' THEN p_invoice->>''correction_kind'' ELSE correction_kind END,';
    END IF;
    IF (length(v_definition) - length(replace(v_definition, v_original, ''))) / length(v_original) <> 1 THEN
      RAISE EXCEPTION 'Nie rozpoznano wartości korekty w %.', v_signature;
    END IF;
    v_definition := replace(v_definition, v_original, v_replacement);
    EXECUTE v_definition;
  END LOOP;
END;
$migration$;

-- Add narrow early returns to existing triggers, without replacing their other
-- behavior. Zero-value party corrections have no receivable and no event stage.
DO $migration$
DECLARE v_change record; v_definition text; v_anchor text := E'BEGIN\n';
BEGIN
  FOR v_change IN SELECT * FROM (VALUES
    ('public.normalize_invoice_payment_state()', $code$  IF NEW.correction_kind = 'party_data' THEN
    NEW.payment_status := 'not_applicable'; NEW.paid_amount := 0; NEW.manual_paid_amount := 0;
    NEW.paid_at := NULL; NEW.paid_date := NULL;
    NEW.payment_due_date := NULL; NEW.payment_method := NULL;
    RETURN NEW;
  END IF;
$code$),
    ('public.capture_invoice_manual_paid_amount()', $code$  IF NEW.correction_kind = 'party_data' THEN
    NEW.manual_paid_amount := 0; RETURN NEW;
  END IF;
$code$),
    ('public.validate_invoice_for_business_client()', $code$  IF NEW.correction_kind = 'party_data' AND NEW.correction_party_data_before IS NOT NULL THEN
    -- The earlier guard authorized and validated the same-taxpayer source.
    -- A manually corrected buyer need not have a new CRM organization record.
    RETURN NEW;
  END IF;
$code$),
    ('public.forward_local_sales_payment()', $code$ IF NEW.correction_kind = 'party_data' THEN RETURN NULL; END IF;
$code$),
    ('public.sync_invoice_event_payment_due_date()', $code$  IF NEW.correction_kind = 'party_data' THEN RETURN NEW; END IF;
$code$),
    ('public.update_event_actual_revenue()', $code$  IF COALESCE(to_jsonb(NEW)->>'correction_kind', to_jsonb(OLD)->>'correction_kind') = 'party_data' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
$code$),
    ('public.refresh_event_workflow_after_related_change()', $code$ IF TG_TABLE_NAME = 'invoices'
   AND COALESCE(to_jsonb(NEW)->>'correction_kind', to_jsonb(OLD)->>'correction_kind') = 'party_data' THEN
   IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
 END IF;
$code$),
    ('public.refresh_event_invoice_lifecycle_after_change()', $code$  IF TG_TABLE_NAME = 'invoices'
    AND COALESCE(v_new->>'correction_kind', v_old->>'correction_kind') = 'party_data' THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME IN ('ksef_invoices', 'invoice_event_allocations')
    AND EXISTS (SELECT 1 FROM public.invoices i
      WHERE i.id IN (NULLIF(v_new->>'invoice_id', '')::uuid, NULLIF(v_old->>'invoice_id', '')::uuid)
        AND i.correction_kind = 'party_data')
    AND NOT EXISTS (SELECT 1 FROM public.invoices i
      WHERE i.id IN (NULLIF(v_new->>'invoice_id', '')::uuid, NULLIF(v_old->>'invoice_id', '')::uuid)
        AND i.correction_kind IS DISTINCT FROM 'party_data') THEN RETURN NULL; END IF;
$code$)
  ) AS changes(signature, prefix)
  LOOP
    v_definition := pg_get_functiondef(v_change.signature::regprocedure);
    IF (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'Nie rozpoznano wejścia procedury %. Przerwano migrację.', v_change.signature;
    END IF;
    EXECUTE replace(v_definition, v_anchor, v_anchor || v_change.prefix);
  END LOOP;
END;
$migration$;

DO $migration$
DECLARE v_definition text; v_original text; v_replacement text;
BEGIN
  v_definition := pg_get_functiondef('public.event_invoice_lifecycle_state(uuid)'::regprocedure);
  v_original := '      AND i.invoice_type IN (''vat'', ''advance'', ''final'', ''corrective'')';
  IF (length(v_definition) - length(replace(v_definition, v_original, ''))) / length(v_original) <> 1 THEN
    RAISE EXCEPTION 'Nie rozpoznano filtra finansowych zobowiązań wydarzenia. Przerwano migrację.';
  END IF;
  v_replacement := v_original || E'\n      AND i.correction_kind IS DISTINCT FROM ''party_data''';
  EXECUTE replace(v_definition, v_original, v_replacement);

  v_definition := pg_get_functiondef('public.project_sales_ksef_payment(uuid)'::regprocedure);
  v_original := ' SELECT * INTO k FROM public.ksef_invoices WHERE id=p_ksef;';
  IF (length(v_definition) - length(replace(v_definition, v_original, ''))) / length(v_original) <> 1 THEN
    RAISE EXCEPTION 'Nie rozpoznano projekcji płatności KSeF. Przerwano migrację.';
  END IF;
  v_replacement := v_original || E'\n IF EXISTS (SELECT 1 FROM public.invoices i WHERE i.id=k.invoice_id AND i.correction_kind=''party_data'') THEN RETURN; END IF;';
  EXECUTE replace(v_definition, v_original, v_replacement);
END;
$migration$;

NOTIFY pgrst, 'reload schema';
COMMIT;
