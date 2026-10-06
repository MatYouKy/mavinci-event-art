BEGIN;
CREATE OR REPLACE FUNCTION public.add_inquiry_note(p_inquiry uuid, p_body text, p_kind text, p_request_id uuid)
RETURNS public.inquiry_activity LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tasks; result public.inquiry_activity; author_name text;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry AND is_inquiry FOR UPDATE;
 IF NOT coalesce(public.can_manage_inquiry(t.inquiry_owner_id),false) OR t.archived_at IS NOT NULL THEN
   RAISE EXCEPTION 'Brak uprawnień do dodawania notatek do zapytania';
 END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('note','call_note') OR nullif(btrim(p_body),'') IS NULL OR length(p_body)>10000 OR p_request_id IS NULL THEN
   RAISE EXCEPTION 'Podaj treść notatki (maksymalnie 10 000 znaków) i poprawny rodzaj';
 END IF;
 SELECT concat_ws(' ',name,surname) INTO author_name FROM public.employees WHERE id=public.sales_employee_id();
 INSERT INTO public.inquiry_activity(inquiry_id,kind,body,actor_id,metadata,delivery_key)
 VALUES(t.id,p_kind,btrim(p_body),public.sales_employee_id(),jsonb_build_object('author_name',author_name),'inquiry-note:'||t.id::text||':'||p_request_id::text)
 ON CONFLICT(delivery_key) DO NOTHING RETURNING * INTO result;
 IF result.id IS NULL THEN
   SELECT * INTO result FROM public.inquiry_activity WHERE delivery_key='inquiry-note:'||t.id::text||':'||p_request_id::text;
 ELSIF p_kind='call_note' THEN
   UPDATE public.tasks SET last_contact_at=now() WHERE id=t.id;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.add_inquiry_note(uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_inquiry_note(uuid,text,text,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
