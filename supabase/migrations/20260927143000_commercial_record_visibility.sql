-- Record visibility is independent from action permissions. Missing restriction preserves existing access.
CREATE OR REPLACE FUNCTION public.crm_record_scope_limited(p_module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(bool_or(e.role <> 'admin' AND e.access_level <> 'admin' AND
 (p_module||'_own_only')=ANY(coalesce(e.permissions,'{}'))),false)
 FROM public.employees e WHERE e.id=public.sales_employee_id();
$$;
CREATE OR REPLACE FUNCTION public.crm_record_base_owned(p_row jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.employees e WHERE e.id=public.sales_employee_id() AND (
 p_row->>'created_by' IN (e.id::text,e.auth_user_id::text)
 OR EXISTS(SELECT 1 FROM public.contacts c WHERE c.id::text IN (p_row->>'contact_id',p_row->>'contact_person_id',p_row->>'client_id') AND c.owner_id=e.id)
 OR EXISTS(SELECT 1 FROM public.organizations o WHERE o.id=(p_row->>'organization_id')::uuid AND o.owner_id=e.id)
 OR EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=(p_row->>'inquiry_id')::uuid AND t.is_inquiry AND t.inquiry_owner_id=e.id)
 OR EXISTS(SELECT 1 FROM public.sales_partner_profiles p JOIN public.contacts c ON c.id=p.contact_id
 WHERE p.id::text IN (p_row->>'sales_partner_id',p_row->>'referring_sales_partner_id') AND c.owner_id=e.id)
 ));
$$;
CREATE OR REPLACE FUNCTION public.crm_record_owned(p_module text,p_row jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.crm_record_base_owned(p_row)
 OR (p_module='events' AND (
 EXISTS(SELECT 1 FROM public.offers o WHERE o.event_id=(p_row->>'id')::uuid AND public.crm_record_base_owned(to_jsonb(o)))
 OR EXISTS(SELECT 1 FROM public.event_calculations c WHERE c.id=(p_row->>'accepted_calculation_id')::uuid AND public.crm_record_base_owned(to_jsonb(c)))))
 OR (p_module='offers' AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=(p_row->>'event_id')::uuid AND public.crm_record_base_owned(to_jsonb(e))))
 OR (p_module='contracts' AND (
 EXISTS(SELECT 1 FROM public.events e WHERE e.id=(p_row->>'event_id')::uuid AND public.crm_record_owned('events',to_jsonb(e)))
 OR EXISTS(SELECT 1 FROM public.offers o WHERE o.id=(p_row->>'offer_id')::uuid AND public.crm_record_owned('offers',to_jsonb(o)))));
