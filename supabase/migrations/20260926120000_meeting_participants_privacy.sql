BEGIN;
CREATE OR REPLACE FUNCTION public.is_current_meeting_participant(p_meeting_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.meeting_participants mp JOIN public.employees e ON e.id=mp.employee_id JOIN public.meetings m ON m.id=mp.meeting_id WHERE mp.meeting_id=p_meeting_id AND (e.id=auth.uid() OR e.auth_user_id=auth.uid()) AND e.is_active AND m.deleted_at IS NULL);
$$;
REVOKE ALL ON FUNCTION public.is_current_meeting_participant(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_current_meeting_participant(uuid) TO authenticated;
CREATE POLICY meeting_participant_privacy ON public.meetings AS RESTRICTIVE FOR SELECT TO authenticated USING(public.is_current_meeting_participant(id));
CREATE POLICY meeting_participant_access ON public.meetings FOR SELECT TO authenticated USING(public.is_current_meeting_participant(id));
CREATE POLICY meeting_roster_privacy ON public.meeting_participants AS RESTRICTIVE FOR SELECT TO authenticated USING(public.is_current_meeting_participant(meeting_id));
CREATE POLICY meeting_roster_access ON public.meeting_participants FOR SELECT TO authenticated USING(public.is_current_meeting_participant(meeting_id));
-- Keep existing event visibility unchanged; restrict only the meetings branch of the definer RPC.
DO $$ DECLARE definition text; marker text := 'AND m.deleted_at IS NULL'; BEGIN
 SELECT pg_get_functiondef('public.get_events_list(timestamptz,timestamptz,text[])'::regprocedure) INTO definition;
 IF position(marker in definition)=0 THEN RAISE EXCEPTION 'Unexpected calendar function'; END IF;
 definition:=replace(definition,$old$AND (
has_full_access = true
OR m.created_by = current_user_id
OR EXISTS (
SELECT 1
FROM meeting_participants mp
WHERE mp.meeting_id = m.id
AND mp.employee_id = current_user_id
)
)$old$,'');
 EXECUTE replace(definition,marker,marker || ' AND public.is_current_meeting_participant(m.id)');
END $$;
CREATE FUNCTION public.create_private_meeting(p_data jsonb,p_participants jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor public.employees; m public.meetings; mid uuid; participant jsonb;
BEGIN
 SELECT * INTO actor FROM public.employees e WHERE (e.id=auth.uid() OR e.auth_user_id=auth.uid()) AND e.is_active LIMIT 1;
 IF actor.id IS NULL OR public.current_session_is_seller_portal() OR NOT (actor.role='admin' OR actor.access_level='admin' OR coalesce(actor.permissions,'{}') && ARRAY['admin','calendar_view','calendar_manage']) THEN RAISE EXCEPTION 'Brak uprawnień do tworzenia spotkań.' USING ERRCODE='42501'; END IF;
 m:=jsonb_populate_record(NULL::public.meetings,p_data);
 INSERT INTO public.meetings(title,datetime_start,datetime_end,is_all_day,color,notes,location_id,location_text,related_event_ids,alert_1_minutes,alert_2_minutes,alert_critical_minutes,created_by)
 VALUES(m.title,m.datetime_start,m.datetime_end,coalesce(m.is_all_day,false),coalesce(m.color,'#d3bb73'),m.notes,m.location_id,m.location_text,m.related_event_ids,m.alert_1_minutes,m.alert_2_minutes,m.alert_critical_minutes,actor.id) RETURNING id INTO mid;
 FOR participant IN SELECT value FROM jsonb_array_elements(coalesce(p_participants,'[]'::jsonb)) LOOP
 INSERT INTO public.meeting_participants(meeting_id,employee_id,contact_id) VALUES(mid,nullif(participant->>'employee_id','')::uuid,nullif(participant->>'contact_id','')::uuid);
 END LOOP;
 RETURN jsonb_build_object('id',mid);
END $$;
REVOKE ALL ON FUNCTION public.create_private_meeting(jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_private_meeting(jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
