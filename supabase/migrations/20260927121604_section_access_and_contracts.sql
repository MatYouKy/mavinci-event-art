-- Both access editors use employees.permissions; no duplicate membership table.
CREATE OR REPLACE FUNCTION public.crm_contract_permission(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS(SELECT 1 FROM public.employees e
 WHERE (e.id=auth.uid() OR e.auth_user_id=auth.uid()) AND e.is_active
 AND (e.role='admin' OR e.access_level='admin' OR 'contracts_manage'=ANY(coalesce(e.permissions,'{}'::text[]))
 OR (p_action='view' AND 'contracts_view'=ANY(coalesce(e.permissions,'{}'::text[])))
 OR (p_action='create' AND 'contracts_create'=ANY(coalesce(e.permissions,'{}'::text[])))));
$$;
REVOKE ALL ON FUNCTION public.crm_contract_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_contract_permission(text) TO authenticated;
CREATE POLICY contracts_read_scope_guard ON public.contracts AS RESTRICTIVE FOR SELECT TO authenticated USING(public.crm_contract_permission('view'));
CREATE POLICY contracts_create_scope_guard ON public.contracts AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.crm_contract_permission('create'));
CREATE POLICY contracts_update_scope_guard ON public.contracts AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.crm_contract_permission('manage')) WITH CHECK(public.crm_contract_permission('manage'));
CREATE POLICY contracts_delete_scope_guard ON public.contracts AS RESTRICTIVE FOR DELETE TO authenticated USING(public.crm_contract_permission('manage'));
-- Support both employee/auth identifiers, while existing restrictive brand/portal rules still apply.
CREATE POLICY contracts_read_scope ON public.contracts FOR SELECT TO authenticated USING(public.crm_contract_permission('view'));
CREATE POLICY contracts_create_scope ON public.contracts FOR INSERT TO authenticated WITH CHECK(public.crm_contract_permission('create'));
CREATE POLICY contracts_update_scope ON public.contracts FOR UPDATE TO authenticated USING(public.crm_contract_permission('manage')) WITH CHECK(public.crm_contract_permission('manage'));
CREATE POLICY contracts_delete_scope ON public.contracts FOR DELETE TO authenticated USING(public.crm_contract_permission('manage'));
CREATE POLICY contract_templates_read_scope_guard ON public.contract_templates AS RESTRICTIVE FOR SELECT TO authenticated USING(public.crm_contract_permission('view'));
CREATE POLICY contract_templates_read_scope ON public.contract_templates FOR SELECT TO authenticated USING(public.crm_contract_permission('view'));

CREATE OR REPLACE FUNCTION public.admin_set_employee_section_permissions(p_employee_id uuid, p_module text, p_permissions text[], p_expected_permissions text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_employee public.employees%ROWTYPE; v_current text[]; v_expected text[]; v_next text[];
 v_known constant text[] := ARRAY['events_view','events_view_planning','events_view_operational','events_manage','events_create','event_categories_manage','calendar_view','calendar_manage','calendar_view_accepted_only','tasks_view','tasks_manage','tasks_create','offers_view','offers_manage','offers_create','contracts_view','contracts_manage','contracts_create','attractions_view','attractions_manage','attractions_create','clients_view','clients_manage','clients_create','contacts_view','contacts_manage','contacts_create','inquiries_view','inquiries_manage','inquiries_view_pool','inquiries_view_own','inquiries_manage_own','inquiries_view_team','inquiries_manage_team','inquiries_view_all','inquiries_manage_all','inquiries_assign','messages_view','messages_manage','messages_assign','marketing_campaigns_view','marketing_campaigns_manage','marketing_campaigns_approve','chat_view','chat_manage','chat_create_group','webhooks_view','webhooks_manage','equipment_view','equipment_manage','equipment_create','fleet_view','fleet_manage','fleet_create','locations_view','locations_manage','locations_create','subcontractors_manage','time_tracking_view_own','time_tracking_view','time_tracking_manage','mavinci_live_view','mavinci_live_manage','mavinci_live_light_magic','mavinci_live_quiz_show','mavinci_live_familiada','mavinci_live_wedding_show','mavinci_live_streaming','finances_view','finances_manage','invoices_view','invoices_manage','databases_view','databases_manage','tenders_view','personnel_view','personnel_manage','employees_view','employees_manage','employees_create','employees_permissions','page_view','page_manage','website_edit'];
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
