-- Security Advisor: the eight objects reported on 2026-10-06.
-- No data is removed. Existing source-table policies are not broadened.
-- Some legacy tables/views were created outside migrations; skip absent objects
-- on fresh installations. Run the entire transaction, not individual statements.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '15s';

DO $$
DECLARE object_name text;
BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION 'Ta migracja wymaga PostgreSQL 15 lub nowszego.';
  END IF;

  FOREACH object_name IN ARRAY ARRAY['_backup_equipment_items', '_backup_equipment_units'] LOOP
    IF to_regclass(format('public.%I', object_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', object_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', object_name);
      -- Intentionally no client policies: these are administrative backup copies.
      -- Database owner and the existing service_role retain their access.
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.meeting_events') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.meeting_events ENABLE ROW LEVEL SECURITY;
  REVOKE ALL PRIVILEGES ON TABLE public.meeting_events FROM PUBLIC, anon;
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.meeting_events FROM authenticated;

  -- Both linked records must be visible under their existing RLS policies.
  DROP POLICY IF EXISTS meeting_events_visible_links ON public.meeting_events;
  CREATE POLICY meeting_events_visible_links ON public.meeting_events
    FOR SELECT TO authenticated
    USING (
      EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_events.meeting_id)
      AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = meeting_events.event_id)
    );

  -- Reuse the established creator check; viewing a meeting is not edit access.
  DROP POLICY IF EXISTS meeting_events_creator_insert ON public.meeting_events;
  CREATE POLICY meeting_events_creator_insert ON public.meeting_events
    FOR INSERT TO authenticated
    WITH CHECK (
      public.is_meeting_creator(meeting_id)
      AND EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_events.meeting_id)
      AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = meeting_events.event_id)
    );

  DROP POLICY IF EXISTS meeting_events_creator_update ON public.meeting_events;
  CREATE POLICY meeting_events_creator_update ON public.meeting_events
    FOR UPDATE TO authenticated
    USING (
      public.is_meeting_creator(meeting_id)
      AND EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_events.meeting_id)
      AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = meeting_events.event_id)
    )
    WITH CHECK (
      public.is_meeting_creator(meeting_id)
      AND EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_events.meeting_id)
      AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = meeting_events.event_id)
    );

  DROP POLICY IF EXISTS meeting_events_creator_delete ON public.meeting_events;
  CREATE POLICY meeting_events_creator_delete ON public.meeting_events
    FOR DELETE TO authenticated
    USING (
      public.is_meeting_creator(meeting_id)
      AND EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_events.meeting_id)
      AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = meeting_events.event_id)
    );
END $$;

DO $$
DECLARE object_name text;
BEGIN
  FOREACH object_name IN ARRAY ARRAY[
    'invoices_with_relations', 'fleet_vehicles_view', 'equipment_external_rentals',
    'offer_products_with_subcontractor', 'event_phase_resource_summary'
  ] LOOP
    IF to_regclass(format('public.%I', object_name)) IS NOT NULL THEN
      -- Preserve each view's definition, columns and PostgREST relationships.
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', object_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon', object_name);
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', object_name);
      -- Keep the existing authenticated SELECT grant; do not grant source access.
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
