BEGIN;

-- Additive seller workflow. No historical consent is inferred, and none of the
-- CRM approval, event confirmation, calendar or pricing functions are changed.
CREATE TABLE public.seller_offer_client_acceptances (
  id uuid PRIMARY KEY,
  offer_id uuid NOT NULL REFERENCES public.offers(id),
  document_id uuid NOT NULL REFERENCES public.seller_offer_documents(id),
  source_key text NOT NULL,
  confirmed_by uuid NOT NULL REFERENCES auth.users(id),
  seller_name text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  notified_recipients integer NOT NULL CHECK (notified_recipients > 0)
);
CREATE INDEX ON public.seller_offer_client_acceptances(offer_id,confirmed_at DESC);
CREATE TABLE public.seller_realization_submissions (
  id uuid PRIMARY KEY REFERENCES public.seller_messages(id),
  offer_id uuid NOT NULL REFERENCES public.offers(id),
  task_key text NOT NULL,
  arrangement_revision integer NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  submitted_by uuid NOT NULL REFERENCES auth.users(id),
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.seller_realization_submissions(offer_id,task_key,submitted_at DESC);
ALTER TABLE public.seller_offer_client_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_realization_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_offer_client_acceptances,public.seller_realization_submissions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.seller_offer_client_acceptances,public.seller_realization_submissions TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_client_and_request_seller_review(
  p_offer_id uuid,p_document_id uuid,p_request_id uuid,p_confirmed boolean,p_note text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $client_review$
DECLARE o public.offers%ROWTYPE; previous public.seller_offer_client_acceptances%ROWTYPE;
  result jsonb; actor_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.current_session_is_seller_portal(),false)
    OR p_confirmed IS DISTINCT FROM true OR p_request_id IS NULL OR p_document_id IS NULL THEN
    RAISE EXCEPTION 'Potwierdź akceptację klienta jako sprzedawca.';
  END IF;
  SELECT * INTO o FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal'
    AND sales_partner_id=public.current_sales_partner_id() FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.sales_partner_brand_terms
    WHERE sales_partner_id=o.sales_partner_id AND my_company_id=o.my_company_id AND is_active) THEN
    RAISE EXCEPTION 'Brak dostępu do tej oferty i marki.';
  END IF;
  SELECT * INTO previous FROM public.seller_offer_client_acceptances WHERE id=p_request_id;
  IF FOUND THEN
    IF previous.offer_id<>p_offer_id OR previous.document_id<>p_document_id OR previous.confirmed_by<>auth.uid() THEN
      RAISE EXCEPTION 'Identyfikator potwierdzenia został już wykorzystany.';
    END IF;
    RETURN jsonb_build_object('notified_recipients',previous.notified_recipients,'already_submitted',true);
  END IF;
  IF o.status::text NOT IN ('draft','sent','viewed') OR EXISTS(SELECT 1 FROM public.events
    WHERE id=o.event_id AND status::text IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled','cancelled')) THEN
    RAISE EXCEPTION 'Ta oferta nie jest już na etapie przekazania do akceptacji. Otwórz realizację.';
  END IF;
  -- The existing RPC validates current PDF, brand, date and pending requests.
  -- Notification delivery and the client's declared consent commit together.
  result:=public.request_seller_offer_review_with_notification(p_offer_id,p_document_id,
    'Akceptacja klienta potwierdzona przez sprzedawcę dla przekazanej wersji PDF.'||E'\n'||left(COALESCE(p_note,''),4800));
  SELECT COALESCE(NULLIF(c.full_name,''),NULLIF(btrim(concat_ws(' ',e.name,e.surname)),''),'Sprzedawca')
    INTO actor_name FROM public.sales_partner_profiles p
    LEFT JOIN public.contacts c ON c.id=p.contact_id LEFT JOIN public.employees e ON e.id=p.employee_id
    WHERE p.id=o.sales_partner_id;
  INSERT INTO public.seller_offer_client_acceptances(id,offer_id,document_id,source_key,confirmed_by,seller_name,notified_recipients)
    SELECT p_request_id,o.id,d.id,d.source_key,auth.uid(),actor_name,(result->>'notified_recipients')::integer
    FROM public.seller_offer_documents d WHERE d.id=p_document_id AND d.offer_id=o.id;
  RETURN result;
END;
$client_review$;

CREATE OR REPLACE FUNCTION public.get_seller_delivery_progress(p_offer uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $delivery_progress$
DECLARE o public.offers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.seller_portal_offer_access_allowed(p_offer),false) THEN
    RAISE EXCEPTION 'Brak dostępu do tej oferty.';
  END IF;
  SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer AND sales_channel='seller_portal';
  RETURN jsonb_build_object(
    'my_company_id',o.my_company_id,
    'commission_enabled',EXISTS(SELECT 1 FROM public.sales_partner_brand_terms t
      WHERE t.sales_partner_id=o.sales_partner_id AND t.my_company_id=o.my_company_id AND t.is_active AND t.commission_enabled),
    'acceptances',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'document_id',a.document_id,
      'source_key',a.source_key,'seller_name',a.seller_name,'confirmed_at',a.confirmed_at) ORDER BY a.confirmed_at DESC,a.id)
      FROM public.seller_offer_client_acceptances a WHERE a.offer_id=o.id),'[]'::jsonb),
    -- Explicit allowlist: never expose internal costs, margins or CRM notes.
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'quantity',i.quantity,'unit',i.unit,
      'requirements',i.partner_source_snapshot->>'additional_requirements',
      'accommodation',CASE WHEN i.partner_source_snapshot->>'requires_accommodation'='true'
        THEN COALESCE(NULLIF(i.partner_source_snapshot->>'accommodation_note',''),'Wymagany nocleg') END,
      'logistics',i.partner_source_snapshot->>'logistics_note') ORDER BY i.display_order,i.id)
      FROM public.offer_items i WHERE i.offer_id=o.id),'[]'::jsonb),
    'submissions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'task_key',s.task_key,
      'arrangement_revision',s.arrangement_revision,'submitted_at',s.submitted_at) ORDER BY s.submitted_at DESC,s.id)
      FROM public.seller_realization_submissions s WHERE s.offer_id=o.id),'[]'::jsonb));
