BEGIN;

-- Changing ownership is a narrow operation, not a grant to edit other teams' inquiries.
CREATE OR REPLACE FUNCTION public.inquiry_handoff_target_allowed(p_owner uuid,p_target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_owner IS NOT NULL AND public.sales_employee_id() IS NOT NULL
 AND public.can_manage_inquiry(p_owner)
 AND (p_target IS NULL OR EXISTS (
   SELECT 1 FROM public.employees e WHERE e.id=p_target AND e.is_active
   AND (e.role::text='admin' OR e.access_level::text='admin' OR
     coalesce(e.permissions,'{}'::text[]) && ARRAY['admin','inquiries_view','inquiries_view_own','inquiries_view_all','inquiries_manage','inquiries_manage_own'])
 ))
 AND (p_target IS NULL OR public.is_inquiry_admin() OR public.has_inquiry_permission('inquiries_manage_all')
   OR public.can_assign_inquiry_owner(p_target)
   OR EXISTS (
     SELECT 1 FROM public.employees actor JOIN public.employees target ON target.id=p_target
     WHERE actor.id=public.sales_employee_id() AND actor.is_active AND target.is_active
       AND actor.sales_team_id IS NOT NULL AND actor.sales_team_id=target.sales_team_id
       AND (actor.id=p_owner OR (actor.is_sales_team_manager AND public.has_inquiry_permission('inquiries_manage_team')))
   ));
$$;
REVOKE ALL ON FUNCTION public.inquiry_handoff_target_allowed(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_inquiry_handoff_candidates(p_inquiry_id uuid)
RETURNS TABLE(id uuid,name text,surname text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE inquiry public.tasks%ROWTYPE;
BEGIN
 SELECT * INTO inquiry FROM public.tasks WHERE tasks.id=p_inquiry_id AND is_inquiry AND archived_at IS NULL;
 IF NOT FOUND OR NOT public.inquiry_handoff_target_allowed(inquiry.inquiry_owner_id,NULL)
   OR inquiry.inquiry_stage IN ('won','lost') THEN
   RAISE EXCEPTION 'Nie możesz przekazać tego zapytania.' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT e.id,e.name::text,e.surname::text FROM public.employees e
 WHERE e.id<>inquiry.inquiry_owner_id AND public.inquiry_handoff_target_allowed(inquiry.inquiry_owner_id,e.id)
 ORDER BY e.surname,e.name,e.id;
END $$;
REVOKE ALL ON FUNCTION public.get_inquiry_handoff_candidates(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_inquiry_handoff_candidates(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reassign_inquiry(p_inquiry_id uuid,p_expected_owner_id uuid,p_new_owner_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE inquiry public.tasks%ROWTYPE; actor uuid:=public.sales_employee_id(); owner_name text;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Wymagane logowanie.' USING ERRCODE='42501'; END IF;
 SELECT * INTO inquiry FROM public.tasks WHERE id=p_inquiry_id AND is_inquiry AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_inquiry(inquiry.inquiry_owner_id) THEN
   RAISE EXCEPTION 'Brak dostępu do zapytania.' USING ERRCODE='42501';
 END IF;
 IF inquiry.inquiry_owner_id IS DISTINCT FROM p_expected_owner_id THEN
   RAISE EXCEPTION 'Opiekun zapytania już się zmienił. Odśwież listę i spróbuj ponownie.' USING ERRCODE='40001';
 END IF;
 IF inquiry.inquiry_stage IN ('won','lost') THEN RAISE EXCEPTION 'Nie można przekazać zamkniętego zapytania.'; END IF;
 IF NOT public.inquiry_handoff_target_allowed(inquiry.inquiry_owner_id,p_new_owner_id) THEN
   RAISE EXCEPTION 'Nie możesz przekazać zapytania tej osobie.' USING ERRCODE='42501';
 END IF;
 IF p_new_owner_id IS NOT DISTINCT FROM inquiry.inquiry_owner_id THEN RETURN inquiry.id; END IF;
 -- Recheck and lock the destination employee while the handoff is being saved.
 IF p_new_owner_id IS NOT NULL THEN
   SELECT concat_ws(' ',name,surname) INTO owner_name FROM public.employees
   WHERE id=p_new_owner_id AND is_active FOR SHARE;
   IF NOT FOUND OR NOT public.inquiry_handoff_target_allowed(inquiry.inquiry_owner_id,p_new_owner_id) THEN
     RAISE EXCEPTION 'Wybrana osoba nie może już przyjąć zapytania.' USING ERRCODE='42501';
   END IF;
 END IF;
 UPDATE public.tasks SET inquiry_owner_id=p_new_owner_id,updated_at=now() WHERE id=inquiry.id;
 INSERT INTO public.inquiry_activity(inquiry_id,kind,body,actor_id,metadata)
 VALUES(inquiry.id,'note',CASE WHEN p_new_owner_id IS NULL THEN 'Oddano zapytanie do wspólnej puli.'
   ELSE 'Przekazano zapytanie: '||owner_name||'.' END,actor,
   jsonb_build_object('previous_owner_id',inquiry.inquiry_owner_id,'new_owner_id',p_new_owner_id));
 RETURN inquiry.id;
END $$;
REVOKE ALL ON FUNCTION public.reassign_inquiry(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reassign_inquiry(uuid,uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
