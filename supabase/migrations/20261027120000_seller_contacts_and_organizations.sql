BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Extend the seller's PRIVATE address book, not the shared CRM contacts.
-- Legacy company names are preserved; organizations are never merged by name.
ALTER TABLE public.sales_partner_clients
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'person',
  ADD COLUMN IF NOT EXISTS organization_id uuid,
  ADD COLUMN IF NOT EXISTS position text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tax_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS website text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

UPDATE public.sales_partner_clients SET kind = 'organization'
WHERE kind = 'person' AND btrim(name) = '' AND btrim(company) <> '' AND organization_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS seller_clients_relation_scope
  ON public.sales_partner_clients(id, sales_partner_id, my_company_id);
CREATE INDEX IF NOT EXISTS seller_clients_organization
  ON public.sales_partner_clients(organization_id) WHERE organization_id IS NOT NULL;

DO $constraints$
DECLARE v_constraint text;
BEGIN
  -- Replace the legacy identity constraint with an active-entry index, so an
  -- explicitly re-added contact can coexist with its recoverable deleted copy.
  FOR v_constraint IN
    SELECT con.conname FROM pg_constraint con
    WHERE con.conrelid='public.sales_partner_clients'::regclass AND con.contype='u'
      AND (SELECT array_agg(a.attname::text ORDER BY part.ordinality)
        FROM unnest(con.conkey) WITH ORDINALITY AS part(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=part.attnum)
        = ARRAY['sales_partner_id','my_company_id','name','company','email','phone']
  LOOP
    EXECUTE format('ALTER TABLE public.sales_partner_clients DROP CONSTRAINT %I',v_constraint);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sales_partner_clients'::regclass AND conname = 'seller_clients_kind_shape') THEN
    ALTER TABLE public.sales_partner_clients ADD CONSTRAINT seller_clients_kind_shape CHECK (
      kind IN ('person', 'organization') AND revision > 0
      AND (kind <> 'organization' OR (organization_id IS NULL AND btrim(company) <> ''))
      AND (organization_id IS NULL OR (kind = 'person' AND organization_id <> id))
      AND length(position) <= 160 AND length(tax_id) <= 40
      AND length(address) <= 500 AND length(website) <= 500
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sales_partner_clients'::regclass AND conname = 'seller_clients_organization_scope_fk') THEN
    ALTER TABLE public.sales_partner_clients ADD CONSTRAINT seller_clients_organization_scope_fk
      FOREIGN KEY (organization_id, sales_partner_id, my_company_id)
      REFERENCES public.sales_partner_clients(id, sales_partner_id, my_company_id) ON DELETE RESTRICT;
  END IF;
END;
$constraints$;
CREATE UNIQUE INDEX IF NOT EXISTS seller_clients_active_identity ON public.sales_partner_clients
  (sales_partner_id,my_company_id,kind,(COALESCE(organization_id,'00000000-0000-0000-0000-000000000000'::uuid)),name,company,email,phone,tax_id)
  WHERE deleted_at IS NULL;

-- Read through existing per-seller/per-brand RLS. Do not grant direct writes.
ALTER TABLE public.sales_partner_clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_partner_clients FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.sales_partner_clients FROM authenticated;
GRANT SELECT ON public.sales_partner_clients TO authenticated;
DROP POLICY IF EXISTS seller_clients_hide_deleted ON public.sales_partner_clients;
CREATE POLICY seller_clients_hide_deleted ON public.sales_partner_clients
  AS RESTRICTIVE FOR SELECT TO authenticated USING (deleted_at IS NULL);

CREATE OR REPLACE FUNCTION public.get_seller_portal_contacts(
  p_company_id uuid DEFAULT NULL, p_query text DEFAULT '', p_kind text DEFAULT 'all',
  p_organization uuid DEFAULT NULL, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $list$
  WITH visible AS (
    SELECT c.id, c.my_company_id, c.kind, c.organization_id,
      CASE WHEN c.kind = 'organization' THEN '' ELSE c.name END AS name,
      COALESCE(org.company, c.company) AS company, org.company AS organization_name,
      c.email, c.phone, c.position, c.tax_id, c.address, c.website, c.revision,
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
  v_key text; v_same boolean;
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
  ELSE
    IF v_name = '' THEN RAISE EXCEPTION 'Podaj imię i nazwisko osoby'; END IF;
    v_tax_id := ''; v_address := ''; v_website := '';
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
    v_same := ROW(v_old.kind,v_old.organization_id,v_old.name,v_old.company,v_old.email,v_old.phone,v_old.position,v_old.tax_id,v_old.address,v_old.website)
      IS NOT DISTINCT FROM ROW(v_kind,v_organization,v_name,v_company,v_email,v_phone,v_position,v_tax_id,v_address,v_website);
    -- An identical retry after a lost response is harmless; never overwrite a
    -- different revision, and never resurrect a deleted entry.
    IF v_same THEN RETURN v_id; END IF;
    IF v_old.revision <> p_revision THEN
      RAISE EXCEPTION 'Kontakt zmieniła inna osoba lub karta przeglądarki. Odśwież listę i otwórz edycję ponownie. Twoje zmiany pozostają w formularzu.' USING ERRCODE = '40001';
    END IF;
    UPDATE public.sales_partner_clients SET name=v_name, company=v_company, email=v_email, phone=v_phone,
      organization_id=v_organization, position=v_position, tax_id=v_tax_id, address=v_address, website=v_website,
      revision=revision+1, updated_at=now()
      WHERE id=v_id AND sales_partner_id=v_partner AND my_company_id=p_company_id;
    RETURN v_id;
  END IF;

  SELECT id INTO v_duplicate FROM public.sales_partner_clients c WHERE c.sales_partner_id=v_partner AND c.my_company_id=p_company_id AND c.deleted_at IS NULL
    AND ROW(c.kind,c.organization_id,c.name,c.company,c.email,c.phone,c.position,c.tax_id,c.address,c.website)
      IS NOT DISTINCT FROM ROW(v_kind,v_organization,v_name,v_company,v_email,v_phone,v_position,v_tax_id,v_address,v_website);
  IF v_duplicate IS NOT NULL THEN RETURN v_duplicate; END IF;
  INSERT INTO public.sales_partner_clients(id,sales_partner_id,my_company_id,kind,organization_id,name,company,email,phone,position,tax_id,address,website)
    VALUES(v_id,v_partner,p_company_id,v_kind,v_organization,v_name,v_company,v_email,v_phone,v_position,v_tax_id,v_address,v_website);
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Kontakt z tymi danymi już istnieje. Otwórz jego edycję zamiast dodawać kolejny wpis.';
END;
$save$;
REVOKE ALL ON FUNCTION public.save_seller_portal_contact(uuid,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_contact(uuid,jsonb,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_seller_portal_contact(p_contact_id uuid, p_revision integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $delete$
DECLARE v_partner uuid := public.current_sales_partner_id(); v_old public.sales_partner_clients%ROWTYPE;
BEGIN
  IF v_partner IS NULL THEN RAISE EXCEPTION 'Brak dostępu do bazy klientów' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_old FROM public.sales_partner_clients WHERE id=p_contact_id AND sales_partner_id=v_partner;
  IF NOT FOUND OR v_old.deleted_at IS NOT NULL THEN RETURN true; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id=v_partner
    AND t.my_company_id=v_old.my_company_id AND t.is_active) THEN
    RAISE EXCEPTION 'Brak dostępu do bazy klientów tej marki' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('seller-clients:' || v_partner::text || ':' || v_old.my_company_id::text, 0));
  SELECT * INTO v_old FROM public.sales_partner_clients WHERE id=p_contact_id AND sales_partner_id=v_partner FOR UPDATE;
  IF NOT FOUND OR v_old.deleted_at IS NOT NULL THEN RETURN true; END IF;
  IF v_old.revision IS DISTINCT FROM p_revision THEN
    RAISE EXCEPTION 'Kontakt zmieniła inna osoba lub karta przeglądarki. Odśwież listę przed usunięciem.' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sales_partner_clients WHERE organization_id=p_contact_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Organizacja ma przypisane osoby. Najpierw przenieś je do innej organizacji lub zmień na kontakty indywidualne.';
  END IF;
  -- Recoverable deletion: retain the row for administrators but remove it
  -- from every seller read, picker and future relationship selection.
  UPDATE public.sales_partner_clients SET deleted_at=now(), updated_at=now(), revision=revision+1
    WHERE id=p_contact_id AND sales_partner_id=v_partner;
  RETURN true;
END;
$delete$;
REVOKE ALL ON FUNCTION public.delete_seller_portal_contact(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_seller_portal_contact(uuid,integer) TO authenticated;

-- Keep the existing offer picker signature and snapshots. Edits to this address
-- book must not rewrite offers, PDFs, event clients or shared CRM contacts.
CREATE OR REPLACE FUNCTION public.search_seller_portal_clients(p_company_id uuid, p_query text DEFAULT '')
RETURNS TABLE(id uuid,name text,company text,email text,phone text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $search$
  SELECT c.id, CASE WHEN c.kind='organization' THEN '' ELSE c.name END,
    COALESCE(org.company,c.company), c.email, c.phone
  FROM public.sales_partner_clients c
  LEFT JOIN public.sales_partner_clients org ON org.id=c.organization_id
    AND org.sales_partner_id=c.sales_partner_id AND org.my_company_id=c.my_company_id AND org.kind='organization'
  WHERE c.sales_partner_id=public.current_sales_partner_id() AND c.my_company_id=p_company_id AND c.deleted_at IS NULL
    AND (COALESCE(btrim(p_query),'')='' OR strpos(lower(concat_ws(' ',c.name,COALESCE(org.company,c.company),c.email,c.phone,c.position)),lower(btrim(p_query)))>0)
  ORDER BY c.name,COALESCE(org.company,c.company),c.id LIMIT 30;
$search$;
REVOKE ALL ON FUNCTION public.search_seller_portal_clients(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_seller_portal_clients(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_seller_portal_client(p_company_id uuid,p_client jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $legacy$
DECLARE v_partner uuid:=public.current_sales_partner_id(); v_id uuid;
  v_name text:=btrim(COALESCE(p_client->>'name','')); v_company text:=btrim(COALESCE(p_client->>'company',''));
  v_email text:=lower(btrim(COALESCE(p_client->>'email',''))); v_phone text:=btrim(COALESCE(p_client->>'phone',''));
BEGIN
  IF v_partner IS NULL OR NOT EXISTS(SELECT 1 FROM public.sales_partner_brand_terms t
    WHERE t.sales_partner_id=v_partner AND t.my_company_id=p_company_id AND t.is_active) THEN
    RAISE EXCEPTION 'Brak dostępu do bazy klientów tej marki' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(p_client) IS DISTINCT FROM 'object' OR (v_name='' AND v_company='') THEN RAISE EXCEPTION 'Podaj nazwę klienta lub firmy'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('seller-clients:' || v_partner::text || ':' || p_company_id::text,0));
  SELECT c.id INTO v_id FROM public.sales_partner_clients c
  LEFT JOIN public.sales_partner_clients org ON org.id=c.organization_id AND org.sales_partner_id=v_partner AND org.my_company_id=p_company_id
  WHERE c.sales_partner_id=v_partner AND c.my_company_id=p_company_id AND c.deleted_at IS NULL
    AND CASE WHEN c.kind='organization' THEN '' ELSE c.name END=v_name
    AND COALESCE(org.company,c.company)=v_company AND c.email=v_email AND c.phone=v_phone
  ORDER BY c.id LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  -- Free-text company names entered in an offer remain unlinked until the seller
  -- explicitly selects an organization in Contacts. No name-based merging.
  RETURN public.save_seller_portal_contact(p_company_id,jsonb_build_object(
    'id',gen_random_uuid(),'kind',CASE WHEN v_name='' THEN 'organization' ELSE 'person' END,
    'name',v_name,'company',v_company,'email',v_email,'phone',v_phone),0);
END;
$legacy$;
REVOKE ALL ON FUNCTION public.save_seller_portal_client(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_client(uuid,jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