END;
$delivery_progress$;

CREATE OR REPLACE FUNCTION public.submit_seller_realization_information(
  p_offer uuid,p_task_key text,p_revision integer,p_message_id uuid,p_body text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $delivery_submission$
DECLARE o public.offers%ROWTYPE; event_status text; current_revision integer;
  conversation uuid; task_title text; previous public.seller_realization_submissions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.current_session_is_seller_portal(),false) THEN
    RAISE EXCEPTION 'Zaloguj się jako sprzedawca.';
  END IF;
  SELECT * INTO o FROM public.offers WHERE id=p_offer AND sales_channel='seller_portal'
    AND sales_partner_id=public.current_sales_partner_id() FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(public.seller_arrangements_access(p_offer),false) THEN
    RAISE EXCEPTION 'Brak dostępu do tej realizacji.';
  END IF;
  IF p_message_id IS NULL OR length(btrim(COALESCE(p_body,''))) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Wpisz informację o długości od 1 do 4000 znaków.';
  END IF;
  SELECT * INTO previous FROM public.seller_realization_submissions WHERE id=p_message_id;
  IF FOUND THEN
    IF previous.offer_id<>p_offer OR previous.submitted_by<>auth.uid()
      OR previous.task_key IS DISTINCT FROM p_task_key OR previous.body<>btrim(p_body)
      OR previous.arrangement_revision IS DISTINCT FROM p_revision THEN
      RAISE EXCEPTION 'Identyfikator wiadomości został już wykorzystany.';
    END IF;
    RETURN jsonb_build_object('message_id',previous.id,'already_submitted',true);
  END IF;
  SELECT status::text INTO event_status FROM public.events WHERE id=o.event_id AND my_company_id=o.my_company_id;
  IF event_status='cancelled' OR (o.status::text<>'accepted' AND COALESCE(event_status,'') NOT IN
    ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled')) THEN
    RAISE EXCEPTION 'Oferta nie jest aktywną realizacją.';
  END IF;
  IF COALESCE(event_status,'') IN ('completed','invoiced','settled') AND p_task_key<>'feedback' THEN
    RAISE EXCEPTION 'Realizacja jest zakończona. Dodatkowe ustalenia przekaż na czacie.';
  END IF;
  IF p_task_key='feedback' AND COALESCE(event_status,'') NOT IN ('completed','invoiced','settled') THEN
    RAISE EXCEPTION 'Podsumowanie będzie dostępne po zakończeniu realizacji.';
  END IF;
  SELECT COALESCE((SELECT revision FROM public.seller_offer_arrangements WHERE offer_id=p_offer),0) INTO current_revision;
  IF p_revision IS DISTINCT FROM current_revision THEN
    RAISE EXCEPTION 'Opiekun zaktualizował ustalenia. Odśwież realizację i sprawdź je przed wysłaniem.';
  END IF;
  task_title:=CASE p_task_key WHEN 'contact' THEN 'Kontakt na miejscu' WHEN 'technical' THEN 'Wymagania techniczne'
    WHEN 'logistics' THEN 'Logistyka' WHEN 'materials' THEN 'Materiały' WHEN 'feedback' THEN 'Podsumowanie po realizacji' END;
  IF task_title IS NULL THEN
    SELECT 'Przygotowanie usługi: '||i.name INTO task_title FROM public.offer_items i
      WHERE i.offer_id=p_offer AND p_task_key='product:'||i.id::text
      AND (NULLIF(btrim(i.partner_source_snapshot->>'additional_requirements'),'') IS NOT NULL
        OR i.partner_source_snapshot->>'requires_accommodation'='true'
        OR NULLIF(btrim(i.partner_source_snapshot->>'logistics_note'),'') IS NOT NULL);
  END IF;
  IF task_title IS NULL THEN RAISE EXCEPTION 'Nieprawidłowa pozycja przygotowań.'; END IF;
  conversation:=public.open_seller_conversation(o.sales_partner_id,o.my_company_id,o.id);
  PERFORM public.send_seller_message(conversation,p_message_id,
    task_title||E'\nInformacja od sprzedawcy — do ustaleń w wersji '||current_revision||E'.\n\n'||btrim(p_body));
  INSERT INTO public.seller_realization_submissions(id,offer_id,task_key,arrangement_revision,body,submitted_by)
    VALUES(p_message_id,o.id,p_task_key,current_revision,btrim(p_body),auth.uid());
  RETURN jsonb_build_object('message_id',p_message_id,'conversation_id',conversation);
END;
$delivery_submission$;

CREATE OR REPLACE FUNCTION public.get_seller_offer_delivery_states(p_offers uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $offer_delivery_states$
DECLARE partner uuid:=public.current_sales_partner_id(); result jsonb;
BEGIN
  IF auth.uid() IS NULL OR partner IS NULL OR COALESCE(cardinality(p_offers),0)>200 THEN
    RAISE EXCEPTION 'Brak dostępu lub nieprawidłowe parametry listy ofert.';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'offer_id',o.id,
    'is_realization',o.status::text='accepted' OR COALESCE(e.status::text,'') IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled','cancelled'),
    'review_status',CASE WHEN r.source_key=public.seller_offer_source_key(o.id) THEN r.status ELSE NULL END,
    'client_confirmed',EXISTS(SELECT 1 FROM public.seller_offer_client_acceptances a
      WHERE a.offer_id=o.id AND a.source_key=r.source_key AND a.document_id=r.document_id)
      AND r.source_key=public.seller_offer_source_key(o.id)
  )),'[]'::jsonb) INTO result
  FROM public.offers o
  JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=o.sales_partner_id AND t.my_company_id=o.my_company_id AND t.is_active
  LEFT JOIN public.seller_offer_reviews r ON r.offer_id=o.id
  LEFT JOIN public.events e ON e.id=o.event_id AND e.my_company_id=o.my_company_id
  WHERE o.id=ANY(p_offers) AND o.sales_partner_id=partner AND o.sales_channel='seller_portal';
  RETURN result;
