BEGIN;

-- Additive only: do not rewrite any existing invoice or its accepted KSeF XML.
-- SQL NULL preserves the recipient rules used before the explicit form existed.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_recipient_mode text,
  ADD COLUMN IF NOT EXISTS invoice_recipient_data jsonb;

COMMENT ON COLUMN public.invoices.invoice_recipient_mode IS
  'Explicit invoice recipient choice: same_as_buyer, organization, manual. NULL is the legacy source-selection behaviour.';
COMMENT ON COLUMN public.invoices.invoice_recipient_data IS
  'Exact recipient values confirmed in the invoice form, independent of later CRM organization edits. Used by both PDF and KSeF through ksef_recipient_snapshot.';

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_explicit_recipient_mode CHECK (
    invoice_recipient_mode IS NULL
    OR invoice_recipient_mode IN ('same_as_buyer', 'organization', 'manual')
  ),
  ADD CONSTRAINT invoices_explicit_recipient_data CHECK (COALESCE(
    ((invoice_recipient_mode IS NULL OR invoice_recipient_mode = 'same_as_buyer')
      AND invoice_recipient_data IS NULL)
    OR (
      invoice_recipient_mode IN ('organization', 'manual')
      AND (invoice_recipient_mode <> 'organization' OR service_recipient_organization_id IS NOT NULL)
      AND jsonb_typeof(invoice_recipient_data) = 'object'
      AND invoice_recipient_data ?& ARRAY['name', 'street', 'postalCode', 'city', 'countryCode', 'role']
      AND invoice_recipient_data - ARRAY['name', 'nip', 'internalId', 'street', 'postalCode', 'city', 'countryCode', 'role'] = '{}'::jsonb
      AND invoice_recipient_data -> 'role' = '2'::jsonb
      AND jsonb_typeof(invoice_recipient_data -> 'name') = 'string'
      AND length(btrim(invoice_recipient_data ->> 'name')) BETWEEN 1 AND 512
      AND length(invoice_recipient_data ->> 'name') <= 512
      AND jsonb_typeof(invoice_recipient_data -> 'street') = 'string'
      AND length(btrim(invoice_recipient_data ->> 'street')) BETWEEN 1 AND 512
      AND length(invoice_recipient_data ->> 'street') <= 512
      AND jsonb_typeof(invoice_recipient_data -> 'postalCode') = 'string'
      AND length(btrim(invoice_recipient_data ->> 'postalCode')) BETWEEN 1 AND 32
      AND length(invoice_recipient_data ->> 'postalCode') <= 32
      AND jsonb_typeof(invoice_recipient_data -> 'city') = 'string'
      AND length(btrim(invoice_recipient_data ->> 'city')) > 0
      AND length((invoice_recipient_data ->> 'postalCode') || ' ' || (invoice_recipient_data ->> 'city')) <= 512
      AND jsonb_typeof(invoice_recipient_data -> 'countryCode') = 'string'
      AND (invoice_recipient_data ->> 'countryCode') ~ '^[A-Z]{2}$'
      AND (
        NOT (invoice_recipient_data ? 'nip')
        OR invoice_recipient_data -> 'nip' = 'null'::jsonb
        OR (jsonb_typeof(invoice_recipient_data -> 'nip') = 'string'
          AND length(invoice_recipient_data ->> 'nip') <= 32)
      )
      AND (
        NOT (invoice_recipient_data ? 'internalId')
        OR invoice_recipient_data -> 'internalId' = 'null'::jsonb
        OR (jsonb_typeof(invoice_recipient_data -> 'internalId') = 'string'
          AND length(invoice_recipient_data ->> 'internalId') <= 16)
      )
    ), false
  ));

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
  v_data jsonb;
