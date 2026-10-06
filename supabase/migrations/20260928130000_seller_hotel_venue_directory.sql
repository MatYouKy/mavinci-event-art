BEGIN;

-- Read-only hotel suggestions. No new portal permission to change shared
-- locations, contacts, organization relations or uploaded hotel materials.
CREATE OR REPLACE FUNCTION public.seller_hotel_read_access(p_organization uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organizations org WHERE org.id=p_organization
      AND (org.business_type='hotel' OR EXISTS(SELECT 1 FROM public.sales_partner_profiles hp
        WHERE hp.organization_id=org.id AND hp.partner_type='hotel_employee'))
      AND CASE WHEN public.current_session_is_seller_portal() THEN EXISTS (
        SELECT 1 FROM public.sales_partner_profiles p WHERE p.id=public.current_sales_partner_id()
          AND p.organization_id=org.id AND p.portal_enabled AND p.status='active'
          AND EXISTS(SELECT 1 FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id=p.id AND t.is_active)
      ) ELSE EXISTS (
        SELECT 1 FROM public.employees e WHERE e.id=public.current_employee_id() AND e.is_active
          AND (e.role::text='admin' OR e.access_level::text='admin' OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[]))
            OR (COALESCE(e.permissions,'{}'::text[]) && ARRAY['contacts_view','contacts_manage','locations_view','locations_manage']
              AND EXISTS(SELECT 1 FROM public.sales_partner_profiles p JOIN public.contacts c ON c.id=p.contact_id
                JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=p.id AND t.is_active
                WHERE p.organization_id=org.id AND c.owner_id=e.id AND public.seller_workspace_staff_access(t.my_company_id))))
      ) END
  );
$$;

CREATE OR REPLACE FUNCTION public.get_seller_hotel_context(p_offer uuid DEFAULT NULL,p_organization uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_org uuid:=p_organization; v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Zaloguj się ponownie' USING ERRCODE='42501'; END IF;
  IF p_offer IS NOT NULL THEN
    IF NOT COALESCE(public.seller_arrangements_access(p_offer),false) THEN RAISE EXCEPTION 'Brak dostępu do oferty' USING ERRCODE='42501'; END IF;
    SELECT p.organization_id INTO v_org FROM public.offers o JOIN public.sales_partner_profiles p ON p.id=o.sales_partner_id WHERE o.id=p_offer;
  ELSIF v_org IS NULL AND public.current_session_is_seller_portal() THEN
    SELECT organization_id INTO v_org FROM public.sales_partner_profiles WHERE id=public.current_sales_partner_id();
  END IF;
  IF v_org IS NULL OR NOT EXISTS(SELECT 1 FROM public.organizations org WHERE org.id=v_org AND
    (org.business_type='hotel' OR EXISTS(SELECT 1 FROM public.sales_partner_profiles p WHERE p.organization_id=org.id AND p.partner_type='hotel_employee'))) THEN
    RETURN jsonb_build_object('available',false,'can_edit',false,'organization',NULL,'location',NULL,'contacts','[]'::jsonb);
  END IF;
  IF NOT public.seller_hotel_read_access(v_org) AND NOT (p_offer IS NOT NULL AND NOT public.current_session_is_seller_portal()) THEN
    RAISE EXCEPTION 'Brak dostępu do danych tego hotelu' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object('available',true,
    'can_edit',NOT public.current_session_is_seller_portal() AND EXISTS(SELECT 1 FROM public.employees e
      WHERE e.id=auth.uid() AND e.is_active AND ('admin'=ANY(e.permissions) OR 'locations_manage'=ANY(e.permissions))),
    'organization',jsonb_build_object('id',org.id,'name',COALESCE(NULLIF(org.alias,''),org.name)),
    'location',CASE WHEN l.id IS NULL THEN NULL ELSE jsonb_build_object('id',l.id,'name',l.name,
      'updated_at',l.updated_at,'rooms',l.rooms,'technical_details',l.technical_details) END,
    'contacts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.full_name,
      'role',COALESCE(r.position,r.department,''),'email',COALESCE(c.email,''),'phone',COALESCE(c.phone,'')) ORDER BY c.full_name,c.id)
      FROM public.contact_organizations r JOIN public.contacts c ON c.id=r.contact_id
      WHERE r.organization_id=org.id AND r.is_current AND c.status='active'),'[]'::jsonb))
  INTO v_result FROM public.organizations org LEFT JOIN public.locations l ON l.id=org.location_id WHERE org.id=v_org;
  RETURN v_result;
END; $$;

ALTER TABLE public.seller_offer_arrangements ADD COLUMN IF NOT EXISTS venue_snapshot jsonb;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.seller_offer_arrangements'::regclass AND conname='seller_arrangement_venue_snapshot_object') THEN
    ALTER TABLE public.seller_offer_arrangements ADD CONSTRAINT seller_arrangement_venue_snapshot_object
      CHECK (venue_snapshot IS NULL OR (jsonb_typeof(venue_snapshot)='object' AND octet_length(venue_snapshot::text)<=100000));
  END IF;
