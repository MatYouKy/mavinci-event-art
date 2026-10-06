BEGIN;
-- Keep the original resolver and add a stable content signature for summary approval.
ALTER FUNCTION public.get_inquiry_correspondence(uuid) RENAME TO get_inquiry_correspondence_live;
CREATE FUNCTION public.get_inquiry_correspondence(p_inquiry_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE payload jsonb;
BEGIN
 payload := public.get_inquiry_correspondence_live(p_inquiry_id);
 RETURN payload || jsonb_build_object('signature',md5((payload->'messages')::text));
END $$;
REVOKE ALL ON FUNCTION public.get_inquiry_correspondence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inquiry_correspondence(uuid) TO authenticated;

CREATE UNIQUE INDEX inquiry_analysis_request_unique ON public.inquiry_analyses(inquiry_id,(result->>'client_request_id'))
 WHERE result ? 'client_request_id';
CREATE FUNCTION public.save_inquiry_ai_turn(p_inquiry uuid,p_revision integer,p_result jsonb,p_parent_analysis uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tasks; existing uuid; latest uuid;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry AND is_inquiry FOR UPDATE;
 IF NOT public.can_manage_inquiry(t.inquiry_owner_id) OR t.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
 IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text)>200000
   OR coalesce(p_result->>'client_request_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'Nieprawidłowa analiza'; END IF;
 SELECT id INTO existing FROM public.inquiry_analyses WHERE inquiry_id=p_inquiry AND result->>'client_request_id'=p_result->>'client_request_id';
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 SELECT id INTO latest FROM public.inquiry_analyses WHERE inquiry_id=p_inquiry ORDER BY created_at DESC,id DESC LIMIT 1;
 IF latest IS DISTINCT FROM p_parent_analysis THEN RAISE EXCEPTION 'Rozmowa zmieniła się podczas analizy. Odśwież i ponów pytanie.'; END IF;
 RETURN public.save_inquiry_analysis(p_inquiry,p_revision,p_result);
END $$;
REVOKE ALL ON FUNCTION public.save_inquiry_ai_turn(uuid,integer,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_inquiry_ai_turn(uuid,integer,jsonb,uuid) TO authenticated;

CREATE FUNCTION public.approve_inquiry_summary(p_inquiry uuid,p_analysis uuid,p_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE t public.tasks; analysis public.inquiry_analyses; latest uuid; correspondence jsonb; approval jsonb;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry AND is_inquiry FOR UPDATE;
 IF NOT public.can_manage_inquiry(t.inquiry_owner_id) OR t.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
 IF t.brief_revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Ustalenia zmieniły się. Odśwież zapytanie i analizę.'; END IF;
 SELECT * INTO STRICT analysis FROM public.inquiry_analyses WHERE id=p_analysis AND inquiry_id=p_inquiry;
 SELECT id INTO latest FROM public.inquiry_analyses WHERE inquiry_id=p_inquiry ORDER BY created_at DESC,id DESC LIMIT 1;
 IF latest IS DISTINCT FROM p_analysis OR analysis.brief_revision IS DISTINCT FROM t.brief_revision THEN
   RAISE EXCEPTION 'Wykonaj aktualną analizę przed zatwierdzeniem podsumowania.';
 END IF;
 correspondence := public.get_inquiry_correspondence(p_inquiry);
 IF nullif(analysis.result->>'correspondence_signature','') IS NULL
   OR analysis.result->>'correspondence_signature' IS DISTINCT FROM correspondence->>'signature' THEN
   RAISE EXCEPTION 'Korespondencja zmieniła się. Odśwież analizę przed zatwierdzeniem.';
 END IF;
 IF nullif(btrim(analysis.result->>'summary'),'') IS NULL THEN RAISE EXCEPTION 'Brak podsumowania do zatwierdzenia'; END IF;
 approval := jsonb_build_object('analysis_id',analysis.id,'summary',analysis.result->>'summary',
   'correspondence_signature',correspondence->>'signature','approved_at',now(),'approved_by',auth.uid(),'brief_revision',t.brief_revision+1);
 UPDATE public.tasks SET inquiry_details=coalesce(inquiry_details,'{}')||jsonb_build_object('approved_summary',approval),
   brief_revision=t.brief_revision+1 WHERE id=t.id RETURNING * INTO t;
 RETURN jsonb_build_object('brief_revision',t.brief_revision,'inquiry_details',t.inquiry_details);
END $$;
REVOKE ALL ON FUNCTION public.approve_inquiry_summary(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_inquiry_summary(uuid,uuid,integer) TO authenticated;

CREATE FUNCTION public.get_inquiry_approved_summary(p_inquiry uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE t public.tasks; approval jsonb; latest uuid;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry AND is_inquiry;
 approval:=t.inquiry_details->'approved_summary';
 IF approval IS NULL OR approval->>'brief_revision' IS DISTINCT FROM t.brief_revision::text THEN RETURN NULL; END IF;
 SELECT id INTO latest FROM public.inquiry_analyses WHERE inquiry_id=p_inquiry ORDER BY created_at DESC,id DESC LIMIT 1;
 IF latest::text IS DISTINCT FROM approval->>'analysis_id'
   OR (public.get_inquiry_correspondence(p_inquiry)->>'signature') IS DISTINCT FROM approval->>'correspondence_signature'
 THEN RETURN NULL; END IF;
 RETURN approval->>'summary';
END $$;
REVOKE ALL ON FUNCTION public.get_inquiry_approved_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inquiry_approved_summary(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
