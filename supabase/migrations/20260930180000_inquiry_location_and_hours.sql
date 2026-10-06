BEGIN;

CREATE OR REPLACE FUNCTION public.save_inquiry_brief(p_inquiry uuid,p_expected_revision integer,p_details jsonb,p_contact_note text DEFAULT NULL,p_next_action timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tasks; merged jsonb;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry AND is_inquiry FOR UPDATE;
 IF NOT public.can_manage_inquiry(t.inquiry_owner_id) OR t.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Brak uprawnień do zapytania'; END IF;
 IF t.brief_revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Dane zmieniła inna osoba. Odśwież zapytanie przed zapisem.'; END IF;
 IF jsonb_typeof(p_details) IS DISTINCT FROM 'object' OR octet_length(p_details::text)>100000 THEN RAISE EXCEPTION 'Nieprawidłowe dane briefu'; END IF;
 merged:=coalesce(t.inquiry_details,'{}')||(SELECT coalesce(jsonb_object_agg(key,value),'{}') FROM jsonb_each(p_details) WHERE key=ANY(ARRAY['questions','conversation_notes','event_assumptions','event_assumption_items','event_goal','preliminary_budget_min','preliminary_budget_max','preliminary_budget_text','preliminary_budget_currency','termin','location_text','location_id','event_start_time','event_end_time','event_end_next_day','scope','brief_confirmed_at','event_assumptions_source','assistant_analysis_generated_at']));
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
 IF nullif(merged->>'event_start_time','') IS NOT NULL AND nullif(merged->>'event_end_time','') IS NOT NULL
    AND NOT coalesce((merged->>'event_end_next_day')::boolean,false)
    AND (merged->>'event_end_time') <= (merged->>'event_start_time') THEN
   RAISE EXCEPTION 'Zakończenie musi być późniejsze od rozpoczęcia lub przypadać następnego dnia';
 END IF;
 -- Keep the readable time range available to existing offer-assistant context.
 IF p_details ? 'event_start_time' OR p_details ? 'event_end_time' THEN
   merged:=merged||jsonb_build_object('hours',
     CASE WHEN nullif(merged->>'event_start_time','') IS NOT NULL OR nullif(merged->>'event_end_time','') IS NOT NULL
       THEN coalesce(nullif(merged->>'event_start_time',''),'?')||' – '||coalesce(nullif(merged->>'event_end_time',''),'?')||
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

NOTIFY pgrst, 'reload schema';
COMMIT;