END; $$;

-- Only published files of the user's hotel, or the exact files saved in an
-- accessible offer. Never grant access to the whole locations/storage catalog.
CREATE OR REPLACE FUNCTION public.seller_hotel_material_read_access(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$' AND (
    EXISTS(SELECT 1 FROM public.organizations org JOIN public.locations l ON l.id=org.location_id
      WHERE public.seller_hotel_read_access(org.id)
        AND (EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(l.technical_details->'assets','[]'::jsonb)) a WHERE a->>'path'=p_name)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(l.rooms) room
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(room#>'{technical,assets}','[]'::jsonb)) a WHERE a->>'path'=p_name)))
    OR EXISTS(SELECT 1 FROM public.seller_offer_arrangements a WHERE public.seller_arrangements_access(a.offer_id)
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(a.venue_snapshot#>'{room,technical,assets}','[]'::jsonb)
        || COALESCE(a.venue_snapshot#>'{technical_details,assets}','[]'::jsonb)) asset WHERE asset->>'path'=p_name))
  );
$$;
DROP POLICY IF EXISTS "Hotel portal published materials view" ON storage.objects;
CREATE POLICY "Hotel portal published materials view" ON storage.objects FOR SELECT TO authenticated
  USING(bucket_id='location-materials' AND public.seller_hotel_material_read_access(name));

REVOKE ALL ON FUNCTION public.seller_hotel_read_access(uuid),public.get_seller_hotel_context(uuid,uuid),
  public.seller_hotel_material_read_access(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.seller_hotel_read_access(uuid),public.get_seller_hotel_context(uuid,uuid),
  public.seller_hotel_material_read_access(text) TO authenticated;

-- Existing arrangement revision/audit and approval semantics stay unchanged.
-- Only the selected room/materials are copied from the trusted hotel directory.
CREATE OR REPLACE FUNCTION public.save_seller_offer_arrangements(p_offer uuid,p_revision integer,p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_old public.seller_offer_arrangements%ROWTYPE; v_next public.seller_offer_arrangements%ROWTYPE;
  v_person jsonb; v_contacts jsonb:='[]'::jsonb; v_key text; v_text text;
  v_hotel jsonb; v_room jsonb; v_snapshot jsonb;
BEGIN
  PERFORM 1 FROM public.offers WHERE id=p_offer FOR UPDATE;
  IF NOT COALESCE(public.seller_arrangements_access(p_offer,true),false) THEN RAISE EXCEPTION 'Nie możesz zmieniać tych ustaleń. Zmiany potwierdzonej realizacji omów z opiekunem na czacie.'; END IF;
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Nieprawidłowe dane ustaleń'; END IF;
  SELECT * INTO v_old FROM public.seller_offer_arrangements WHERE offer_id=p_offer FOR UPDATE;
  IF p_revision IS DISTINCT FROM COALESCE(v_old.revision,0) THEN RAISE EXCEPTION 'Ustalenia zmieniła inna osoba. Wczytaj aktualne dane przed zapisem.'; END IF;
  FOREACH v_key IN ARRAY ARRAY['setup_at','starts_at','ends_at','teardown_at'] LOOP
    v_text:=NULLIF(btrim(p_values->>v_key),'');
    IF v_text IS NOT NULL AND v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?$' THEN RAISE EXCEPTION 'Uzupełnij poprawną datę i godzinę harmonogramu'; END IF;
  END LOOP;
  IF NULLIF(p_values->>'materials_due_date','') IS NOT NULL AND (p_values->>'materials_due_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Nieprawidłowy termin przekazania materiałów'; END IF;
  IF jsonb_typeof(COALESCE(p_values->'contacts','[]'::jsonb)) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Nieprawidłowa lista kontaktów'; END IF;
  IF jsonb_array_length(COALESCE(p_values->'contacts','[]'::jsonb))>12 THEN RAISE EXCEPTION 'Możesz dodać do 12 kontaktów organizacyjnych'; END IF;
  FOR v_person IN SELECT value FROM jsonb_array_elements(COALESCE(p_values->'contacts','[]'::jsonb)) LOOP
    IF jsonb_typeof(v_person)<>'object' OR COALESCE(length(btrim(v_person->>'name')),0) NOT BETWEEN 1 AND 160
      OR length(COALESCE(v_person->>'role',''))>100 OR length(COALESCE(v_person->>'phone',''))>50 OR length(COALESCE(v_person->>'email',''))>254 THEN
      RAISE EXCEPTION 'Uzupełnij imię i nazwisko oraz sprawdź długość danych kontaktowych';
    END IF;
    IF NULLIF(btrim(v_person->>'email'),'') IS NOT NULL AND (v_person->>'email') !~ '^[^[:space:]@,;]+@[^[:space:]@,;]+\.[^[:space:]@,;]+$' THEN RAISE EXCEPTION 'Nieprawidłowy e-mail kontaktu'; END IF;
    v_contacts:=v_contacts||jsonb_build_array(jsonb_build_object('name',btrim(v_person->>'name'),
      'role',btrim(COALESCE(v_person->>'role','')),'email',btrim(COALESCE(v_person->>'email','')),'phone',btrim(COALESCE(v_person->>'phone',''))));
  END LOOP;
  v_next.offer_id:=p_offer; v_next.revision:=COALESCE(v_old.revision,0)+1;
  v_next.room:=btrim(COALESCE(p_values->>'room',''));
  v_snapshot:=CASE WHEN p_values ? 'venue_snapshot' THEN NULLIF(p_values->'venue_snapshot','null'::jsonb)
    WHEN v_next.room=v_old.room THEN v_old.venue_snapshot ELSE NULL END;
  IF v_snapshot IS NOT NULL AND v_snapshot IS DISTINCT FROM v_old.venue_snapshot THEN
    IF jsonb_typeof(v_snapshot) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Wybierz przestrzeń z bazy hotelu'; END IF;
    v_hotel:=public.get_seller_hotel_context(p_offer);
    IF v_hotel->>'available' IS DISTINCT FROM 'true'
      OR v_snapshot->>'organization_id' IS DISTINCT FROM v_hotel#>>'{organization,id}'
      OR v_snapshot->>'location_id' IS DISTINCT FROM v_hotel#>>'{location,id}' THEN
      RAISE EXCEPTION 'Wybrana przestrzeń nie należy do hotelu sprzedawcy. Wybierz ją ponownie.';
    END IF;
    SELECT value INTO v_room FROM jsonb_array_elements(v_hotel#>'{location,rooms}') WHERE value->>'id'=v_snapshot#>>'{room,id}';
    IF v_room IS NULL THEN RAISE EXCEPTION 'Sala nie jest już dostępna w bazie hotelu. Wybierz inną przestrzeń.'; END IF;
    v_snapshot:=jsonb_build_object('organization_id',v_hotel#>>'{organization,id}',
      'organization_name',v_hotel#>>'{organization,name}','location_id',v_hotel#>>'{location,id}',
      'location_name',v_hotel#>>'{location,name}','room',v_room,'technical_details',v_hotel#>'{location,technical_details}');
  END IF;
  v_next.venue_snapshot:=v_snapshot;
  IF v_snapshot IS NOT NULL THEN v_next.room:=v_snapshot#>>'{room,name}'; END IF;
  v_next.participant_count:=NULLIF(p_values->>'participant_count','')::integer;
  v_next.setup_at:=NULLIF(p_values->>'setup_at','')::timestamp;
  v_next.starts_at:=NULLIF(p_values->>'starts_at','')::timestamp;
  v_next.ends_at:=NULLIF(p_values->>'ends_at','')::timestamp;
  v_next.teardown_at:=NULLIF(p_values->>'teardown_at','')::timestamp;
  v_next.materials_due_date:=NULLIF(p_values->>'materials_due_date','')::date;
  v_next.technical_requirements:=btrim(COALESCE(p_values->>'technical_requirements',''));
  v_next.logistics_requirements:=btrim(COALESCE(p_values->>'logistics_requirements',''));
  v_next.contacts:=v_contacts; v_next.updated_at:=now(); v_next.updated_by:=auth.uid();
  IF v_old.offer_id IS NOT NULL AND (to_jsonb(v_old)-'revision'-'updated_at'-'updated_by')=(to_jsonb(v_next)-'revision'-'updated_at'-'updated_by') THEN
    RETURN public.get_seller_offer_arrangements(p_offer);
  END IF;
  INSERT INTO public.seller_offer_arrangements SELECT (v_next).*
  ON CONFLICT(offer_id) DO UPDATE SET revision=EXCLUDED.revision,room=EXCLUDED.room,venue_snapshot=EXCLUDED.venue_snapshot,participant_count=EXCLUDED.participant_count,
    setup_at=EXCLUDED.setup_at,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,teardown_at=EXCLUDED.teardown_at,
    materials_due_date=EXCLUDED.materials_due_date,technical_requirements=EXCLUDED.technical_requirements,
    logistics_requirements=EXCLUDED.logistics_requirements,contacts=EXCLUDED.contacts,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;
  INSERT INTO public.seller_offer_arrangement_audit(offer_id,revision,before_values,after_values,actor_id)
    VALUES(p_offer,v_next.revision,CASE WHEN v_old.offer_id IS NOT NULL THEN to_jsonb(v_old) END,to_jsonb(v_next),auth.uid());
  RETURN public.get_seller_offer_arrangements(p_offer);
END; $$;
REVOKE ALL ON FUNCTION public.save_seller_offer_arrangements(uuid,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_seller_offer_arrangements(uuid,integer,jsonb) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
