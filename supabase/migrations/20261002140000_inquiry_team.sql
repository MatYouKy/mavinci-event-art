BEGIN;

CREATE TABLE public.inquiry_team_members (
 inquiry_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
 employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
 is_active boolean NOT NULL DEFAULT true,
 added_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(inquiry_id,employee_id)
);
CREATE INDEX inquiry_team_by_employee ON public.inquiry_team_members(employee_id,inquiry_id) WHERE is_active;
ALTER TABLE public.inquiry_team_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inquiry_team_members FROM anon,authenticated;
GRANT SELECT ON public.inquiry_team_members TO authenticated;

-- Membership always belongs to one inquiry; the original owner-based helpers stay unchanged.
CREATE FUNCTION public.is_inquiry_team_member(p_inquiry uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.inquiry_team_members m JOIN public.tasks t ON t.id=m.inquiry_id
 WHERE m.inquiry_id=p_inquiry AND m.employee_id=public.sales_employee_id() AND m.is_active AND t.is_inquiry);
$$;
CREATE FUNCTION public.can_view_inquiry(inquiry_owner uuid,inquiry_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.can_view_inquiry(inquiry_owner) OR public.is_inquiry_team_member(inquiry_id);
$$;
CREATE FUNCTION public.can_manage_inquiry(inquiry_owner uuid,inquiry_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.can_manage_inquiry(inquiry_owner) OR EXISTS(SELECT 1 FROM public.tasks t
 WHERE t.id=$2 AND t.is_inquiry AND t.archived_at IS NULL AND public.is_inquiry_team_member(t.id));
$$;
REVOKE ALL ON FUNCTION public.is_inquiry_team_member(uuid), public.can_view_inquiry(uuid,uuid), public.can_manage_inquiry(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_inquiry_team_member(uuid), public.can_view_inquiry(uuid,uuid), public.can_manage_inquiry(uuid,uuid) TO authenticated;
CREATE POLICY inquiry_team_read ON public.inquiry_team_members FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=inquiry_team_members.inquiry_id AND t.is_inquiry));

CREATE FUNCTION public.inquiry_team_candidate(p_employee uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.employees e WHERE e.id=p_employee AND e.is_active
 AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=coalesce(e.auth_user_id,e.id))
 AND (e.role::text='admin' OR e.access_level::text='admin' OR coalesce(e.permissions,'{}'::text[]) &&
 ARRAY['admin','inquiries_view','inquiries_view_own','inquiries_view_team','inquiries_view_all','inquiries_view_pool','inquiries_manage','inquiries_manage_own','inquiries_manage_team','inquiries_manage_all']));
$$;
REVOKE ALL ON FUNCTION public.inquiry_team_candidate(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_inquiry_team(p_inquiry_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.tasks; leader boolean;
BEGIN
 SELECT * INTO t FROM public.tasks WHERE id=p_inquiry_id AND is_inquiry;
 IF NOT FOUND OR NOT public.can_view_inquiry(t.inquiry_owner_id,t.id) THEN
  RAISE EXCEPTION 'Brak dostępu do zapytania.' USING ERRCODE='42501';
 END IF;
 leader:=t.archived_at IS NULL AND public.can_manage_inquiry(t.inquiry_owner_id);
 RETURN jsonb_build_object('canManageTeam',leader,'isMember',public.is_inquiry_team_member(t.id),
 'members',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'surname',e.surname,'active',e.is_active) ORDER BY e.surname,e.name,e.id)
 FROM public.inquiry_team_members m JOIN public.employees e ON e.id=m.employee_id
 WHERE m.inquiry_id=t.id AND m.is_active AND m.employee_id IS DISTINCT FROM t.inquiry_owner_id),'[]'::jsonb),
 'candidates',CASE WHEN leader THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'surname',e.surname) ORDER BY e.surname,e.name,e.id)
 FROM public.employees e WHERE public.inquiry_team_candidate(e.id) AND e.id IS DISTINCT FROM t.inquiry_owner_id
 AND NOT EXISTS(SELECT 1 FROM public.inquiry_team_members m WHERE m.inquiry_id=t.id AND m.employee_id=e.id AND m.is_active)),'[]'::jsonb) ELSE '[]'::jsonb END);
