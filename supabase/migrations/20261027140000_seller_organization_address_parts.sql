BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $prerequisite$
BEGIN
  IF to_regclass('public.sales_partner_clients') IS NULL
    OR to_regprocedure('public.save_seller_portal_contact(uuid,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'Najpierw wdroż migrację 20261027120000_seller_contacts_and_organizations.sql.';
  END IF;
END;
$prerequisite$;

-- Existing text is deliberately not parsed or rewritten by this migration.
-- NULL means an unconfirmed legacy address; an object is the authoritative,
-- explicitly accepted address split into fields.
ALTER TABLE public.sales_partner_clients ADD COLUMN IF NOT EXISTS address_parts jsonb;
DO $constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='public.sales_partner_clients'::regclass AND conname='seller_clients_address_parts_shape') THEN
    ALTER TABLE public.sales_partner_clients ADD CONSTRAINT seller_clients_address_parts_shape
      CHECK (address_parts IS NULL OR (kind='organization'
        AND jsonb_typeof(address_parts)='object' AND octet_length(address_parts::text)<=4000));
  END IF;
END;
$constraint$;

CREATE OR REPLACE FUNCTION public.get_seller_portal_contacts(
  p_company_id uuid DEFAULT NULL, p_query text DEFAULT '', p_kind text DEFAULT 'all',
  p_organization uuid DEFAULT NULL, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $list$
  WITH visible AS (
    SELECT c.id, c.my_company_id, c.kind, c.organization_id,
      CASE WHEN c.kind = 'organization' THEN '' ELSE c.name END AS name,
      COALESCE(org.company, c.company) AS company, org.company AS organization_name,
      c.email, c.phone, c.position, c.tax_id, c.address, c.address_parts, c.website, c.revision,
      (SELECT count(*) FROM public.sales_partner_clients person
        WHERE person.organization_id = c.id AND person.sales_partner_id = c.sales_partner_id
          AND person.my_company_id = c.my_company_id) AS people_count
    FROM public.sales_partner_clients c
    LEFT JOIN public.sales_partner_clients org ON org.id = c.organization_id
      AND org.sales_partner_id = c.sales_partner_id AND org.my_company_id = c.my_company_id
      AND org.kind = 'organization'
    WHERE c.sales_partner_id = public.current_sales_partner_id() AND c.deleted_at IS NULL
      AND (p_company_id IS NULL OR c.my_company_id = p_company_id)
      AND (p_organization IS NULL OR c.organization_id = p_organization)
      AND (p_kind = 'all'
        OR (p_kind = 'organizations' AND c.kind = 'organization')
        OR (p_kind = 'persons' AND c.kind = 'person')
        OR (p_kind = 'individual' AND c.kind = 'person' AND c.organization_id IS NULL AND btrim(c.company) = '')
        OR (p_kind = 'business' AND c.kind = 'person' AND (c.organization_id IS NOT NULL OR btrim(c.company) <> '')))
      AND (COALESCE(btrim(p_query), '') = '' OR strpos(lower(concat_ws(' ',
        c.name, COALESCE(org.company, c.company), c.email, c.phone, c.position, c.tax_id)), lower(btrim(p_query))) > 0)
  ), page AS (
    SELECT * FROM visible
    ORDER BY lower(CASE WHEN kind = 'organization' THEN company ELSE name END), id
    LIMIT LEAST(100, GREATEST(1, COALESCE(p_limit, 25)))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  )
  SELECT jsonb_build_object('total', (SELECT count(*) FROM visible),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY lower(CASE WHEN kind = 'organization' THEN company ELSE name END), id) FROM page), '[]'::jsonb));