$$;
CREATE OR REPLACE FUNCTION public.crm_record_scope_allows(p_module text,p_row jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT NOT public.crm_record_scope_limited(p_module) OR public.crm_record_owned(p_module,p_row);
$$;
CREATE OR REPLACE FUNCTION public.crm_record_id_scope_allows(p_module text,p_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_row jsonb;
BEGIN
 IF NOT public.crm_record_scope_limited(p_module) THEN RETURN true; END IF;
 IF p_id IS NULL THEN RETURN false; END IF;
 IF p_module='events' THEN SELECT to_jsonb(e) INTO v_row FROM public.events e WHERE id=p_id;
 ELSIF p_module='offers' THEN SELECT to_jsonb(o) INTO v_row FROM public.offers o WHERE id=p_id;
 ELSIF p_module='contracts' THEN SELECT to_jsonb(c) INTO v_row FROM public.contracts c WHERE id=p_id;
 ELSE RETURN false; END IF;
 RETURN coalesce(public.crm_record_owned(p_module,v_row),false);
END;
$$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['events','offers','contracts'] LOOP
 EXECUTE format('CREATE POLICY crm_record_visibility_guard ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(public.crm_record_scope_allows(%L,to_jsonb(%I.*))) WITH CHECK(public.crm_record_scope_allows(%L,to_jsonb(%I.*)))',t,t,t,t,t);
 END LOOP;
END $$;
-- Child records must not reveal a hidden parent through a direct API query.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT t.relname AS child,a.attname AS column_name,f.relname AS parent
 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class f ON f.oid=c.confrelid
 JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=c.conkey[1]
 WHERE c.contype='f' AND cardinality(c.conkey)=1 AND f.relname IN ('contracts','offers','events')
 AND t.relnamespace='public'::regnamespace AND t.relrowsecurity AND t.relname NOT IN ('events','offers','contracts') LOOP
 EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(%I IS NULL OR public.crm_record_id_scope_allows(%L,%I)) WITH CHECK(%I IS NULL OR public.crm_record_id_scope_allows(%L,%I))',
 'crm_parent_scope_'||r.column_name,r.child,r.column_name,r.parent,r.column_name,r.column_name,r.parent,r.column_name);
 END LOOP;
END $$;
-- Always record the actual creator, including clients which used to omit created_by.
CREATE OR REPLACE FUNCTION public.crm_record_creator_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=public.sales_employee_id(); admin_actor boolean;
BEGIN
 IF actor IS NULL THEN RETURN NEW; END IF;
 SELECT role='admin' OR access_level='admin' INTO admin_actor FROM public.employees WHERE id=actor;
 IF TG_OP='INSERT' THEN
   IF NEW.created_by IS NULL OR NOT admin_actor THEN NEW.created_by:=actor; END IF;
 ELSIF NOT admin_actor AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
   RAISE EXCEPTION 'Tylko administrator może zmienić autora.' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['events','offers','contracts'] LOOP
 EXECUTE format('CREATE TRIGGER crm_record_creator_guard BEFORE INSERT OR UPDATE OF created_by ON public.%I FOR EACH ROW EXECUTE FUNCTION public.crm_record_creator_guard()',t);
 END LOOP;
END $$;
-- Creators can read back their records without receiving edit permissions.
CREATE OR REPLACE FUNCTION public.crm_contract_permission(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.employees e WHERE e.id=public.sales_employee_id() AND
 (e.role='admin' OR e.access_level='admin' OR 'contracts_manage'=ANY(coalesce(e.permissions,'{}'))
 OR (p_action='view' AND coalesce(e.permissions,'{}') && ARRAY['contracts_view','contracts_create'])
 OR (p_action='create' AND 'contracts_create'=ANY(coalesce(e.permissions,'{}')))));
$$;
CREATE POLICY crm_creator_offer_read ON public.offers FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM public.employees e WHERE e.id=public.sales_employee_id() AND 'offers_create'=ANY(e.permissions) AND public.crm_record_owned('offers',to_jsonb(offers.*))));
-- Preserve all existing role/brand/stage checks in the shared event authorizer and calendar.
DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('public.current_employee_can_view_event(uuid)'::regprocedure) INTO d;
 IF position('BEGIN' in d)=0 THEN RAISE EXCEPTION 'Unsupported event authorizer'; END IF;
 d:=replace(d,'BEGIN',E'BEGIN\n  IF NOT public.crm_record_id_scope_allows(''events'',p_event_id) THEN RETURN false; END IF;');
 EXECUTE d;
 SELECT pg_get_functiondef('public.get_events_list(timestamptz,timestamptz,text[])'::regprocedure) INTO d;
 IF position('(start_date IS NULL OR e.event_date >= start_date)' in d)=0 THEN RAISE EXCEPTION 'Unsupported calendar'; END IF;
 EXECUTE replace(d,'(start_date IS NULL OR e.event_date >= start_date)',E'public.crm_record_id_scope_allows(''events'',e.id)\nAND (start_date IS NULL OR e.event_date >= start_date)');
END $$;
REVOKE ALL ON FUNCTION public.crm_record_scope_limited(text),public.crm_record_base_owned(jsonb),public.crm_record_owned(text,jsonb),public.crm_record_scope_allows(text,jsonb),public.crm_record_id_scope_allows(text,uuid),public.crm_record_creator_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_record_scope_limited(text),public.crm_record_base_owned(jsonb),public.crm_record_owned(text,jsonb),public.crm_record_scope_allows(text,jsonb),public.crm_record_id_scope_allows(text,uuid) TO authenticated;
-- Privileged RPC mutations must observe the same restriction as direct table writes.
CREATE OR REPLACE FUNCTION public.crm_record_write_scope_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP <> 'INSERT' AND NOT public.crm_record_scope_allows(TG_TABLE_NAME,to_jsonb(OLD)) THEN
 RAISE EXCEPTION 'Ta sprawa jest poza Twoim zakresem danych.' USING ERRCODE='42501'; END IF;
 IF TG_OP <> 'DELETE' AND NOT public.crm_record_scope_allows(TG_TABLE_NAME,to_jsonb(NEW)) THEN
 RAISE EXCEPTION 'Ta sprawa jest poza Twoim zakresem danych.' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_record_write_scope_guard() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['events','offers','contracts'] LOOP
 EXECUTE format('CREATE TRIGGER zzz_crm_record_write_scope_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.crm_record_write_scope_guard()',t);
 END LOOP;