BEGIN
  -- Explicit choices always win, including on corrections. An event's service
  -- recipient must not silently become Podmiot3 when the user chose "same".
  IF p_invoice.invoice_recipient_mode = 'same_as_buyer' THEN
    IF p_invoice.invoice_recipient_data IS NOT NULL THEN
      RAISE EXCEPTION 'Przy tym samym nabywcy i odbiorcy nie zapisuj osobnych danych odbiorcy.' USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object('version', 1, 'recipient', NULL);
  END IF;

  IF p_invoice.invoice_recipient_mode IN ('organization', 'manual') THEN
    IF p_invoice.invoice_recipient_mode = 'organization'
      AND p_invoice.service_recipient_organization_id IS NULL THEN
      RAISE EXCEPTION 'Wybierz organizację odbiorcy albo wybierz ręczne wpisanie danych.' USING ERRCODE = '23514';
    END IF;
    v_data := p_invoice.invoice_recipient_data;
    IF jsonb_typeof(v_data) IS DISTINCT FROM 'object'
      OR NOT COALESCE(v_data ?& ARRAY['name', 'street', 'postalCode', 'city', 'countryCode', 'role'], false)
      OR v_data -> 'role' IS DISTINCT FROM '2'::jsonb
      OR v_data - ARRAY['name', 'nip', 'internalId', 'street', 'postalCode', 'city', 'countryCode', 'role'] <> '{}'::jsonb
    THEN
      RAISE EXCEPTION 'Uzupełnij komplet osobnych danych odbiorcy faktury.' USING ERRCODE = '23514';
    END IF;
    -- Never re-read the contact card here: these are the values the user saw
    -- and confirmed. Basic shape/length checks are enforced by the table;
    -- FA(3) preflight additionally validates tax identifiers and XML values.
    RETURN jsonb_build_object('version', 1, 'recipient', v_data || jsonb_build_object(
      'organizationId', CASE WHEN p_invoice.invoice_recipient_mode = 'organization'
        THEN p_invoice.service_recipient_organization_id ELSE NULL::uuid END
    ));
  END IF;

  IF p_invoice.invoice_recipient_mode IS NOT NULL OR p_invoice.invoice_recipient_data IS NOT NULL THEN
    RAISE EXCEPTION 'Nieprawidłowy sposób określenia odbiorcy faktury.' USING ERRCODE = '23514';
  END IF;

  -- Unchanged legacy behaviour. Only old callers/rows without an explicit
  -- choice reach this branch; no historical row is backfilled by this migration.
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
    NEW.service_recipient_contact_id, NEW.billing_arrangement, NEW.buyer_is_private_person,
    NEW.invoice_recipient_mode, NEW.invoice_recipient_data)
    IS DISTINCT FROM ROW(OLD.organization_id, OLD.service_recipient_organization_id,
    OLD.service_recipient_contact_id, OLD.billing_arrangement, OLD.buyer_is_private_person,
    OLD.invoice_recipient_mode, OLD.invoice_recipient_data);
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
    RETURN NEW;
  END IF;

  IF v_context_changed OR v_explicit_capture
    OR (NEW.status IN ('issued', 'sent', 'paid', 'overdue') AND OLD.status NOT IN ('issued', 'sent', 'paid', 'overdue'))
    OR (NEW.ksef_status = 'pending' AND OLD.ksef_status IS DISTINCT FROM 'pending')
  THEN
    NEW.ksef_recipient_snapshot := public.build_invoice_ksef_recipient_snapshot(NEW);
  ELSIF NEW.ksef_recipient_snapshot IS DISTINCT FROM OLD.ksef_recipient_snapshot THEN
    RAISE EXCEPTION 'Dane odbiorcy są zapisywane z potwierdzonego formularza faktury.' USING ERRCODE = '55000';
  END IF;
  IF NEW.ksef_recipient_snapshot IS DISTINCT FROM OLD.ksef_recipient_snapshot THEN
    NEW.pdf_url := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_invoice_ksef_recipient_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserve current production authorization, numbering, payment and item logic.
-- Only extend the three existing writes, atomically at INSERT / draft UPDATE.
-- Pro-forma conversion already forwards p_invoice to create_invoice_atomic;
-- create_paid_final_invoice_atomic forwards it to create_final_invoice_atomic.
DO $migration$
DECLARE
  v_signature text;
  v_oid regprocedure;
  v_definition text;
  v_columns text := E'    service_recipient_organization_id, service_recipient_contact_id,\n';
  v_values text := E'    NULLIF(p_invoice->>''service_recipient_contact_id'', '''')::uuid,\n';
  v_update text := E'    service_recipient_contact_id = NULLIF(p_invoice->>''service_recipient_contact_id'', '''')::uuid,\n';
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.create_invoice_atomic(jsonb,jsonb,jsonb,uuid)',
    'public.create_final_invoice_atomic(jsonb,jsonb,uuid[],uuid)'
  ] LOOP
    v_oid := to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Brak wymaganej procedury zapisu: %', v_signature;
    END IF;
    v_definition := pg_get_functiondef(v_oid);
    IF strpos(v_definition, 'invoice_recipient_mode') > 0
      OR (length(v_definition) - length(replace(v_definition, v_columns, ''))) / length(v_columns) <> 1
      OR (length(v_definition) - length(replace(v_definition, v_values, ''))) / length(v_values) <> 1 THEN
      RAISE EXCEPTION 'Niezgodna definicja %. Nie zmieniono procedury zapisu faktur.', v_signature;
    END IF;
    v_definition := replace(v_definition, v_columns,
      v_columns || E'    invoice_recipient_mode, invoice_recipient_data,\n');
    v_definition := replace(v_definition, v_values,
      v_values || E'    p_invoice->>''invoice_recipient_mode'',\n    NULLIF(p_invoice->''invoice_recipient_data'', ''null''::jsonb),\n');
    EXECUTE v_definition;
  END LOOP;

  v_signature := 'public.update_invoice_draft_atomic(uuid,jsonb,jsonb,jsonb,uuid)';
  v_oid := to_regprocedure(v_signature);
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Brak wymaganej procedury zapisu: %', v_signature;
  END IF;
  v_definition := pg_get_functiondef(v_oid);
  IF strpos(v_definition, 'invoice_recipient_mode') > 0
    OR (length(v_definition) - length(replace(v_definition, v_update, ''))) / length(v_update) <> 1 THEN
    RAISE EXCEPTION 'Niezgodna definicja %. Nie zmieniono procedury zapisu faktur.', v_signature;
  END IF;
  v_definition := replace(v_definition, v_update, v_update || $replacement$    invoice_recipient_mode = CASE WHEN p_invoice ? 'invoice_recipient_mode'
      THEN p_invoice->>'invoice_recipient_mode' ELSE invoice_recipient_mode END,
    invoice_recipient_data = CASE WHEN p_invoice ? 'invoice_recipient_data'
      THEN NULLIF(p_invoice->'invoice_recipient_data', 'null'::jsonb)
      WHEN p_invoice ? 'invoice_recipient_mode'
        AND COALESCE(p_invoice->>'invoice_recipient_mode', 'same_as_buyer') = 'same_as_buyer'
      THEN NULL ELSE invoice_recipient_data END,
$replacement$);
  EXECUTE v_definition;
END;
$migration$;

-- Existing authenticated ensure/claim RPCs call the replaced builder/trigger.
-- Their authorization, optimistic lock and single-send guarantees are unchanged.
NOTIFY pgrst, 'reload schema';
COMMIT;