$list$;
REVOKE ALL ON FUNCTION public.get_seller_portal_contacts(uuid,text,text,uuid,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_seller_portal_contacts(uuid,text,text,uuid,integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_seller_portal_contact(
  p_company_id uuid, p_contact jsonb, p_revision integer DEFAULT 0
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $save$
DECLARE
  v_partner uuid := public.current_sales_partner_id();
  v_old public.sales_partner_clients%ROWTYPE;
  v_parent public.sales_partner_clients%ROWTYPE;
  v_id uuid; v_duplicate uuid; v_organization uuid; v_kind text;
  v_name text; v_company text; v_email text; v_phone text;
  v_position text; v_tax_id text; v_address text; v_website text;
  v_key text; v_same boolean; v_address_parts jsonb; v_part text;
  v_line text; v_locality text;
BEGIN
  IF v_partner IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.sales_partner_brand_terms t
    WHERE t.sales_partner_id = v_partner AND t.my_company_id = p_company_id AND t.is_active
  ) THEN RAISE EXCEPTION 'Brak dostępu do bazy klientów tej marki' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_contact) IS DISTINCT FROM 'object' OR p_revision IS NULL OR p_revision < 0 THEN
    RAISE EXCEPTION 'Nieprawidłowe dane kontaktu';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['name','company','email','phone','position','tax_id','address','website','kind','id','organization_id'] LOOP
    IF p_contact ? v_key AND jsonb_typeof(p_contact->v_key) NOT IN ('string','null') THEN
      RAISE EXCEPTION 'Nieprawidłowe dane kontaktu';
    END IF;
  END LOOP;
  v_id := NULLIF(p_contact->>'id', '')::uuid;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Brak identyfikatora zapisu. Otwórz formularz ponownie.'; END IF;
  v_kind := p_contact->>'kind';
  IF v_kind IS NULL OR v_kind NOT IN ('person', 'organization') THEN RAISE EXCEPTION 'Wybierz osobę lub organizację'; END IF;
  v_organization := NULLIF(p_contact->>'organization_id', '')::uuid;
  v_name := btrim(COALESCE(p_contact->>'name', ''));
  v_company := btrim(COALESCE(p_contact->>'company', ''));
  v_email := lower(btrim(COALESCE(p_contact->>'email', '')));
  v_phone := btrim(COALESCE(p_contact->>'phone', ''));
  v_position := btrim(COALESCE(p_contact->>'position', ''));
  v_tax_id := btrim(COALESCE(p_contact->>'tax_id', ''));
  v_address := btrim(COALESCE(p_contact->>'address', ''));
  v_website := btrim(COALESCE(p_contact->>'website', ''));
  IF length(v_name)>300 OR length(v_company)>300 OR length(v_email)>320 OR length(v_phone)>80
    OR length(v_position)>160 OR length(v_tax_id)>40 OR length(v_address)>500 OR length(v_website)>500 THEN
    RAISE EXCEPTION 'Skróć dane kontaktu do limitów podanych w formularzu';
  END IF;
  IF v_email <> '' AND v_email !~ '^[^[:space:]@,;]+@[^[:space:]@,;]+\.[^[:space:]@,;]+$' THEN RAISE EXCEPTION 'Podaj poprawny adres e-mail'; END IF;
  IF v_website <> '' AND v_website !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION 'Adres strony musi zaczynać się od https:// lub http://'; END IF;

  -- Serialize related mutations in this private address book, including deletes.
  PERFORM pg_advisory_xact_lock(hashtextextended('seller-clients:' || v_partner::text || ':' || p_company_id::text, 0));
  SELECT * INTO v_old FROM public.sales_partner_clients
    WHERE id = v_id AND sales_partner_id = v_partner AND my_company_id = p_company_id FOR UPDATE;
  IF v_old.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Kontakt został usunięty. Odśwież listę.' USING ERRCODE = '40001'; END IF;
  IF v_old.id IS NULL AND p_revision <> 0 THEN RAISE EXCEPTION 'Kontakt został usunięty lub jest już niedostępny. Odśwież listę.' USING ERRCODE = '40001'; END IF;
  IF v_old.id IS NOT NULL AND v_old.kind <> v_kind THEN RAISE EXCEPTION 'Nie można zamienić istniejącej osoby w organizację ani organizacji w osobę. Dodaj osobny wpis.'; END IF;

  IF v_kind = 'organization' THEN
    IF v_company = '' OR v_organization IS NOT NULL THEN RAISE EXCEPTION 'Podaj nazwę organizacji. Organizacji nie przypisujemy do innej organizacji.'; END IF;
    v_name := ''; v_position := '';
    IF p_contact ? 'address_parts' THEN
      v_address_parts := NULLIF(p_contact->'address_parts', 'null'::jsonb);
    ELSIF v_old.id IS NOT NULL AND v_old.address = v_address THEN
      -- Keep structured data when an older client edits an unrelated field.
      v_address_parts := v_old.address_parts;
    END IF;
    IF v_address_parts IS NOT NULL THEN
      IF jsonb_typeof(v_address_parts) IS DISTINCT FROM 'object'
        OR octet_length(v_address_parts::text) > 4000 THEN
        RAISE EXCEPTION 'Nieprawidłowe dane adresu organizacji';
      END IF;
      IF v_address_parts - ARRAY['type','name','house','apartment','postal_code','city','country']::text[] <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Nieprawidłowe pola adresu organizacji';
      END IF;
      FOREACH v_key IN ARRAY ARRAY['type','name','house','apartment','postal_code','city','country'] LOOP
        IF v_address_parts ? v_key AND jsonb_typeof(v_address_parts->v_key) NOT IN ('string','null') THEN
          RAISE EXCEPTION 'Nieprawidłowe dane adresu organizacji';
        END IF;
        v_part := btrim(COALESCE(v_address_parts->>v_key, ''));
        IF v_key = 'country' AND v_part = '' THEN v_part := 'Polska'; END IF;
        IF length(v_part) > (CASE v_key
          WHEN 'name' THEN 200
          WHEN 'city' THEN 120
          WHEN 'country' THEN 80
          ELSE 20
        END) THEN
          RAISE EXCEPTION 'Skróć dane adresowe do limitów pól';
        END IF;
        v_address_parts := jsonb_set(v_address_parts, ARRAY[v_key], to_jsonb(v_part), true);
      END LOOP;
      IF v_address_parts->>'type' NOT IN ('','street','avenue','square','village','estate') THEN
        RAISE EXCEPTION 'Wybierz prefiks adresu lub „Bez prefiksu”.';
      END IF;
      IF lower(v_address_parts->>'country') IN ('polska','poland','pl')
        AND v_address_parts->>'postal_code' ~ '^[0-9]{5}$' THEN
        v_part := v_address_parts->>'postal_code';
        v_address_parts := jsonb_set(v_address_parts, '{postal_code}',
          to_jsonb(substr(v_part,1,2) || '-' || substr(v_part,3,3)));
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_each_text(v_address_parts) AS part(key,value)
        WHERE part.key <> 'country' AND part.value <> '') THEN
        IF v_address_parts->>'name' = '' THEN RAISE EXCEPTION 'Podaj nazwę ulicy lub miejscowości bez ulicy.'; END IF;
        IF v_address_parts->>'house' = '' THEN RAISE EXCEPTION 'Podaj numer budynku. Numer lokalu jest opcjonalny.'; END IF;
        IF v_address_parts->>'city' = '' THEN RAISE EXCEPTION 'Podaj miejscowość.'; END IF;
        IF v_address_parts->>'postal_code' = '' THEN RAISE EXCEPTION 'Podaj kod pocztowy.'; END IF;
        IF lower(v_address_parts->>'country') IN ('polska','poland','pl')
          AND v_address_parts->>'postal_code' !~ '^[0-9]{2}-[0-9]{3}$' THEN
          RAISE EXCEPTION 'Podaj kod pocztowy w formacie 00-000.';
        END IF;
      END IF;
      -- The text address is a formatted mirror for existing readers.
      v_line := concat_ws(' ',
        CASE WHEN v_address_parts->>'name' <> '' THEN
          CASE v_address_parts->>'type'
            WHEN 'street' THEN 'ul.' WHEN 'avenue' THEN 'al.'
            WHEN 'square' THEN 'pl.' WHEN 'estate' THEN 'os.' ELSE NULL END
          ELSE NULL END,
        NULLIF(v_address_parts->>'name',''),
        NULLIF(concat_ws('/', NULLIF(v_address_parts->>'house',''), NULLIF(v_address_parts->>'apartment','')),''));
      v_locality := concat_ws(' ', NULLIF(v_address_parts->>'postal_code',''), NULLIF(v_address_parts->>'city',''));
      v_address := CASE WHEN v_line = '' AND v_locality = '' THEN ''
        ELSE concat_ws(', ', NULLIF(v_line,''), NULLIF(v_locality,''), NULLIF(v_address_parts->>'country','')) END;
      IF length(v_address) > 500 THEN RAISE EXCEPTION 'Skróć dane adresowe do limitów pól'; END IF;
    END IF;
  ELSE
    IF v_name = '' THEN RAISE EXCEPTION 'Podaj imię i nazwisko osoby'; END IF;
    v_tax_id := ''; v_address := ''; v_website := ''; v_address_parts := NULL;
    IF v_organization IS NOT NULL THEN
      SELECT * INTO v_parent FROM public.sales_partner_clients WHERE id = v_organization
        AND sales_partner_id = v_partner AND my_company_id = p_company_id AND kind = 'organization' AND deleted_at IS NULL;
      IF v_parent.id IS NULL THEN RAISE EXCEPTION 'Wybierz organizację ze swojej bazy dla tego cennika'; END IF;
      -- Organization name has one source of truth. company remains a legacy
      -- free-text field only for old/unlinked contacts.
      v_company := '';
    END IF;
  END IF;

  IF v_old.id IS NOT NULL THEN
    v_same := ROW(v_old.kind,v_old.organization_id,v_old.name,v_old.company,v_old.email,v_old.phone,v_old.position,v_old.tax_id,v_old.address,v_old.website,v_old.address_parts)
      IS NOT DISTINCT FROM ROW(v_kind,v_organization,v_name,v_company,v_email,v_phone,v_position,v_tax_id,v_address,v_website,v_address_parts);
    -- An identical retry after a lost response is harmless; never overwrite a
    -- different revision, and never resurrect a deleted entry.
    IF v_same THEN RETURN v_id; END IF;
    IF v_old.revision <> p_revision THEN
      RAISE EXCEPTION 'Kontakt zmieniła inna osoba lub karta przeglądarki. Odśwież listę i otwórz edycję ponownie. Twoje zmiany pozostają w formularzu.' USING ERRCODE = '40001';
    END IF;
    UPDATE public.sales_partner_clients SET name=v_name, company=v_company, email=v_email, phone=v_phone,
      organization_id=v_organization, position=v_position, tax_id=v_tax_id, address=v_address, address_parts=v_address_parts, website=v_website,
      revision=revision+1, updated_at=now()
      WHERE id=v_id AND sales_partner_id=v_partner AND my_company_id=p_company_id;
    RETURN v_id;
  END IF;

  SELECT id INTO v_duplicate FROM public.sales_partner_clients c WHERE c.sales_partner_id=v_partner AND c.my_company_id=p_company_id AND c.deleted_at IS NULL
    AND ROW(c.kind,c.organization_id,c.name,c.company,c.email,c.phone,c.position,c.tax_id,c.address,c.website,c.address_parts)
      IS NOT DISTINCT FROM ROW(v_kind,v_organization,v_name,v_company,v_email,v_phone,v_position,v_tax_id,v_address,v_website,v_address_parts);
  IF v_duplicate IS NOT NULL THEN RETURN v_duplicate; END IF;
  INSERT INTO public.sales_partner_clients(id,sales_partner_id,my_company_id,kind,organization_id,name,company,email,phone,position,tax_id,address,website,address_parts)
    VALUES(v_id,v_partner,p_company_id,v_kind,v_organization,v_name,v_company,v_email,v_phone,v_position,v_tax_id,v_address,v_website,v_address_parts);
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Kontakt z tymi danymi już istnieje. Otwórz jego edycję zamiast dodawać kolejny wpis.';
END;
$save$;
REVOKE ALL ON FUNCTION public.save_seller_portal_contact(uuid,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_contact(uuid,jsonb,integer) TO authenticated;

-- A versioned entry point prevents an older backend from silently discarding
-- the new JSON fields. Authorization and revision/idempotency checks remain in
-- the existing core mutation; no extra table permissions or RLS policies.
CREATE OR REPLACE FUNCTION public.save_seller_portal_contact_v2(
  p_company_id uuid, p_contact jsonb, p_revision integer DEFAULT 0
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $v2$
BEGIN
  IF jsonb_typeof(p_contact) IS DISTINCT FROM 'object' OR NOT (p_contact ? 'address_parts') THEN
    RAISE EXCEPTION 'Brak danych adresowych formularza. Odśwież stronę i spróbuj ponownie.';
  END IF;
  RETURN public.save_seller_portal_contact(p_company_id,p_contact,p_revision);
END;
$v2$;
REVOKE ALL ON FUNCTION public.save_seller_portal_contact_v2(uuid,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_contact_v2(uuid,jsonb,integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