END;
$offer_delivery_states$;

REVOKE ALL ON FUNCTION public.get_seller_offer_delivery_states(uuid[]),public.confirm_client_and_request_seller_review(uuid,uuid,uuid,boolean,text),
  public.get_seller_delivery_progress(uuid),public.submit_seller_realization_information(uuid,text,integer,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_seller_offer_delivery_states(uuid[]),public.confirm_client_and_request_seller_review(uuid,uuid,uuid,boolean,text),
  public.get_seller_delivery_progress(uuid),public.submit_seller_realization_information(uuid,text,integer,uuid,text) TO authenticated;

-- Keep completed/cancelled records accessible in history, with the same brand
-- scope as the original list. Passing an event date never confirms/completes it.
CREATE OR REPLACE FUNCTION public.get_seller_realizations(p_include_past boolean DEFAULT false,p_search text DEFAULT '',p_offset integer DEFAULT 0,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $delivery_list$
DECLARE v_partner uuid := public.current_sales_partner_id(); v_result jsonb;
BEGIN
  IF v_partner IS NULL THEN RAISE EXCEPTION 'Brak dostępu do realizacji sprzedawcy'; END IF;
  IF p_offset IS NULL OR p_offset<0 OR p_offset>100000 OR p_limit IS NULL OR p_limit<1 OR p_limit>100
    OR length(COALESCE(p_search,''))>200 THEN RAISE EXCEPTION 'Nieprawidłowe parametry listy'; END IF;
  WITH candidates AS (
    SELECT COALESCE(e.id,o.id) AS id,e.id AS event_id,o.id AS offer_id,o.offer_number,
      COALESCE(e.name,NULLIF(o.title,''),o.offer_number,'Realizacja') AS name,
      COALESCE(e.event_date,a.starts_at AT TIME ZONE 'Europe/Warsaw',o.event_date::timestamp AT TIME ZONE 'Europe/Warsaw') AS starts_at,
      COALESCE(e.event_end_date,e.event_date,a.ends_at AT TIME ZONE 'Europe/Warsaw',o.event_date::timestamp AT TIME ZONE 'Europe/Warsaw') AS ends_at,
      COALESCE(NULLIF(e.location,''),o.event_location) AS location,
      COALESCE(e.status::text,'awaiting_event') AS status,
      b.name AS brand_name,COALESCE(NULLIF(o.portal_client_company,''),o.portal_client_name) AS client_name,
      o.client_total_net AS client_net,o.status::text='accepted' AS accepted_offer,o.updated_at
    FROM public.offers o JOIN public.sales_partner_brand_terms t
      ON t.sales_partner_id=o.sales_partner_id AND t.my_company_id=o.my_company_id AND t.is_active
    JOIN public.my_companies b ON b.id=o.my_company_id
    LEFT JOIN public.events e ON e.id=o.event_id AND e.my_company_id=o.my_company_id
    LEFT JOIN public.seller_offer_arrangements a ON a.offer_id=o.id
    WHERE o.sales_partner_id=v_partner AND o.sales_channel='seller_portal' AND o.status::text<>'rejected'
      AND (o.event_id IS NULL OR e.id IS NOT NULL)
      AND (o.status::text='accepted' OR e.status::text IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled','cancelled'))
  ), chosen AS (
    SELECT DISTINCT ON(id) * FROM candidates ORDER BY id,accepted_offer DESC,updated_at DESC NULLS LAST,offer_id
  ), classified AS (
    SELECT *,CASE WHEN status='in_progress' THEN false WHEN status IN ('completed','invoiced','settled','cancelled') THEN true
      ELSE COALESCE((COALESCE(ends_at,starts_at) AT TIME ZONE 'Europe/Warsaw')::date < (now() AT TIME ZONE 'Europe/Warsaw')::date,false) END AS is_past
    FROM chosen
  ), filtered AS (
    SELECT * FROM classified WHERE (COALESCE(p_include_past,false) OR NOT is_past)
      AND (COALESCE(btrim(p_search),'')='' OR concat_ws(' ',name,offer_number,location,brand_name,client_name) ILIKE '%'||btrim(p_search)||'%')
  ), page AS (
    SELECT * FROM filtered ORDER BY is_past,
      CASE WHEN NOT is_past THEN starts_at END ASC NULLS LAST,
      CASE WHEN is_past THEN starts_at END DESC NULLS LAST,id OFFSET p_offset LIMIT p_limit
  )
  SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'has_more',p_offset+(SELECT count(*) FROM page)<(SELECT count(*) FROM filtered),
    'items',COALESCE((SELECT jsonb_agg(to_jsonb(p)-'accepted_offer'-'updated_at' ORDER BY is_past,
      CASE WHEN NOT is_past THEN starts_at END ASC NULLS LAST,CASE WHEN is_past THEN starts_at END DESC NULLS LAST,id) FROM page p),'[]'::jsonb)) INTO v_result;
  RETURN v_result;
END;
$delivery_list$;
REVOKE ALL ON FUNCTION public.get_seller_realizations(boolean,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_seller_realizations(boolean,text,integer,integer) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