END $$;
CREATE FUNCTION public.set_inquiry_team_member(p_inquiry_id uuid,p_employee_id uuid,p_active boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.tasks; person_name text; changed_count integer;
BEGIN
 SELECT * INTO t FROM public.tasks WHERE id=p_inquiry_id AND is_inquiry FOR UPDATE;
 IF NOT FOUND OR t.archived_at IS NOT NULL OR NOT public.can_manage_inquiry(t.inquiry_owner_id) THEN
  RAISE EXCEPTION 'Tylko opiekun lub uprawniony kierownik może zarządzać zespołem.' USING ERRCODE='42501';
 END IF;
 IF p_active IS NULL OR p_employee_id IS NULL THEN RAISE EXCEPTION 'Wybierz pracownika.'; END IF;
 IF p_employee_id=t.inquiry_owner_id THEN RAISE EXCEPTION 'Opiekun już prowadzi ten zespół.'; END IF;
 SELECT concat_ws(' ',name,surname) INTO person_name FROM public.employees WHERE id=p_employee_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono pracownika.'; END IF;
 IF p_active THEN
  IF t.inquiry_owner_id IS NULL THEN RAISE EXCEPTION 'Najpierw przypisz opiekuna zapytania.'; END IF;
  IF NOT public.inquiry_team_candidate(p_employee_id) THEN RAISE EXCEPTION 'Pracownik musi mieć aktywne konto i dostęp do zapytań.'; END IF;
  INSERT INTO public.inquiry_team_members(inquiry_id,employee_id,added_by) VALUES(t.id,p_employee_id,public.sales_employee_id())
  ON CONFLICT(inquiry_id,employee_id) DO UPDATE SET is_active=true,added_by=excluded.added_by,updated_at=now()
  WHERE NOT inquiry_team_members.is_active;
 ELSE
  UPDATE public.inquiry_team_members SET is_active=false,updated_at=now() WHERE inquiry_id=t.id AND employee_id=p_employee_id AND is_active;
 END IF;
 GET DIAGNOSTICS changed_count=ROW_COUNT;
 IF changed_count>0 THEN
  INSERT INTO public.inquiry_activity(inquiry_id,kind,body,actor_id,metadata)
  VALUES(t.id,'note',CASE WHEN p_active THEN 'Dodano do zespołu: ' ELSE 'Usunięto z zespołu: ' END||person_name||'.',
  public.sales_employee_id(),jsonb_build_object('employee_id',p_employee_id,'active',p_active));
  UPDATE public.tasks SET updated_at=now() WHERE id=t.id;
 END IF;
 RETURN public.get_inquiry_team(t.id);
END $$;
REVOKE ALL ON FUNCTION public.get_inquiry_team(uuid),public.set_inquiry_team_member(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_inquiry_team(uuid),public.set_inquiry_team_member(uuid,uuid,boolean) TO authenticated;

-- Preserve existing policy predicates; extend only these explicitly selected inquiry rules.
DO $$ DECLARE p record; expression text; check_expression text; alias_name text; BEGIN
 FOR p IN SELECT * FROM pg_policies WHERE schemaname='public' AND policyname=ANY(ARRAY[
 'inquiry_sales_select_grant','inquiry_sales_visibility_guard','inquiry_sales_update_grant','inquiry_sales_update_guard',
 'inquiry_stage_history_select','inquiry_followup_schedule_select','inquiry_email_write']) LOOP
  expression:=p.qual; check_expression:=p.with_check;
  FOREACH alias_name IN ARRAY ARRAY['','t.','inquiry.','tasks.'] LOOP
   expression:=replace(expression,'can_view_inquiry('||alias_name||'inquiry_owner_id)','can_view_inquiry('||alias_name||'inquiry_owner_id, '||alias_name||'id)');
   expression:=replace(expression,'can_manage_inquiry('||alias_name||'inquiry_owner_id)','can_manage_inquiry('||alias_name||'inquiry_owner_id, '||alias_name||'id)');
   check_expression:=replace(check_expression,'can_manage_inquiry('||alias_name||'inquiry_owner_id)','can_manage_inquiry('||alias_name||'inquiry_owner_id, '||alias_name||'id)');
  END LOOP;
  EXECUTE format('ALTER POLICY %I ON public.%I%s%s',p.policyname,p.tablename,
   CASE WHEN expression IS NOT NULL THEN ' USING ('||expression||')' ELSE '' END,
   CASE WHEN check_expression IS NOT NULL THEN ' WITH CHECK ('||check_expression||')' ELSE '' END);
 END LOOP;
END $$;
-- Preserve the deployed implementation and overloads, changing only the authorization calls.
-- Ownership, archiving, conversion and team administration deliberately keep the one-argument helper.
DO $$ DECLARE f record; definition text; alias_name text; BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname=ANY(ARRAY['sales_can_manage_document','save_inquiry_brief','save_inquiry_analysis','save_inquiry_ai_turn',
 'approve_inquiry_summary','link_inquiry_email','mark_inquiry_contacted','complete_inquiry_followup','snooze_inquiry_followup','inquiry_task_access_allowed']) LOOP
  definition:=pg_get_functiondef(f.oid);
  FOREACH alias_name IN ARRAY ARRAY['t.','inquiry.','task.'] LOOP
   definition:=replace(definition,'can_manage_inquiry('||alias_name||'inquiry_owner_id)','can_manage_inquiry('||alias_name||'inquiry_owner_id,'||alias_name||'id)');
   definition:=replace(definition,'can_view_inquiry('||alias_name||'inquiry_owner_id)','can_view_inquiry('||alias_name||'inquiry_owner_id,'||alias_name||'id)');
  END LOOP;
  EXECUTE definition;
 END LOOP;
END $$;

-- A collaborator may edit the brief, but cannot acquire ownership or move the inquiry out of its scope.
CREATE FUNCTION public.guard_inquiry_team_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NULL OR auth.role()='service_role' THEN RETURN NEW; END IF;
 IF OLD.is_inquiry AND public.is_inquiry_team_member(OLD.id) AND NOT public.can_manage_inquiry(OLD.inquiry_owner_id) THEN
  IF OLD.archived_at IS NOT NULL OR
   ROW(NEW.id,NEW.inquiry_owner_id,NEW.is_inquiry,NEW.is_private,NEW.inquiry_id,NEW.created_by,NEW.event_id,NEW.archived_at,NEW.owner_id)
   IS DISTINCT FROM ROW(OLD.id,OLD.inquiry_owner_id,OLD.is_inquiry,OLD.is_private,OLD.inquiry_id,OLD.created_by,OLD.event_id,OLD.archived_at,OLD.owner_id) THEN
   RAISE EXCEPTION 'Tę zmianę może wykonać opiekun zapytania.' USING ERRCODE='42501';
  END IF;
 END IF;
 IF NOT OLD.is_inquiry AND (public.is_inquiry_team_member(OLD.inquiry_id) OR public.is_inquiry_team_member(NEW.inquiry_id))
 AND ROW(NEW.id,NEW.inquiry_id,NEW.is_inquiry,NEW.is_private,NEW.event_id,NEW.created_by,NEW.owner_id)
 IS DISTINCT FROM ROW(OLD.id,OLD.inquiry_id,OLD.is_inquiry,OLD.is_private,OLD.event_id,OLD.created_by,OLD.owner_id)
 AND NOT public.is_inquiry_admin() THEN
  RAISE EXCEPTION 'Nie można przenieść zadania poza zapytanie w ramach współpracy.' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_inquiry_team_scope() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER inquiry_team_scope_guard BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.guard_inquiry_team_scope();

CREATE FUNCTION public.can_work_inquiry_team(p_inquiry uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_inquiry AND t.is_inquiry AND t.archived_at IS NULL
 AND public.is_inquiry_team_member(t.id));
$$;
REVOKE ALL ON FUNCTION public.can_work_inquiry_team(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_work_inquiry_team(uuid) TO authenticated;
CREATE POLICY inquiry_team_tasks_read ON public.tasks FOR SELECT TO authenticated
 USING(NOT is_inquiry AND NOT is_private AND public.is_inquiry_team_member(inquiry_id));
CREATE POLICY inquiry_team_tasks_insert ON public.tasks FOR INSERT TO authenticated
 WITH CHECK(NOT is_inquiry AND NOT is_private AND event_id IS NULL AND created_by=public.sales_employee_id() AND public.can_work_inquiry_team(inquiry_id));
CREATE POLICY inquiry_team_tasks_update ON public.tasks FOR UPDATE TO authenticated
 USING(NOT is_inquiry AND NOT is_private AND public.can_work_inquiry_team(inquiry_id))
 WITH CHECK(NOT is_inquiry AND NOT is_private AND public.can_work_inquiry_team(inquiry_id));
-- A definer helper avoids the tasks -> assignees -> tasks RLS recursion.
CREATE FUNCTION public.inquiry_team_task_access(p_task uuid,p_manage boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_task AND NOT t.is_private AND NOT t.is_inquiry
 AND CASE WHEN p_manage THEN public.can_work_inquiry_team(t.inquiry_id) ELSE public.is_inquiry_team_member(t.inquiry_id) END);
$$;
REVOKE ALL ON FUNCTION public.inquiry_team_task_access(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.inquiry_team_task_access(uuid,boolean) TO authenticated;
CREATE POLICY inquiry_team_assignees_read ON public.task_assignees FOR SELECT TO authenticated
 USING(public.inquiry_team_task_access(task_id,false));
CREATE POLICY inquiry_team_assignees_write ON public.task_assignees FOR ALL TO authenticated
 USING(public.inquiry_team_task_access(task_id,true)) WITH CHECK(public.inquiry_team_task_access(task_id,true));

-- Calculations may otherwise require module-wide permissions. Limit these additional grants to this team.
CREATE POLICY inquiry_team_calculations_read ON public.event_calculations FOR SELECT TO authenticated
 USING(public.is_inquiry_team_member(inquiry_id) AND (event_id IS NULL OR public.current_employee_can_access_event_company(event_id)));
CREATE POLICY inquiry_team_calculations_write ON public.event_calculations FOR ALL TO authenticated
 USING(public.can_work_inquiry_team(inquiry_id) AND public.sales_can_manage_document(inquiry_id,event_id,created_by))
 WITH CHECK(public.can_work_inquiry_team(inquiry_id) AND public.sales_can_manage_document(inquiry_id,event_id,created_by));
CREATE POLICY inquiry_team_calculation_items_read ON public.event_calculation_items FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.event_calculations c WHERE c.id=calculation_id AND public.is_inquiry_team_member(c.inquiry_id)));
CREATE POLICY inquiry_team_calculation_items_write ON public.event_calculation_items FOR ALL TO authenticated
 USING(EXISTS(SELECT 1 FROM public.event_calculations c WHERE c.id=calculation_id AND public.can_work_inquiry_team(c.inquiry_id) AND public.sales_can_manage_calculation(c.id)))
 WITH CHECK(EXISTS(SELECT 1 FROM public.event_calculations c WHERE c.id=calculation_id AND public.can_work_inquiry_team(c.inquiry_id) AND public.sales_can_manage_calculation(c.id)));

NOTIFY pgrst,'reload schema';
COMMIT;
