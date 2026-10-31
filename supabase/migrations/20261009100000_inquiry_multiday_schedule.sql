BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

CREATE OR REPLACE FUNCTION public.save_inquiry_brief(p_inquiry uuid,p_expected_revision integer,p_details jsonb,p_contact_note text DEFAULT NULL,p_next_action timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tasks; merged jsonb;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry AND is_inquiry FOR UPDATE;
 IF NOT public.can_manage_inquiry(t.inquiry_owner_id) OR t.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Brak uprawnień do zapytania'; END IF;
 IF t.brief_revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Dane zmieniła inna osoba. Odśwież zapytanie przed zapisem.'; END IF;
 IF jsonb_typeof(p_details) IS DISTINCT FROM 'object' OR octet_length(p_details::text)>100000 THEN RAISE EXCEPTION 'Nieprawidłowe dane briefu'; END IF;
 merged:=coalesce(t.inquiry_details,'{}')||(SELECT coalesce(jsonb_object_agg(key,value),'{}') FROM jsonb_each(p_details) WHERE key=ANY(ARRAY['questions','conversation_notes','event_assumptions','event_assumption_items','event_goal','preliminary_budget_min','preliminary_budget_max','preliminary_budget_text','preliminary_budget_currency','termin','location_text','location_id','event_start_time','event_end_time','event_end_next_day','event_single_day','event_end_date','scope','brief_confirmed_at','event_assumptions_source','assistant_analysis_generated_at']));
 IF jsonb_typeof(coalesce(merged->'questions','[]'))<>'array' THEN RAISE EXCEPTION 'Nieprawidłowa lista pytań'; END IF;
 IF nullif(merged->>'location_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.locations WHERE id=(merged->>'location_id')::uuid) THEN
   RAISE EXCEPTION 'Wybrana lokalizacja już nie istnieje. Wybierz inną lub zapisz samą nazwę.';
 END IF;
 IF (nullif(merged->>'event_start_time','') IS NOT NULL AND (merged->>'event_start_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    OR (nullif(merged->>'event_end_time','') IS NOT NULL AND (merged->>'event_end_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN
   RAISE EXCEPTION 'Nieprawidłowe godziny wydarzenia';
 END IF;
 IF merged ? 'event_end_next_day' AND jsonb_typeof(merged->'event_end_next_day') <> 'boolean' THEN
   RAISE EXCEPTION 'Nieprawidłowe oznaczenie następnego dnia';
 END IF;
 IF merged ? 'event_single_day' AND jsonb_typeof(merged->'event_single_day') IS DISTINCT FROM 'boolean' THEN
   RAISE EXCEPTION 'Nieprawidłowy rodzaj terminu wydarzenia';
 END IF;
 IF coalesce((merged->>'event_single_day')::boolean,false) THEN
   merged:=merged||jsonb_build_object('event_end_date',NULL,'event_end_next_day',false);
 END IF;
 IF nullif(merged->>'event_end_date','') IS NOT NULL THEN
   IF (merged->>'event_end_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR nullif(merged->>'termin','') IS NULL
      OR (merged->>'event_end_date')::date <= ((merged->>'termin')::timestamptz AT TIME ZONE 'Europe/Warsaw')::date
      OR nullif(merged->>'event_end_time','') IS NULL THEN
     RAISE EXCEPTION 'Podaj datę zakończenia późniejszą od rozpoczęcia oraz godzinę zakończenia';
   END IF;
   merged:=merged||jsonb_build_object('event_end_next_day',false);
 ELSIF merged->>'event_single_day'='false' AND NOT coalesce((merged->>'event_end_next_day')::boolean,false) THEN
   RAISE EXCEPTION 'Uzupełnij datę i godzinę zakończenia wydarzenia wielodniowego';
 END IF;
 IF nullif(merged->>'event_start_time','') IS NOT NULL AND nullif(merged->>'event_end_time','') IS NOT NULL
    AND nullif(merged->>'event_end_date','') IS NULL
    AND NOT coalesce((merged->>'event_end_next_day')::boolean,false)
    AND (merged->>'event_end_time') <= (merged->>'event_start_time') THEN
   RAISE EXCEPTION 'Zakończenie musi być późniejsze od rozpoczęcia lub przypadać następnego dnia';
 END IF;
 -- Keep the readable time range available to existing offer-assistant context.
 IF p_details ? 'event_start_time' OR p_details ? 'event_end_time' OR p_details ? 'event_end_date' OR p_details ? 'event_single_day' OR p_details ? 'termin' THEN
   merged:=merged||jsonb_build_object('hours',
     CASE WHEN nullif(merged->>'event_start_time','') IS NOT NULL OR nullif(merged->>'event_end_time','') IS NOT NULL
       THEN CASE WHEN nullif(merged->>'event_end_date','') IS NOT NULL THEN coalesce(merged->>'termin','')||' ' ELSE '' END||coalesce(nullif(merged->>'event_start_time',''),'?')||' – '||CASE WHEN nullif(merged->>'event_end_date','') IS NOT NULL THEN to_char((merged->>'event_end_date')::date,'DD.MM.YYYY')||' ' ELSE '' END||coalesce(nullif(merged->>'event_end_time',''),'?')||
         CASE WHEN coalesce((merged->>'event_end_next_day')::boolean,false) THEN ' (następnego dnia)' ELSE '' END
       ELSE NULL END);
 END IF;
 UPDATE public.tasks SET inquiry_details=merged,brief_revision=brief_revision+1,
 estimated_value=coalesce(((nullif(merged->>'preliminary_budget_min','')::numeric+nullif(merged->>'preliminary_budget_max','')::numeric)/2),nullif(merged->>'preliminary_budget_max','')::numeric,nullif(merged->>'preliminary_budget_min','')::numeric),
 last_contact_at=CASE WHEN nullif(btrim(p_contact_note),'') IS NOT NULL THEN now() ELSE last_contact_at END,
 inquiry_stage=CASE WHEN nullif(btrim(p_contact_note),'') IS NOT NULL AND inquiry_stage='new' THEN 'contacted' ELSE inquiry_stage END,
 next_action_at=coalesce(p_next_action,next_action_at),updated_at=now() WHERE id=t.id RETURNING * INTO t;
 PERFORM public.sales_log(t.id,CASE WHEN nullif(btrim(p_contact_note),'') IS NULL THEN 'brief' ELSE 'contact' END,coalesce(nullif(btrim(p_contact_note),''),'Zapisano ustalenia i odpowiedzi klienta'),jsonb_build_object('brief_revision',t.brief_revision,'details',merged));
 RETURN to_jsonb(t);
END $$;

CREATE OR REPLACE FUNCTION public.convert_inquiry_to_event(p_inquiry_id uuid,p_event_name text DEFAULT NULL,p_event_date timestamptz DEFAULT NULL,p_category_id uuid DEFAULT NULL,p_my_company_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE t public.tasks; n uuid; event_date_value timestamptz; event_end_value timestamptz; end_day date;
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

 INSERT INTO public.events(name,description,event_date,event_end_date,location,status,budget,organization_id,contact_person_id,category_id,my_company_id,created_by)
 VALUES(coalesce(nullif(btrim(p_event_name),''),t.title),concat_ws(E'\n',t.description,t.inquiry_details->>'scope',t.inquiry_details->>'conversation_notes'),event_date_value,event_end_value,t.inquiry_details->>'location_text','inquiry',t.estimated_value,t.organization_id,t.contact_id,p_category_id,p_my_company_id,auth.uid()) RETURNING id INTO n;
 UPDATE public.tasks SET event_id=n WHERE id=t.id;
 UPDATE public.tasks SET event_id=n WHERE inquiry_id=t.id AND event_id IS NULL;
 UPDATE public.offers SET event_id=n WHERE inquiry_id=t.id AND event_id IS NULL;
 UPDATE public.event_calculations SET event_id=n WHERE inquiry_id=t.id AND event_id IS NULL;
 RETURN n;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