END $$;
-- These eight existing entry points were inspected individually. Keep their current checks.
DO $$ DECLARE signature text; d text; source text; argument_name text; module_name text; BEGIN
 FOREACH signature IN ARRAY ARRAY['public.can_manage_event_workflows(uuid)','public.can_view_event_workflows(uuid)','public.can_view_private_event_content(uuid,uuid)','public.can_view_event_commercials(uuid,boolean)','public.sales_can_manage_offer(uuid)'] LOOP
 SELECT pg_get_functiondef(signature::regprocedure),prosrc INTO d,source FROM pg_proc WHERE oid=signature::regprocedure;
 argument_name:=CASE WHEN signature='public.sales_can_manage_offer(uuid)' THEN 'p_offer' ELSE 'p_event_id' END;
 module_name:=CASE WHEN argument_name='p_offer' THEN 'offers' ELSE 'events' END;
 EXECUTE replace(d,source,format('SELECT (%I IS NULL OR public.crm_record_id_scope_allows(%L,%I)) AND coalesce((%s),false);',argument_name,module_name,argument_name,regexp_replace(trim(source),';\s*$','')));
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['public.get_event_client_info(uuid)','public.get_event_financial_info(uuid)','public.get_event_financial_summary(uuid)'] LOOP
 SELECT pg_get_functiondef(signature::regprocedure) INTO d;
 IF position('WHERE e.id = p_event_id;' in d)=0 THEN RAISE EXCEPTION 'Unexpected definition: %',signature; END IF;
 d:=replace(d,'WHERE e.id = p_event_id;','WHERE e.id = p_event_id AND public.crm_record_id_scope_allows(''events'',e.id);');
 IF signature='public.get_event_financial_info(uuid)' THEN
 d:=replace(d,'WHERE off2.event_id = e.id AND off2.status', 'WHERE public.crm_record_id_scope_allows(''offers'',off2.id) AND off2.event_id = e.id AND off2.status');
 END IF;
 EXECUTE d;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_employee_section_permissions(p_employee_id uuid, p_module text, p_permissions text[], p_expected_permissions text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_employee public.employees%ROWTYPE; v_current text[]; v_expected text[]; v_next text[];
 v_known constant text[] := ARRAY['events_view','events_view_planning','events_view_operational','events_manage','events_create','event_categories_manage','calendar_view','calendar_manage','calendar_view_accepted_only','tasks_view','tasks_manage','tasks_create','offers_view','offers_manage','offers_create','contracts_view','contracts_manage','contracts_create','contracts_own_only','offers_own_only','events_own_only','attractions_view','attractions_manage','attractions_create','clients_view','clients_manage','clients_create','contacts_view','contacts_manage','contacts_create','inquiries_view','inquiries_manage','inquiries_view_pool','inquiries_view_own','inquiries_manage_own','inquiries_view_team','inquiries_manage_team','inquiries_view_all','inquiries_manage_all','inquiries_assign','messages_view','messages_manage','messages_assign','marketing_campaigns_view','marketing_campaigns_manage','marketing_campaigns_approve','chat_view','chat_manage','chat_create_group','webhooks_view','webhooks_manage','equipment_view','equipment_manage','equipment_create','fleet_view','fleet_manage','fleet_create','locations_view','locations_manage','locations_create','subcontractors_manage','time_tracking_view_own','time_tracking_view','time_tracking_manage','mavinci_live_view','mavinci_live_manage','mavinci_live_light_magic','mavinci_live_quiz_show','mavinci_live_familiada','mavinci_live_wedding_show','mavinci_live_streaming','finances_view','finances_manage','invoices_view','invoices_manage','databases_view','databases_manage','tenders_view','personnel_view','personnel_manage','employees_view','employees_manage','employees_create','employees_permissions','page_view','page_manage','website_edit'];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.employees e WHERE (e.id=auth.uid() OR e.auth_user_id=auth.uid()) AND e.is_active AND (e.role='admin' OR e.access_level='admin')) THEN
  RAISE EXCEPTION 'Tylko administrator może zmieniać dostęp w ustawieniach aplikacji.' USING ERRCODE='42501';
 END IF;
 IF p_module IS NULL OR p_module !~ '^[a-z_]+$' OR NOT EXISTS(SELECT 1 FROM unnest(v_known) s WHERE starts_with(s,p_module||'_')) THEN
  RAISE EXCEPTION 'Nieznana sekcja.' USING ERRCODE='22023';
 END IF;
 IF p_permissions IS NULL OR p_expected_permissions IS NULL OR EXISTS(SELECT 1 FROM unnest(p_permissions) s WHERE s IS NULL OR NOT (s=ANY(v_known)) OR NOT starts_with(s,p_module||'_')) THEN
  RAISE EXCEPTION 'Nieprawidłowy zakres dla sekcji.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_employee FROM public.employees WHERE id=p_employee_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono pracownika.'; END IF;
 IF v_employee.role='admin' OR v_employee.access_level='admin' THEN RAISE EXCEPTION 'Administrator zachowuje pełny dostęp.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(array_agg(DISTINCT s ORDER BY s),'{}') INTO v_current FROM unnest(coalesce(v_employee.permissions,'{}')) s WHERE starts_with(s,p_module||'_');
 SELECT coalesce(array_agg(DISTINCT s ORDER BY s),'{}') INTO v_expected FROM unnest(p_expected_permissions) s;
 IF v_current IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'Uprawnienia tej sekcji zmieniono w innym oknie. Otwórz edycję ponownie.' USING ERRCODE='40001'; END IF;
 SELECT coalesce(array_agg(DISTINCT s ORDER BY s),'{}') INTO v_next FROM (
 SELECT s FROM unnest(coalesce(v_employee.permissions,'{}')) s WHERE NOT starts_with(s,p_module||'_')
 UNION SELECT unnest(p_permissions)) scope;
 UPDATE public.employees SET permissions=v_next,role_permissions_inherited=false,updated_at=clock_timestamp() WHERE id=p_employee_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_employee_section_permissions(uuid,text,text[],text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_employee_section_permissions(uuid,text,text[],text[]) TO authenticated;
NOTIFY pgrst,'reload schema';
