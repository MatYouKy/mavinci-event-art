-- Read-only warehouse access must not inherit the legacy authenticated write policies.
CREATE OR REPLACE FUNCTION public.can_write_equipment_catalog(p_create boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE (e.id = auth.uid() OR e.auth_user_id = auth.uid())
      AND e.is_active = true
      AND (e.role = 'admin' OR e.access_level = 'admin'
        OR 'equipment_manage' = ANY(coalesce(e.permissions, '{}'::text[]))
        OR 'equipment:manage' = ANY(coalesce(e.permissions, '{}'::text[]))
        OR (p_create AND 'equipment_create' = ANY(coalesce(e.permissions, '{}'::text[]))))
  );
$$;
REVOKE ALL ON FUNCTION public.can_write_equipment_catalog(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_write_equipment_catalog(boolean) TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['equipment_kits','equipment_kit_items','storage_locations',
    'connector_types','equipment_files','equipment_images','equipment_skill_requirements']
  LOOP
    EXECUTE format('CREATE POLICY equipment_catalog_insert_guard ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_write_equipment_catalog(true))', t);
    EXECUTE format('CREATE POLICY equipment_catalog_update_guard ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_write_equipment_catalog(false)) WITH CHECK (public.can_write_equipment_catalog(false))', t);
    EXECUTE format('CREATE POLICY equipment_catalog_delete_guard ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_write_equipment_catalog(false))', t);
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
