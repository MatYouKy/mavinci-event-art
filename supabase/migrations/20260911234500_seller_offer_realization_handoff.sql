BEGIN;

-- Explicit CRM confirmation now accepts the order, not only its PDF/resources.
-- No historical approvals are converted by this migration. CRM can finish them
-- individually with confirm_seller_offer_realization. Ordinary arrangement saves
-- remain independent of the acceptance decision.
CREATE OR REPLACE FUNCTION public.seller_offer_can_create_event(p_offer_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT COALESCE(public.current_session_is_seller_portal(),true)
    AND public.seller_offer_can_manage(p_offer_id)
    AND EXISTS (SELECT 1 FROM public.employees e WHERE e.id=public.current_employee_id() AND e.is_active
      AND (e.role::text='admin' OR e.access_level::text='admin'
        OR COALESCE(e.permissions,'{}'::text[]) && ARRAY['admin','events_manage','calendar_manage']::text[]));
$$;

CREATE OR REPLACE FUNCTION public.confirm_seller_offer_realization(p_offer_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_offer public.offers%ROWTYPE; v_review public.seller_offer_reviews%ROWTYPE;
  v_event public.events%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(public.current_session_is_seller_portal(),true)
    OR NOT COALESCE(public.seller_offer_can_manage(p_offer_id),false) THEN RAISE EXCEPTION 'Brak uprawnień do potwierdzenia realizacji'; END IF;
  SELECT * INTO STRICT v_offer FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal' FOR UPDATE;
  SELECT * INTO v_review FROM public.seller_offer_reviews WHERE offer_id=p_offer_id FOR UPDATE;
  IF v_review.status IS DISTINCT FROM 'approved' OR v_review.document_id IS DISTINCT FROM p_document_id
    OR v_review.source_key IS DISTINCT FROM public.seller_offer_source_key(p_offer_id) THEN
    RAISE EXCEPTION 'Potwierdzenie nie dotyczy aktualnej oferty. Odśwież status i rozpatrz aktualną wersję.';
  END IF;
  IF v_offer.status::text NOT IN ('draft','sent','viewed','accepted') THEN
    RAISE EXCEPTION 'Nie można przyjąć odrzuconej, anulowanej lub wygasłej oferty. Najpierw wyjaśnij jej status.';
  END IF;
  IF v_offer.event_id IS NOT NULL THEN
    SELECT * INTO v_event FROM public.events WHERE id=v_offer.event_id FOR UPDATE;
    IF v_event.id IS NULL OR v_event.my_company_id IS DISTINCT FROM v_offer.my_company_id
      OR NOT COALESCE(public.current_employee_can_view_event(v_event.id),false)
      OR NOT COALESCE(public.seller_offer_can_create_event(p_offer_id),false) THEN
      RAISE EXCEPTION 'Brak uprawnień do powiązanego wydarzenia lub niezgodna marka';
    END IF;
    IF v_event.status::text='cancelled' THEN RAISE EXCEPTION 'Wydarzenie jest anulowane. Nie zostanie automatycznie przywrócone.'; END IF;
  END IF;
  IF v_offer.status::text<>'accepted' THEN
    UPDATE public.offers SET status='accepted',accepted_at=COALESCE(accepted_at,now()),partner_last_activity_at=now()
      WHERE id=p_offer_id;
    INSERT INTO public.partner_offer_activities(offer_id,sales_partner_id,activity_type,metadata)
      VALUES(p_offer_id,v_offer.sales_partner_id,'accepted',jsonb_build_object(
        'source','crm_realization_confirmation','document_id',p_document_id,'actor',auth.uid()));
  END IF;
  -- Also repair an explicitly confirmed, already accepted offer's early event
  -- status; never regress operational/archive stages or reopen cancellations.
  UPDATE public.events SET status='offer_accepted',updated_at=now()
    WHERE id=v_offer.event_id AND my_company_id=v_offer.my_company_id
      AND status::text IN ('inquiry','offer_to_send','offer_sent');
  RETURN jsonb_build_object('offer_status','accepted','event_id',v_offer.event_id,
    'can_create_event',public.seller_offer_can_create_event(p_offer_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.review_seller_offer_and_confirm(
  p_offer_id uuid,p_document_id uuid,p_decision text,p_checks jsonb,p_response text,
  p_discount numeric DEFAULT 0,p_special_request boolean DEFAULT false,p_reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR COALESCE(public.current_session_is_seller_portal(),true)
    OR NOT COALESCE(public.seller_offer_can_manage(p_offer_id),false) THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
  PERFORM 1 FROM public.offers WHERE id=p_offer_id FOR UPDATE;
  -- A retry after an uncertain response must not apply the discount twice.
  IF p_decision='approved' AND EXISTS (SELECT 1 FROM public.seller_offer_reviews r
    WHERE r.offer_id=p_offer_id AND r.document_id=p_document_id AND r.status='approved'
      AND r.source_key=public.seller_offer_source_key(p_offer_id)) THEN
    RETURN public.confirm_seller_offer_realization(p_offer_id,p_document_id);
  END IF;
  PERFORM public.review_seller_offer_resources(p_offer_id,p_document_id,p_decision,p_checks,
    p_response,p_discount,p_special_request,p_reason);
  IF p_decision='approved' THEN RETURN public.confirm_seller_offer_realization(p_offer_id,p_document_id); END IF;
  RETURN jsonb_build_object('success',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_event_draft(p_offer_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_offer public.offers%ROWTYPE; v_values public.seller_offer_arrangements%ROWTYPE;
BEGIN
  IF NOT COALESCE(public.seller_offer_can_create_event(p_offer_id),false) THEN
    RAISE EXCEPTION 'Utworzenie wydarzenia wymaga uprawnień do ofert i wydarzeń tej marki';
  END IF;
  SELECT * INTO STRICT v_offer FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal';
  IF v_offer.status::text<>'accepted' THEN RAISE EXCEPTION 'Najpierw potwierdź realizację'; END IF;
  IF v_offer.event_id IS NOT NULL AND NOT COALESCE(public.current_employee_can_view_event(v_offer.event_id),false) THEN
    RAISE EXCEPTION 'Brak dostępu do powiązanego wydarzenia';
  END IF;
  SELECT * INTO v_values FROM public.seller_offer_arrangements WHERE offer_id=p_offer_id;
  RETURN jsonb_build_object('event_id',v_offer.event_id,'source_key',public.seller_offer_source_key(p_offer_id),
    'revision',COALESCE(v_values.revision,0),'brand_name',(SELECT name FROM public.my_companies WHERE id=v_offer.my_company_id),
    'offer_number',v_offer.offer_number,'name',COALESCE(NULLIF(v_offer.title,''),'Realizacja '||v_offer.offer_number),
    'location',COALESCE(v_offer.event_location,''),'description',COALESCE(v_offer.description,''),
    'setup_at',to_char(v_values.setup_at,'YYYY-MM-DD"T"HH24:MI'),
    'starts_at',COALESCE(to_char(v_values.starts_at,'YYYY-MM-DD"T"HH24:MI'),left(v_offer.event_date::text,10)),
    'ends_at',to_char(v_values.ends_at,'YYYY-MM-DD"T"HH24:MI'),
    'teardown_at',to_char(v_values.teardown_at,'YYYY-MM-DD"T"HH24:MI'),
    'client',jsonb_build_object('name',v_offer.portal_client_name,'company',v_offer.portal_client_company,
      'email',v_offer.portal_client_email,'phone',v_offer.portal_client_phone),
    'arrangements',COALESCE(to_jsonb(v_values)-'updated_by','{}'::jsonb),
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'quantity',i.quantity,'unit',i.unit)
      ORDER BY i.display_order,i.id) FROM public.offer_items i WHERE i.offer_id=p_offer_id),'[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.create_event_from_seller_offer(p_offer_id uuid,p_source_key text,p_revision integer,p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_offer public.offers%ROWTYPE; v_arr public.seller_offer_arrangements%ROWTYPE;
  v_event uuid; v_key text; v_text text; v_local timestamp; v_dates jsonb:='{}'::jsonb;
  v_start timestamptz; v_end timestamptz; v_setup timestamptz; v_teardown timestamptz;
  v_category uuid; v_description text;
BEGIN
  IF NOT COALESCE(public.seller_offer_can_create_event(p_offer_id),false) THEN RAISE EXCEPTION 'Brak uprawnień do utworzenia wydarzenia tej marki'; END IF;
  -- The offer is the idempotency key, shared by every browser/tab/CRM operator.
  SELECT * INTO STRICT v_offer FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal' FOR UPDATE;
  IF v_offer.event_id IS NOT NULL THEN
    IF NOT COALESCE(public.current_employee_can_view_event(v_offer.event_id),false)
      OR NOT EXISTS(SELECT 1 FROM public.events WHERE id=v_offer.event_id AND my_company_id=v_offer.my_company_id) THEN
      RAISE EXCEPTION 'Brak dostępu do istniejącego wydarzenia';
    END IF;
    RETURN jsonb_build_object('event_id',v_offer.event_id,'already_created',true);
  END IF;
  SELECT * INTO v_arr FROM public.seller_offer_arrangements WHERE offer_id=p_offer_id FOR UPDATE;
  IF v_offer.status::text<>'accepted' OR NOT EXISTS (SELECT 1 FROM public.seller_offer_reviews r WHERE r.offer_id=p_offer_id
    AND r.status='approved' AND r.source_key=public.seller_offer_source_key(p_offer_id)) THEN
    RAISE EXCEPTION 'Oferta nie ma aktualnego potwierdzenia. Odśwież jej status.';
  END IF;
  IF p_source_key IS DISTINCT FROM public.seller_offer_source_key(p_offer_id)
    OR p_revision IS DISTINCT FROM COALESCE(v_arr.revision,0) THEN
    RAISE EXCEPTION 'Oferta lub ustalenia zmieniły się podczas uzupełniania formularza. Zamknij go i wczytaj aktualne dane.';
  END IF;
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object'
    OR COALESCE(length(btrim(p_values->>'name')),0) NOT BETWEEN 1 AND 250
    OR length(COALESCE(p_values->>'location',''))>1000
    OR length(COALESCE(p_values->>'description',''))>10000 THEN RAISE EXCEPTION 'Sprawdź nazwę, miejsce i opis wydarzenia'; END IF;
  FOREACH v_key IN ARRAY ARRAY['setup_at','starts_at','ends_at','teardown_at'] LOOP
    v_text:=NULLIF(btrim(p_values->>v_key),'');
    IF v_text IS NOT NULL THEN
      IF v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$' THEN RAISE EXCEPTION 'Podaj poprawną datę i godzinę'; END IF;
      v_local:=v_text::timestamp;
      IF NOT isfinite(v_local) OR (v_local AT TIME ZONE 'Europe/Warsaw') AT TIME ZONE 'Europe/Warsaw'<>v_local THEN
        RAISE EXCEPTION 'Nieprawidłowa godzina w strefie Europe/Warsaw';
      END IF;
      v_dates:=v_dates||jsonb_build_object(v_key,v_local AT TIME ZONE 'Europe/Warsaw');
    END IF;
  END LOOP;
  v_start:=(v_dates->>'starts_at')::timestamptz; v_end:=(v_dates->>'ends_at')::timestamptz;
  v_setup:=(v_dates->>'setup_at')::timestamptz; v_teardown:=(v_dates->>'teardown_at')::timestamptz;
  IF v_start IS NULL THEN RAISE EXCEPTION 'Uzupełnij datę i godzinę rozpoczęcia wydarzenia'; END IF;
  IF v_end<v_start OR v_setup>v_start OR v_teardown<COALESCE(v_end,v_start) THEN RAISE EXCEPTION 'Sprawdź kolejność montażu, wydarzenia i demontażu'; END IF;
  v_category:=NULLIF(p_values->>'category_id','')::uuid;
  IF v_category IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_categories WHERE id=v_category AND is_active) THEN
    RAISE EXCEPTION 'Wybrana kategoria nie jest aktywna';
  END IF;
  -- Preserve customer and organizational contacts without guessing that the
  -- seller/hotel is the end client or creating duplicate CRM contact records.
  v_description:=concat_ws(E'\n\n',NULLIF(btrim(p_values->>'description'),''),
    'Źródło: oferta sprzedawcy '||COALESCE(v_offer.offer_number,v_offer.id::text),
    'Klient: '||concat_ws(' · ',NULLIF(v_offer.portal_client_company,''),NULLIF(v_offer.portal_client_name,''),
      NULLIF(v_offer.portal_client_email,''),NULLIF(v_offer.portal_client_phone,'')),
    CASE WHEN NULLIF(v_arr.room,'') IS NOT NULL THEN 'Sala: '||v_arr.room END,
    CASE WHEN v_arr.participant_count IS NOT NULL THEN 'Liczba uczestników: '||v_arr.participant_count END,
    CASE WHEN v_arr.materials_due_date IS NOT NULL THEN 'Materiały do: '||to_char(v_arr.materials_due_date,'DD.MM.YYYY') END,
    CASE WHEN NULLIF(v_arr.technical_requirements,'') IS NOT NULL THEN 'Wymagania techniczne: '||v_arr.technical_requirements END,
    CASE WHEN NULLIF(v_arr.logistics_requirements,'') IS NOT NULL THEN 'Logistyka: '||v_arr.logistics_requirements END,
    (SELECT string_agg(concat_ws(' · ',c->>'name',NULLIF(c->>'role',''),NULLIF(c->>'email',''),NULLIF(c->>'phone','')),E'\n')
      FROM jsonb_array_elements(COALESCE(v_arr.contacts,'[]'::jsonb)) c));
  INSERT INTO public.events(name,description,event_date,event_end_date,planned_setup_at,planned_teardown_at,
    location,status,my_company_id,category_id,created_by)
    VALUES(btrim(p_values->>'name'),v_description,v_start,v_end,v_setup,v_teardown,
      NULLIF(btrim(p_values->>'location'),''),'offer_accepted',v_offer.my_company_id,v_category,public.current_employee_id())
    RETURNING id INTO v_event;
  -- Retain original items, financial amounts, immutable PDFs and the same chat.
  -- Normal offer/event finance triggers run as part of this transaction.
  UPDATE public.offers SET event_id=v_event WHERE id=p_offer_id;
  INSERT INTO public.partner_offer_activities(offer_id,sales_partner_id,activity_type,metadata)
    VALUES(p_offer_id,v_offer.sales_partner_id,'accepted',jsonb_build_object(
      'source','crm_event_created','event_id',v_event,'arrangements_revision',COALESCE(v_arr.revision,0),'actor',auth.uid()));
  RETURN jsonb_build_object('event_id',v_event,'already_created',false);
END;
$$;

-- Sending the accepted PDF must never turn a confirmed realization back into
-- an offer, nor release resources through the accepted -> sent status trigger.
CREATE OR REPLACE FUNCTION public.complete_seller_offer_email(p_delivery_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row record; v_partner uuid;
BEGIN
  SELECT x.*,d.offer_id,d.source_key INTO v_row FROM public.seller_offer_email_deliveries x
    JOIN public.seller_offer_documents d ON d.id=x.document_id WHERE x.id=p_delivery_id FOR UPDATE OF x;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono wysyłki'; END IF;
  IF v_row.status='sent' THEN RETURN; END IF;
  UPDATE public.seller_offer_email_deliveries SET status='sent',sent_at=now() WHERE id=p_delivery_id;
  UPDATE public.offers SET status=CASE WHEN status::text IN ('draft','sent','viewed') THEN 'sent' ELSE status END,
    sent_at=now(),partner_last_activity_at=now()
    WHERE id=v_row.offer_id AND public.seller_offer_source_key(id)=v_row.source_key;
  SELECT sales_partner_id INTO v_partner FROM public.offers WHERE id=v_row.offer_id;
  INSERT INTO public.partner_offer_activities(offer_id,sales_partner_id,activity_type,metadata)
    VALUES(v_row.offer_id,v_partner,'sent',jsonb_build_object('document_id',v_row.document_id,'recipient',v_row.recipient));
END;
$$;

REVOKE ALL ON FUNCTION public.seller_offer_can_create_event(uuid),public.confirm_seller_offer_realization(uuid,uuid),
  public.review_seller_offer_and_confirm(uuid,uuid,text,jsonb,text,numeric,boolean,text),public.get_seller_event_draft(uuid),
  public.create_event_from_seller_offer(uuid,text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.seller_offer_can_create_event(uuid),public.confirm_seller_offer_realization(uuid,uuid),
  public.review_seller_offer_and_confirm(uuid,uuid,text,jsonb,text,numeric,boolean,text),public.get_seller_event_draft(uuid),
  public.create_event_from_seller_offer(uuid,text,integer,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.complete_seller_offer_email(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_seller_offer_email(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
