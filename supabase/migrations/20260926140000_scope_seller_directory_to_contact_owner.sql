BEGIN;

-- Directory scope only: do not change offer, chat, pricing, finance or storage
-- policies here. Existing module permissions remain necessary.
-- contacts.owner_id contains an employee UUID, not an auth user UUID.
CREATE OR REPLACE FUNCTION public.seller_directory_crm_row_access(p_employee uuid,p_contact uuid,p_type text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND NOT public.current_session_is_seller_portal()
    AND EXISTS(SELECT 1 FROM public.employees e
      WHERE e.id=public.current_employee_id() AND e.is_active=true
        AND (e.role::text='admin' OR e.access_level::text='admin'
          OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[]))
          OR (p_employee IS NULL AND p_contact IS NOT NULL
            AND p_type IN ('hotel_employee','agency_employee','independent_referrer')
            AND EXISTS(SELECT 1 FROM public.contacts c WHERE c.id=p_contact AND c.owner_id=e.id))));
$$;
REVOKE ALL ON FUNCTION public.seller_directory_crm_row_access(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.seller_directory_crm_row_access(uuid,uuid,text) TO authenticated;

-- Some older directory policies recognize role/permission admin but omit the
-- newer access_level. Null person arguments grant this SELECT only to admins.
DROP POLICY IF EXISTS seller_directory_admin_read ON public.sales_partner_profiles;
CREATE POLICY seller_directory_admin_read ON public.sales_partner_profiles
  FOR SELECT TO authenticated USING(public.seller_directory_crm_row_access(NULL,NULL,NULL));

-- A restrictive SELECT guard also narrows the old permissive FOR ALL policy.
-- Portal accounts keep access to their own profile, not to the CRM directory.
DROP POLICY IF EXISTS seller_directory_read_scope ON public.sales_partner_profiles;
CREATE POLICY seller_directory_read_scope ON public.sales_partner_profiles AS RESTRICTIVE
  FOR SELECT TO authenticated USING(
    public.seller_directory_crm_row_access(employee_id,contact_id,partner_type)
    OR id=public.current_sales_partner_id()
  );
DROP POLICY IF EXISTS seller_directory_insert_scope ON public.sales_partner_profiles;
CREATE POLICY seller_directory_insert_scope ON public.sales_partner_profiles AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK(public.seller_directory_crm_row_access(employee_id,contact_id,partner_type));
DROP POLICY IF EXISTS seller_directory_update_scope ON public.sales_partner_profiles;
CREATE POLICY seller_directory_update_scope ON public.sales_partner_profiles AS RESTRICTIVE
  FOR UPDATE TO authenticated USING(public.seller_directory_crm_row_access(employee_id,contact_id,partner_type))
  WITH CHECK(public.seller_directory_crm_row_access(employee_id,contact_id,partner_type));
DROP POLICY IF EXISTS seller_directory_delete_scope ON public.sales_partner_profiles;
CREATE POLICY seller_directory_delete_scope ON public.sales_partner_profiles AS RESTRICTIVE
  FOR DELETE TO authenticated USING(public.seller_directory_crm_row_access(employee_id,contact_id,partner_type));

-- SECURITY INVOKER preserves existing RLS and company/module permissions.
-- Return session-derived flags so a cached admin flag cannot widen this view.
CREATE OR REPLACE FUNCTION public.get_crm_seller_directory()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_admin boolean;
  v_profiles jsonb;
  v_partner_ids uuid[];
  v_inbox jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.current_session_is_seller_portal() THEN
    RAISE EXCEPTION 'Brak dostępu do kartoteki sprzedawców CRM' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_employee FROM public.employees WHERE id=public.current_employee_id() AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Brak aktywnego pracownika CRM' USING ERRCODE='42501'; END IF;
  v_admin:=COALESCE(v_employee.role::text='admin' OR v_employee.access_level::text='admin'
    OR 'admin'=ANY(COALESCE(v_employee.permissions,'{}'::text[])),false);
  IF NOT v_admin AND NOT (COALESCE(v_employee.permissions,'{}'::text[])
    && ARRAY['contacts_view','contacts_manage','finances_view','finances_manage']) THEN
    RAISE EXCEPTION 'Brak uprawnień do kartoteki sprzedawców' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',p.id,'employee_id',p.employee_id,'contact_id',p.contact_id,'partner_type',p.partner_type,
    'organization_id',p.organization_id,'status',p.status,'portal_enabled',p.portal_enabled,
    'portal_auth_user_id',p.portal_auth_user_id,'notes',p.notes
  ) ORDER BY p.created_at DESC,p.id),'[]'::jsonb),COALESCE(array_agg(p.id),'{}'::uuid[])
  INTO v_profiles,v_partner_ids
  FROM public.sales_partner_profiles p
  WHERE public.seller_directory_crm_row_access(p.employee_id,p.contact_id,p.partner_type);

  SELECT COALESCE(jsonb_agg(item.value ORDER BY item.ordinality),'[]'::jsonb) INTO v_inbox
  FROM jsonb_array_elements(public.get_seller_inbox()) WITH ORDINALITY item(value,ordinality)
  WHERE (item.value->>'sales_partner_id')::uuid=ANY(v_partner_ids);

  RETURN jsonb_build_object('employee_id',v_employee.id,'is_admin',v_admin,
    'can_manage',v_admin OR COALESCE(v_employee.permissions,'{}'::text[]) && ARRAY['contacts_manage','finances_manage'],
    'profiles',v_profiles,'inbox',v_inbox);
END; $$;
REVOKE ALL ON FUNCTION public.get_crm_seller_directory() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_crm_seller_directory() TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
