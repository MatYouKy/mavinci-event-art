BEGIN;

-- Requires 20260928130000_seller_hotel_venue_directory.sql.
-- Shared hotel data remains read-only in the seller portal. Resolve all current
-- contact/organization links without changing branding or the primary employer.
CREATE OR REPLACE FUNCTION public.seller_partner_hotel_ids(p_partner uuid)
RETURNS TABLE(organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT org.id
  FROM public.sales_partner_profiles p
  JOIN public.organizations org ON (
    EXISTS(SELECT 1 FROM public.contact_organizations r
      WHERE r.contact_id=p.contact_id AND r.organization_id=org.id AND r.is_current)
    OR (org.id=p.organization_id AND NOT EXISTS(
      SELECT 1 FROM public.contact_organizations r
      WHERE r.contact_id=p.contact_id AND r.organization_id=org.id))
  )
  WHERE p.id=p_partner AND (org.business_type='hotel' OR EXISTS(
    SELECT 1 FROM public.sales_partner_profiles hp
    WHERE hp.organization_id=org.id AND hp.partner_type='hotel_employee'));
$$;
-- Internal helper only: callers cannot enumerate other partners' organizations.
REVOKE ALL ON FUNCTION public.seller_partner_hotel_ids(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.seller_hotel_read_access(p_organization uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organizations org WHERE org.id=p_organization
      AND (org.business_type='hotel' OR EXISTS(SELECT 1 FROM public.sales_partner_profiles hp
        WHERE hp.organization_id=org.id AND hp.partner_type='hotel_employee'))
      AND CASE WHEN public.current_session_is_seller_portal() THEN EXISTS (
        SELECT 1 FROM public.sales_partner_profiles p WHERE p.id=public.current_sales_partner_id()
          AND p.portal_enabled AND p.status='active'
          AND EXISTS(SELECT 1 FROM public.seller_partner_hotel_ids(p.id) h WHERE h.organization_id=org.id)
          AND EXISTS(SELECT 1 FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id=p.id AND t.is_active)
      ) ELSE EXISTS (
        SELECT 1 FROM public.employees e WHERE e.id=public.current_employee_id() AND e.is_active
          AND (e.role::text='admin' OR e.access_level::text='admin' OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[]))
            OR (COALESCE(e.permissions,'{}'::text[]) && ARRAY['contacts_view','contacts_manage','locations_view','locations_manage']
              AND EXISTS(SELECT 1 FROM public.sales_partner_profiles p JOIN public.contacts c ON c.id=p.contact_id
                JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=p.id AND t.is_active
                WHERE c.owner_id=e.id AND public.seller_workspace_staff_access(t.my_company_id)
                  AND EXISTS(SELECT 1 FROM public.seller_partner_hotel_ids(p.id) h WHERE h.organization_id=org.id))))
      ) END
  );
$$;

