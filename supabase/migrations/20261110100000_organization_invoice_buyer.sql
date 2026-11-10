-- Nabywca na fakturach wskazany w karcie organizacji (np. szkoła → gmina) + odbiorca JST w KSeF
-- ===============================================================================================================
-- Można uruchomić ponownie.
--
-- organizations.invoice_buyer_organization_id — organizacja, na którą wystawiamy faktury za tę organizację.
--   Przykład: klientem wydarzenia i stroną umowy jest Szkoła Podstawowa nr 1, a nabywcą na fakturze Gmina Olsztyn.
-- organizations.invoice_recipient_role — kim ta organizacja jest na fakturze (KSeF FA(3), Podmiot3/Rola):
--   8 = jednostka podrzędna JST – odbiorca (szkoła, przedszkole, MOPS…): w Podmiot2 nabywca z JST = 1,
--   2 = odbiorca – oddział / jednostka wewnętrzna nabywcy (z numerem IDWew nabywcy).
-- Zasady (pilnuje wyzwalacz): nabywca musi istnieć i mieć NIP, nie może być tą samą organizacją, nie może sam
-- mieć nabywcy (bez łańcuchów), a organizacja będąca nabywcą dla innych nie może mieć własnego nabywcy.
-- Usunięcie nabywcy czyści powiązanie w jednostkach.
--
-- Faktury: invoice_recipient_data / ksef_recipient_snapshot przyjmują teraz rolę 2 albo 8.
-- build_invoice_ksef_recipient_snapshot: rola 8 wymaga NIP jednostki i nie ma numeru IDWew; w starej ścieżce
-- (faktura bez jawnego wyboru odbiorcy) jednostka rozliczana na nabywcę faktury dostaje rolę z karty organizacji.

-- 1. Kolumny ---------------------------------------------------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS invoice_buyer_organization_id uuid,
  ADD COLUMN IF NOT EXISTS invoice_recipient_role smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.organizations'::regclass
                   AND conname = 'organizations_invoice_buyer_organization_id_fkey') THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_invoice_buyer_organization_id_fkey
      FOREIGN KEY (invoice_buyer_organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.organizations'::regclass
                   AND conname = 'organizations_invoice_buyer_not_self') THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_invoice_buyer_not_self
      CHECK (invoice_buyer_organization_id IS NULL OR invoice_buyer_organization_id <> id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.organizations'::regclass
                   AND conname = 'organizations_invoice_recipient_role_check') THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_invoice_recipient_role_check
      CHECK (invoice_recipient_role IS NULL OR invoice_recipient_role IN (2, 8));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS organizations_invoice_buyer_organization_id_idx
  ON public.organizations (invoice_buyer_organization_id)
  WHERE invoice_buyer_organization_id IS NOT NULL;

COMMENT ON COLUMN public.organizations.invoice_buyer_organization_id IS
  'Nabywca na fakturach za tę organizację (np. gmina dla szkoły). Puste = faktury na tę organizację.';
COMMENT ON COLUMN public.organizations.invoice_recipient_role IS
  'Rola tej organizacji jako odbiorcy w KSeF (Podmiot3): 8 = jednostka podrzędna JST, 2 = jednostka wewnętrzna nabywcy.';

-- 2. Wyzwalacz pilnujący powiązania ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_organization_invoice_buyer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_buyer public.organizations%ROWTYPE;
BEGIN
  IF NEW.invoice_buyer_organization_id IS NULL THEN
    NEW.invoice_recipient_role := NULL;
    RETURN NEW;
  END IF;

  NEW.invoice_recipient_role := COALESCE(NEW.invoice_recipient_role, 8);

  IF NEW.invoice_buyer_organization_id = NEW.id THEN
    RAISE EXCEPTION 'Organizacja nie może być nabywcą faktur sama dla siebie.' USING ERRCODE = '23514';
  END IF;

  -- Jedna zmiana powiązań naraz: dwie równoległe edycje nie zbudują łańcucha szkoła → gmina → …
  PERFORM pg_advisory_xact_lock(hashtext('public.organizations.invoice_buyer_organization_id'));

  SELECT * INTO v_buyer FROM public.organizations WHERE id = NEW.invoice_buyer_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nie znaleziono organizacji wskazanej jako nabywca faktur.' USING ERRCODE = '23503';
  END IF;
  IF v_buyer.invoice_buyer_organization_id IS NOT NULL THEN
    RAISE EXCEPTION 'Wybrana organizacja sama jest rozliczana na inną. Wskaż bezpośrednio nabywcę (np. gminę).'
      USING ERRCODE = '23514';
  END IF;
  IF NULLIF(regexp_replace(COALESCE(v_buyer.nip, ''), '\D', '', 'g'), '') IS NULL THEN
    RAISE EXCEPTION 'Organizacja wskazana jako nabywca faktur musi mieć NIP.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations o
             WHERE o.invoice_buyer_organization_id = NEW.id AND o.id <> NEW.id) THEN
    RAISE EXCEPTION 'Ta organizacja jest nabywcą faktur dla innych jednostek, więc nie może mieć własnego nabywcy.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_organization_invoice_buyer ON public.organizations;
