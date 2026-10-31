BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
-- guest_count is a nullable numeric field in the existing structured inquiry_details record.
-- It is deliberately copied once; editing an inquiry must not reprice existing offers.
CREATE OR REPLACE FUNCTION public.save_inquiry_brief(p_inquiry uuid, p_expected_revision integer, p_details jsonb, p_contact_note text DEFAULT NULL::text, p_next_action timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t public.tasks; merged jsonb;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry AND is_inquiry FOR UPDATE;
 IF NOT public.can_manage_inquiry(t.inquiry_owner_id) OR t.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Brak uprawnień do zapytania'; END IF;
 IF t.brief_revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Dane zmieniła inna osoba. Odśwież zapytanie przed zapisem.'; END IF;
 IF jsonb_typeof(p_details) IS DISTINCT FROM 'object' OR octet_length(p_details::text)>100000 THEN RAISE EXCEPTION 'Nieprawidłowe dane briefu'; END IF;
 merged:=coalesce(t.inquiry_details,'{}')||(SELECT coalesce(jsonb_object_agg(key,value),'{}') FROM jsonb_each(p_details) WHERE key=ANY(ARRAY['questions','conversation_notes','event_assumptions','event_assumption_items','event_goal','guest_count','preliminary_budget_min','preliminary_budget_max','preliminary_budget_text','preliminary_budget_currency','termin','location_text','location_id','event_start_time','event_end_time','event_end_next_day','event_single_day','event_end_date','scope','brief_confirmed_at','event_assumptions_source','assistant_analysis_generated_at']));
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
END $function$
;

CREATE OR REPLACE FUNCTION public.validate_inquiry_guest_count()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE value text; count_value integer;
BEGIN
 IF NOT coalesce(NEW.is_inquiry,false) THEN RETURN NEW; END IF;
 value:=NEW.inquiry_details->>'guest_count';
 IF value IS NULL THEN RETURN NEW; END IF;
 IF value !~ '^[0-9]{1,6}$' THEN RAISE EXCEPTION 'Podaj całkowitą liczbę osób od 1 do 100 000 lub zostaw pole puste.'; END IF;
 count_value:=value::integer;
 IF count_value<1 OR count_value>100000 THEN RAISE EXCEPTION 'Liczba osób musi być w zakresie od 1 do 100 000.'; END IF;
 NEW.inquiry_details:=jsonb_set(NEW.inquiry_details,'{guest_count}',to_jsonb(count_value));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_validate_inquiry_guest_count ON public.tasks;
CREATE TRIGGER zz_validate_inquiry_guest_count BEFORE INSERT OR UPDATE OF inquiry_details ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.validate_inquiry_guest_count();

CREATE OR REPLACE FUNCTION public.inherit_offer_inquiry_guest_count()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE source_count text;
BEGIN
 IF NEW.guest_count IS NULL AND NEW.inquiry_id IS NOT NULL AND NEW.copied_from_id IS NULL THEN
  SELECT inquiry_details->>'guest_count' INTO source_count FROM public.tasks WHERE id=NEW.inquiry_id AND is_inquiry;
  IF source_count IS NOT NULL THEN
   IF source_count !~ '^[0-9]{1,6}$' OR source_count::numeric<1 OR source_count::numeric>100000 THEN
    RAISE EXCEPTION 'Popraw liczbę osób w zapytaniu przed utworzeniem oferty.';
   END IF;
   NEW.guest_count:=source_count::integer;
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zy_offer_inquiry_guest_count ON public.offers;
CREATE TRIGGER zy_offer_inquiry_guest_count BEFORE INSERT ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.inherit_offer_inquiry_guest_count();
NOTIFY pgrst,'reload schema';
COMMIT;
