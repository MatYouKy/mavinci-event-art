-- Copy the accepted offer venue and preserve a matching inquiry location reference.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.convert_inquiry_to_event(p_inquiry_id uuid,p_event_name text DEFAULT NULL,p_event_date timestamptz DEFAULT NULL,p_category_id uuid DEFAULT NULL,p_my_company_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE t public.tasks; n uuid; event_date_value timestamptz; event_end_value timestamptz; end_day date; offer_location text; event_location_value text; event_location_id uuid; inquiry_location_id text; location_name text;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry_id AND is_inquiry FOR UPDATE;
 IF NOT public.can_manage_inquiry(t.inquiry_owner_id) OR t.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
 IF t.event_id IS NOT NULL THEN RETURN t.event_id; END IF;
 event_date_value:=coalesce(p_event_date,nullif(t.inquiry_details->>'termin','')::timestamptz,t.due_date);
 IF event_date_value IS NULL THEN RAISE EXCEPTION 'Uzupełnij termin wydarzenia'; END IF;
 IF p_event_date IS NULL AND nullif(t.inquiry_details->>'event_start_time','') IS NOT NULL THEN
   event_date_value:=(((event_date_value AT TIME ZONE 'Europe/Warsaw')::date + (t.inquiry_details->>'event_start_time')::time) AT TIME ZONE 'Europe/Warsaw');
 END IF;
 IF nullif(t.inquiry_details->>'event_end_time','') IS NOT NULL THEN
   end_day:=CASE WHEN t.inquiry_details->>'event_single_day' IS DISTINCT FROM 'true' AND nullif(t.inquiry_details->>'event_end_date','') IS NOT NULL
     THEN (t.inquiry_details->>'event_end_date')::date
     ELSE (event_date_value AT TIME ZONE 'Europe/Warsaw')::date + CASE WHEN t.inquiry_details->>'event_single_day' IS DISTINCT FROM 'true' AND coalesce((t.inquiry_details->>'event_end_next_day')::boolean,false) THEN 1 ELSE 0 END END;
   event_end_value:=((end_day + (t.inquiry_details->>'event_end_time')::time) AT TIME ZONE 'Europe/Warsaw');
   IF event_end_value <= event_date_value THEN RAISE EXCEPTION 'Zakończenie wydarzenia musi być późniejsze od rozpoczęcia. Popraw termin w zapytaniu lub formularzu.'; END IF;
 END IF;

 -- Read the accepted offer in the same transaction as event creation.
 SELECT nullif(btrim(o.event_location),'') INTO offer_location
 FROM public.offers o WHERE o.id=t.accepted_offer_id AND o.inquiry_id=t.id AND o.status='accepted';
 event_location_value:=coalesce(offer_location,nullif(btrim(t.inquiry_details->>'location_text'),''));
 inquiry_location_id:=nullif(t.inquiry_details->>'location_id','');
 IF inquiry_location_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   SELECT l.id,l.name INTO event_location_id,location_name FROM public.locations l WHERE l.id=inquiry_location_id::uuid;
   -- An offer may deliberately use another venue. Do not attach the old object.
   IF offer_location IS NOT NULL
      AND lower(offer_location) IS DISTINCT FROM lower(nullif(btrim(t.inquiry_details->>'location_text'),''))
      AND lower(offer_location) IS DISTINCT FROM lower(btrim(location_name)) THEN
     event_location_id:=NULL;
   END IF;
   IF event_location_id IS NOT NULL THEN event_location_value:=coalesce(event_location_value,location_name); END IF;
 END IF;

 INSERT INTO public.events(name,description,event_date,event_end_date,location,location_id,status,budget,organization_id,contact_person_id,category_id,my_company_id,created_by)
 VALUES(coalesce(nullif(btrim(p_event_name),''),t.title),concat_ws(E'\n',t.description,t.inquiry_details->>'scope',t.inquiry_details->>'conversation_notes'),event_date_value,event_end_value,event_location_value,event_location_id,'inquiry',t.estimated_value,t.organization_id,t.contact_id,p_category_id,p_my_company_id,auth.uid()) RETURNING id INTO n;
 UPDATE public.tasks SET event_id=n WHERE id=t.id;
 UPDATE public.tasks SET event_id=n WHERE inquiry_id=t.id AND event_id IS NULL;
 UPDATE public.offers SET event_id=n WHERE inquiry_id=t.id AND event_id IS NULL;
 UPDATE public.event_calculations SET event_id=n WHERE inquiry_id=t.id AND event_id IS NULL;
 RETURN n;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