CREATE OR REPLACE FUNCTION public.get_seller_hotel_context(p_offer uuid DEFAULT NULL,p_organization uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_org uuid:=p_organization;
  v_partner uuid;
  v_hotels jsonb:='[]'::jsonb;
  v_result jsonb;
  v_portal boolean:=COALESCE(public.current_session_is_seller_portal(),false);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Zaloguj się ponownie' USING ERRCODE='42501'; END IF;
  IF p_offer IS NOT NULL THEN
    IF NOT COALESCE(public.seller_arrangements_access(p_offer),false) THEN RAISE EXCEPTION 'Brak dostępu do oferty' USING ERRCODE='42501'; END IF;
    SELECT sales_partner_id INTO v_partner FROM public.offers WHERE id=p_offer;
    IF v_partner IS NULL THEN RAISE EXCEPTION 'Oferta nie ma przypisanego sprzedawcy' USING ERRCODE='42501'; END IF;
  ELSIF v_portal THEN
    v_partner:=public.current_sales_partner_id();
    IF NOT EXISTS(SELECT 1 FROM public.sales_partner_profiles p WHERE p.id=v_partner
      AND p.portal_enabled AND p.status='active'
      AND EXISTS(SELECT 1 FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id=p.id AND t.is_active)) THEN
      RAISE EXCEPTION 'Brak dostępu do portalu sprzedawcy' USING ERRCODE='42501';
    END IF;
  END IF;

  IF v_partner IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',org.id,'name',COALESCE(NULLIF(org.alias,''),org.name))
      ORDER BY COALESCE(NULLIF(org.alias,''),org.name),org.id),'[]'::jsonb)
    INTO v_hotels FROM public.seller_partner_hotel_ids(v_partner) h
      JOIN public.organizations org ON org.id=h.organization_id;
    IF v_org IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(v_hotels) h WHERE h->>'id'=v_org::text) THEN
      RAISE EXCEPTION 'Ten hotel nie jest aktualnie powiązany ze sprzedawcą' USING ERRCODE='42501';
    END IF;
    -- Restore the saved venue only while its hotel is still linked. With several
    -- hotels and no saved selection, require an explicit choice instead of guessing.
    IF v_org IS NULL AND p_offer IS NOT NULL THEN
      SELECT h.organization_id INTO v_org FROM public.seller_partner_hotel_ids(v_partner) h
        JOIN public.seller_offer_arrangements a ON a.offer_id=p_offer
          AND a.venue_snapshot->>'organization_id'=h.organization_id::text;
    END IF;
    IF v_org IS NULL AND jsonb_array_length(v_hotels)=1 THEN v_org:=(v_hotels->0->>'id')::uuid; END IF;
  ELSIF v_org IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.organizations org WHERE org.id=v_org
      AND (org.business_type='hotel' OR EXISTS(SELECT 1 FROM public.sales_partner_profiles hp
        WHERE hp.organization_id=org.id AND hp.partner_type='hotel_employee'))) THEN
      RETURN jsonb_build_object('available',false,'can_edit',false,'organizations',v_hotels,'organization',NULL,'location',NULL,'contacts','[]'::jsonb);
    END IF;
    IF NOT COALESCE(public.seller_hotel_read_access(v_org),false) THEN
      RAISE EXCEPTION 'Brak dostępu do danych tego hotelu' USING ERRCODE='42501';
    END IF;
    SELECT jsonb_build_array(jsonb_build_object('id',org.id,'name',COALESCE(NULLIF(org.alias,''),org.name)))
      INTO v_hotels FROM public.organizations org WHERE org.id=v_org;
  END IF;

  IF v_org IS NULL THEN
    RETURN jsonb_build_object('available',jsonb_array_length(v_hotels)>0,'can_edit',false,
      'organizations',v_hotels,'organization',NULL,'location',NULL,'contacts','[]'::jsonb);
  END IF;
  -- An authorized CRM offer reader may view the hotels of that offer's seller,
  -- never an arbitrary hotel supplied in p_organization.
  IF NOT COALESCE(public.seller_hotel_read_access(v_org),false) AND NOT (p_offer IS NOT NULL AND NOT v_portal) THEN
    RAISE EXCEPTION 'Brak dostępu do danych tego hotelu' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object('available',true,
    'can_edit',NOT v_portal AND EXISTS(SELECT 1 FROM public.employees e
      WHERE e.id=auth.uid() AND e.is_active AND ('admin'=ANY(e.permissions) OR 'locations_manage'=ANY(e.permissions))),
    'organizations',v_hotels,
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

-- Preserve revision checks, audit, snapshots and approval semantics. Only the
-- lookup of a newly chosen room now explicitly selects its authorized hotel.
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
    IF jsonb_typeof(v_snapshot) IS DISTINCT FROM 'object'
      OR COALESCE(v_snapshot->>'organization_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'Wybierz przestrzeń z bazy hotelu';
    END IF;
    v_hotel:=public.get_seller_hotel_context(p_offer,(v_snapshot->>'organization_id')::uuid);
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

REVOKE ALL ON FUNCTION public.seller_hotel_read_access(uuid),public.get_seller_hotel_context(uuid,uuid),
  public.save_seller_offer_arrangements(uuid,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.seller_hotel_read_access(uuid),public.get_seller_hotel_context(uuid,uuid),
  public.save_seller_offer_arrangements(uuid,integer,jsonb) TO authenticated;
-- Existing storage SELECT policy uses seller_hotel_read_access, so the exact
-- published files of all linked hotels work too. No storage write policy changes.

NOTIFY pgrst,'reload schema';
COMMIT;
