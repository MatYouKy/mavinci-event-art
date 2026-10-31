BEGIN;

-- CRM owns the execution company and the single organization for NEW offers.
-- Previously saved offers keep their original pricing and organization snapshots.
ALTER TABLE public.sales_partner_profiles ADD COLUMN IF NOT EXISTS portal_default_company_id uuid
  REFERENCES public.my_companies(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.seller_default_offer_organization(p_partner uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT p.organization_id FROM public.sales_partner_profiles p WHERE p.id=p_partner
    AND EXISTS(SELECT 1 FROM public.seller_partner_organization_ids(p_partner) h WHERE h.organization_id=p.organization_id);
$$;
REVOKE ALL ON FUNCTION public.seller_default_offer_organization(uuid) FROM PUBLIC,anon,authenticated;

-- Keep an explicit message for older portal tabs instead of accepting a choice
-- that would no longer affect newly created offers.
CREATE OR REPLACE FUNCTION public.save_seller_default_offer_organization(p_organization uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Organizację nowych ofert przypisuje opiekun w CRM. Odśwież portal.';
END; $$;
REVOKE ALL ON FUNCTION public.save_seller_default_offer_organization(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_seller_default_offer_organization(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_seller_offer_editor_context(p_offer uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  p public.sales_partner_profiles%ROWTYPE;
  o public.offers%ROWTYPE;
  company_id uuid;
  organization_id uuid;
  available_companies uuid[];
  hotel boolean;
  arrangements jsonb;
BEGIN
  SELECT * INTO p FROM public.sales_partner_profiles
    WHERE id=public.current_sales_partner_id() AND portal_enabled AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Brak dostępu do portalu' USING ERRCODE='42501'; END IF;
  IF p_offer IS NOT NULL THEN
    SELECT * INTO o FROM public.offers WHERE id=p_offer AND sales_partner_id=p.id AND sales_channel='seller_portal';
    IF NOT FOUND THEN RAISE EXCEPTION 'Brak dostępu do oferty' USING ERRCODE='42501'; END IF;
    company_id:=o.my_company_id; organization_id:=o.partner_organization_id;
    arrangements:=public.get_seller_offer_arrangements(p_offer);
  ELSE
    organization_id:=p.organization_id;
    IF organization_id IS NULL THEN RAISE EXCEPTION 'Opiekun musi przypisać organizację do Twojego profilu w CRM przed utworzeniem oferty.'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.seller_partner_organization_ids(p.id) h WHERE h.organization_id=p.organization_id) THEN
      RAISE EXCEPTION 'Powiązanie organizacji jest nieaktualne. Poproś opiekuna o aktualizację profilu w CRM.';
    END IF;
    SELECT array_agg(t.my_company_id ORDER BY t.my_company_id) INTO available_companies
      FROM public.sales_partner_brand_terms t JOIN public.my_companies c ON c.id=t.my_company_id
      WHERE t.sales_partner_id=p.id AND t.is_active AND c.is_active;
    IF p.portal_default_company_id=ANY(available_companies) THEN company_id:=p.portal_default_company_id;
    ELSIF cardinality(available_companies)=1 THEN company_id:=available_companies[1];
    ELSE RAISE EXCEPTION 'Opiekun musi wskazać domyślny cennik nowych ofert w profilu sprzedawcy w CRM.';
    END IF;
  END IF;
  SELECT COALESCE(org.business_type='hotel' OR p.partner_type='hotel_employee',false) INTO hotel
    FROM public.organizations org WHERE org.id=organization_id;
  IF p_offer IS NULL AND COALESCE(hotel,false) AND NOT EXISTS(
    SELECT 1 FROM public.organizations org JOIN public.locations l ON l.id=org.location_id WHERE org.id=organization_id
  ) THEN RAISE EXCEPTION 'Hotel nie ma przypisanej lokalizacji. Poproś opiekuna o jej uzupełnienie w CRM.'; END IF;
  RETURN jsonb_build_object('company_id',company_id,'organization_id',organization_id,
    'branding',public.resolve_seller_offer_branding_for_organization(p.id,company_id,organization_id),
    'hotel',CASE WHEN COALESCE(hotel,false) THEN public.get_seller_hotel_context(p_offer,organization_id) ELSE NULL END,
    'arrangements',arrangements);
END; $$;
REVOKE ALL ON FUNCTION public.get_seller_offer_editor_context(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_seller_offer_editor_context(uuid) TO authenticated;

-- One transaction and the existing idempotency ledger: retrying cannot create
-- a second offer or increment arrangements twice. Other arrangements stay intact.
CREATE OR REPLACE FUNCTION public.save_seller_portal_offer_v3(p_request_id uuid,p_offer jsonb,p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  partner uuid:=public.current_sales_partner_id();
  offer_id uuid; saved_hash text; editor jsonb; venue jsonb; hotel jsonb; room jsonb; values_before jsonb;
BEGIN
  IF partner IS NULL OR p_request_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.sales_partner_profiles WHERE id=partner AND portal_enabled AND status='active'
  ) THEN RAISE EXCEPTION 'Brak dostępu do portalu' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_offer) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Nieprawidłowe dane oferty'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(partner::text||p_request_id::text,0));
  SELECT r.offer_id,r.request_hash INTO offer_id,saved_hash FROM public.seller_offer_save_requests r
    WHERE r.sales_partner_id=partner AND r.request_id=p_request_id;
  IF FOUND THEN
    IF saved_hash IS DISTINCT FROM md5(p_offer::text||p_items::text) THEN RAISE EXCEPTION 'Poprzedni zapis się zakończył. Otwórz zapisaną ofertę.'; END IF;
    RETURN offer_id;
  END IF;
  IF NULLIF(p_offer->>'id','') IS NOT NULL THEN
    PERFORM 1 FROM public.offers WHERE id=(p_offer->>'id')::uuid AND sales_partner_id=partner FOR UPDATE;
  END IF;
  editor:=public.get_seller_offer_editor_context(NULLIF(p_offer->>'id','')::uuid);
  IF NULLIF(p_offer->>'my_company_id','') IS DISTINCT FROM editor->>'company_id'
    OR NULLIF(p_offer->>'organization_id','') IS DISTINCT FROM editor->>'organization_id' THEN
    RAISE EXCEPTION 'Ustawienia organizacji lub cennika zmienił opiekun. Otwórz ponownie kreator oferty.';
  END IF;
  offer_id:=public.save_seller_portal_offer_v2(p_request_id,p_offer,p_items);
  IF p_offer ? 'venue_selection' THEN
    venue:=p_offer->'venue_selection';
    IF jsonb_typeof(venue) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Wybierz przestrzeń z bazy hotelu'; END IF;
    values_before:=public.get_seller_offer_arrangements(offer_id)->'values';
    IF (venue->>'revision')::integer IS DISTINCT FROM COALESCE((values_before->>'revision')::integer,0) THEN
      RAISE EXCEPTION 'Ustalenia zmieniła inna osoba. Wczytaj ponownie ofertę przed zmianą przestrzeni.';
    END IF;
    IF NULLIF(venue->>'room_id','') IS NOT NULL THEN
      hotel:=public.get_seller_hotel_context(offer_id,(editor->>'organization_id')::uuid);
      SELECT value INTO room FROM jsonb_array_elements(COALESCE(hotel#>'{location,rooms}','[]'::jsonb))
        WHERE value->>'id'=venue->>'room_id';
      IF room IS NULL THEN RAISE EXCEPTION 'Przestrzeń nie jest już dostępna. Wczytaj ponownie listę hotelu.'; END IF;
      values_before:=COALESCE(values_before,'{}'::jsonb)||jsonb_build_object('room',room->>'name','venue_snapshot',
        jsonb_build_object('organization_id',hotel#>>'{organization,id}','location_id',hotel#>>'{location,id}','room',room));
    ELSE
      values_before:=COALESCE(values_before,'{}'::jsonb)||jsonb_build_object('room','','venue_snapshot',NULL);
    END IF;
    PERFORM public.save_seller_offer_arrangements(offer_id,(venue->>'revision')::integer,values_before);
  END IF;
  RETURN offer_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_seller_portal_offer_v3(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_offer_v3(uuid,jsonb,jsonb) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