CREATE TRIGGER trg_guard_organization_invoice_buyer
  BEFORE INSERT OR UPDATE OF invoice_buyer_organization_id, invoice_recipient_role ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.guard_organization_invoice_buyer();

-- 3. Faktury: odbiorca w roli 2 albo 8 ----------------------------------------------------------------------------
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
  WHERE conrelid = 'public.invoices'::regclass AND conname = 'invoices_explicit_recipient_data';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Brak ograniczenia invoices_explicit_recipient_data — przerwano bez zmian.';
  END IF;
  IF position('''8''::jsonb' IN v_def) = 0 THEN
    v_new := replace(v_def,
      '((invoice_recipient_data -> ''role''::text) = ''2''::jsonb)',
      '((invoice_recipient_data -> ''role''::text) = ANY (ARRAY[''2''::jsonb, ''8''::jsonb]))');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'Nie rozpoznano warunku roli w invoices_explicit_recipient_data — przerwano bez zmian.';
    END IF;
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_explicit_recipient_data;
    EXECUTE 'ALTER TABLE public.invoices ADD CONSTRAINT invoices_explicit_recipient_data ' || v_new;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
  WHERE conrelid = 'public.invoices'::regclass AND conname = 'invoices_ksef_recipient_snapshot_shape';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Brak ograniczenia invoices_ksef_recipient_snapshot_shape — przerwano bez zmian.';
  END IF;
  IF position('''8''::text' IN v_def) = 0 THEN
    v_new := replace(v_def,
      '((ksef_recipient_snapshot #>> ''{recipient,role}''::text[]) = ''2''::text)',
      '((ksef_recipient_snapshot #>> ''{recipient,role}''::text[]) = ANY (ARRAY[''2''::text, ''8''::text]))');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'Nie rozpoznano warunku roli w invoices_ksef_recipient_snapshot_shape — przerwano bez zmian.';
    END IF;
    ALTER TABLE public.invoices DROP CONSTRAINT invoices_ksef_recipient_snapshot_shape;
    EXECUTE 'ALTER TABLE public.invoices ADD CONSTRAINT invoices_ksef_recipient_snapshot_shape ' || v_new;
  END IF;
END $$;

-- 4. Zapis odbiorcy przy fakturze ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.build_invoice_ksef_recipient_snapshot(p_invoice invoices)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_organization public.organizations%ROWTYPE;
  v_source public.invoices%ROWTYPE;
  v_internal_id text;
  v_country text;
  v_data jsonb;
  v_role integer;
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
      OR NOT COALESCE(v_data -> 'role' IN ('2'::jsonb, '8'::jsonb), false)
      OR v_data - ARRAY['name', 'nip', 'internalId', 'street', 'postalCode', 'city', 'countryCode', 'role'] <> '{}'::jsonb
    THEN
      RAISE EXCEPTION 'Uzupełnij komplet osobnych danych odbiorcy faktury.' USING ERRCODE = '23514';
    END IF;
    IF v_data -> 'role' = '8'::jsonb AND (
      regexp_replace(COALESCE(v_data ->> 'nip', ''), '\D', '', 'g') !~ '^\d{10}$'
      OR NULLIF(btrim(COALESCE(v_data ->> 'internalId', '')), '') IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Jednostka podrzędna JST jako odbiorca musi mieć własny NIP i nie ma numeru wewnętrznego IDWew.'
        USING ERRCODE = '23514';
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

  -- Jednostka rozliczana na nabywcę tej faktury (np. szkoła → gmina) dostaje rolę z karty organizacji.
  v_role := CASE
    WHEN v_organization.invoice_buyer_organization_id IS NOT NULL
     AND v_organization.invoice_buyer_organization_id = p_invoice.organization_id
    THEN COALESCE(v_organization.invoice_recipient_role, 8)
    ELSE 2 END;

  v_internal_id := CASE WHEN v_role = 8 THEN NULL ELSE NULLIF(btrim(v_organization.ksef_internal_id), '') END;
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
    'nip', CASE WHEN v_role = 8
      THEN NULLIF(regexp_replace(COALESCE(v_organization.nip, ''), '\D', '', 'g'), '')
      ELSE NULLIF(btrim(v_organization.nip), '') END,
    'internalId', v_internal_id,
    'street', btrim(COALESCE(v_organization.address, '')),
    'postalCode', btrim(COALESCE(v_organization.postal_code, '')),
    'city', btrim(COALESCE(v_organization.city, '')),
    'countryCode', v_country,
    'role', v_role
  ));
END;
$function$;
