-- Warstwowy dostęp do Mavinci LIVE: rola administratora, sekcje globalne i wydarzenia.

CREATE OR REPLACE FUNCTION public.is_mavinci_live_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = public.current_mavinci_employee_id()
      AND employee.is_active = true
      AND (
        employee.role = 'admin'
        OR employee.access_level = 'admin'
        OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_mavinci_desktop()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_mavinci_live_admin() OR EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = public.current_mavinci_employee_id()
      AND employee.is_active = true
      AND (
        'mavinci_live_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'mavinci_live_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_use_mavinci_global_module(p_module_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_mavinci_live_admin()
    OR (
      public.can_access_mavinci_desktop()
      AND EXISTS (
        SELECT 1
        FROM public.employees employee
        WHERE employee.id = public.current_mavinci_employee_id()
          AND (
            p_module_key = 'light_magic'
            OR ('mavinci_live_' || p_module_key) = ANY(COALESCE(employee.permissions, '{}'::text[]))
          )
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.can_access_mavinci_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_mavinci_live_admin() OR EXISTS (
    SELECT 1
    FROM public.events event
    WHERE event.id = p_event_id
      AND (
        event.created_by = public.current_mavinci_employee_id()
        OR event.created_by = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.employee_assignments assignment
          WHERE assignment.event_id = event.id
            AND assignment.employee_id = public.current_mavinci_employee_id()
            AND COALESCE(assignment.status::text, 'accepted') = 'accepted'
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_mavinci_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_mavinci_live_admin() OR EXISTS (
    SELECT 1
    FROM public.events event
    WHERE event.id = p_event_id
      AND (
        event.created_by = public.current_mavinci_employee_id()
        OR event.created_by = auth.uid()
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_use_mavinci_module(
  p_event_id uuid,
  p_module_key text,
  p_capability text DEFAULT 'view'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_use_mavinci_global_module(p_module_key) AND (
    public.can_manage_mavinci_event(p_event_id)
    OR EXISTS (
      SELECT 1
      FROM public.mavinci_event_module_access access
      WHERE access.event_id = p_event_id
        AND access.employee_id = public.current_mavinci_employee_id()
        AND access.module_key = p_module_key
        AND access.revoked_at IS NULL
        AND (access.valid_from IS NULL OR access.valid_from <= now())
        AND (access.valid_until IS NULL OR access.valid_until >= now())
        AND CASE p_capability
          WHEN 'admin' THEN access.can_admin
          WHEN 'run' THEN access.can_run OR access.can_admin
          WHEN 'edit' THEN access.can_edit OR access.can_admin
          ELSE access.can_view OR access.can_edit OR access.can_run OR access.can_admin
        END
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.mavinci_desktop_access()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'can_access', public.can_access_mavinci_desktop(),
    'is_admin', public.is_mavinci_live_admin(),
    'modules', COALESCE((
      SELECT jsonb_agg(module_key ORDER BY display_order)
      FROM (VALUES
        ('light_magic', 1),
        ('quiz_show', 2),
        ('familiada', 3),
        ('wedding_show', 4),
        ('streaming', 5)
      ) AS available(module_key, display_order)
      WHERE public.can_use_mavinci_global_module(module_key)
    ), '[]'::jsonb)
  )
$$;

CREATE OR REPLACE FUNCTION public.mavinci_desktop_events()
RETURNS TABLE (
  event_id uuid,
  event_name text,
  event_date timestamptz,
  event_status text,
  project_id uuid,
  project_name text,
  version integer,
  enabled_modules text[],
  published_manifest jsonb,
  module_access jsonb,
  is_manager boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    event.id,
    event.name,
    event.event_date,
    event.status::text,
    project.id,
    project.name,
    COALESCE(project.version, 0),
    COALESCE(project.enabled_modules, ARRAY[]::text[]),
    project.published_manifest,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'module', enabled.module_key,
        'view', CASE WHEN public.is_mavinci_live_admin() OR public.can_manage_mavinci_event(event.id) THEN true ELSE access.can_view END,
        'edit', CASE WHEN public.is_mavinci_live_admin() OR public.can_manage_mavinci_event(event.id) THEN true ELSE access.can_edit END,
        'run', CASE WHEN public.is_mavinci_live_admin() OR public.can_manage_mavinci_event(event.id) THEN true ELSE access.can_run END,
        'admin', CASE WHEN public.is_mavinci_live_admin() OR public.can_manage_mavinci_event(event.id) THEN true ELSE access.can_admin END
      ) ORDER BY enabled.module_key)
      FROM unnest(COALESCE(project.enabled_modules, ARRAY[]::text[])) AS enabled(module_key)
      LEFT JOIN LATERAL (
        SELECT row.can_view, row.can_edit, row.can_run, row.can_admin
        FROM public.mavinci_event_module_access row
        WHERE row.event_id = event.id
          AND row.employee_id = public.current_mavinci_employee_id()
          AND row.module_key = enabled.module_key
          AND row.revoked_at IS NULL
          AND (row.valid_from IS NULL OR row.valid_from <= now())
          AND (row.valid_until IS NULL OR row.valid_until >= now())
        LIMIT 1
      ) access ON true
      WHERE public.can_use_mavinci_global_module(enabled.module_key)
        AND (
          public.is_mavinci_live_admin()
          OR public.can_manage_mavinci_event(event.id)
          OR access.can_view OR access.can_edit OR access.can_run OR access.can_admin
        )
    ), '[]'::jsonb),
    public.is_mavinci_live_admin()
  FROM public.events event
  LEFT JOIN public.mavinci_event_projects project ON project.event_id = event.id
  WHERE public.can_access_mavinci_desktop()
    AND (
      public.is_mavinci_live_admin()
      OR (
        public.can_access_mavinci_event(event.id)
        AND (
          public.can_manage_mavinci_event(event.id)
          OR EXISTS (
            SELECT 1
            FROM public.mavinci_event_module_access access
            WHERE access.event_id = event.id
              AND access.employee_id = public.current_mavinci_employee_id()
              AND access.revoked_at IS NULL
              AND (access.valid_from IS NULL OR access.valid_from <= now())
              AND (access.valid_until IS NULL OR access.valid_until >= now())
              AND public.can_use_mavinci_global_module(access.module_key)
              AND (access.can_view OR access.can_edit OR access.can_run OR access.can_admin)
          )
        )
      )
    )
  ORDER BY event.event_date DESC
$$;

CREATE OR REPLACE FUNCTION public.mavinci_desktop_heartbeat(
  p_instance_id text,
  p_device_name text,
  p_platform text,
  p_app_version text,
  p_event_id uuid DEFAULT NULL,
  p_active_module text DEFAULT NULL,
  p_sync_summary jsonb DEFAULT '{}'::jsonb
)
RETURNS public.mavinci_desktop_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  employee_id_value uuid := public.current_mavinci_employee_id();
  safe_event_id uuid;
  safe_module text;
  result public.mavinci_desktop_sessions;
BEGIN
  IF employee_id_value IS NULL OR NOT public.can_access_mavinci_desktop() THEN
    RAISE EXCEPTION 'Brak dostępu do aplikacji Mavinci LIVE';
  END IF;
  IF length(btrim(COALESCE(p_instance_id, ''))) < 8 THEN
    RAISE EXCEPTION 'Nieprawidłowy identyfikator instalacji';
  END IF;

  safe_event_id := CASE
    WHEN p_event_id IS NULL THEN NULL
    WHEN public.can_access_mavinci_event(p_event_id) OR public.can_manage_mavinci_event(p_event_id) THEN p_event_id
    ELSE NULL
  END;
  safe_module := CASE
    WHEN p_active_module IS NULL THEN NULL
    WHEN public.can_use_mavinci_global_module(p_active_module) THEN left(p_active_module, 80)
    ELSE NULL
  END;

  INSERT INTO public.mavinci_desktop_sessions (
    instance_id, employee_id, device_name, platform, app_version,
    active_event_id, active_module, sync_status, sync_summary,
    signed_in_at, last_sync_at, last_seen_at, updated_at
  ) VALUES (
    left(btrim(p_instance_id), 160), employee_id_value,
    left(COALESCE(NULLIF(btrim(p_device_name), ''), 'Mavinci LIVE'), 160),
    left(COALESCE(NULLIF(btrim(p_platform), ''), 'unknown'), 40),
    left(COALESCE(p_app_version, ''), 40), safe_event_id, safe_module,
    'online', COALESCE(p_sync_summary, '{}'::jsonb), now(), now(), now(), now()
  )
  ON CONFLICT (instance_id) DO UPDATE SET
    employee_id = EXCLUDED.employee_id,
    device_name = EXCLUDED.device_name,
    platform = EXCLUDED.platform,
    app_version = EXCLUDED.app_version,
    active_event_id = EXCLUDED.active_event_id,
    active_module = EXCLUDED.active_module,
    sync_status = 'online',
    sync_summary = EXCLUDED.sync_summary,
    last_sync_at = now(),
    last_seen_at = now(),
    updated_at = now()
  RETURNING * INTO result;

  RETURN result;
END;
$$;

DROP POLICY IF EXISTS mavinci_familiada_questions_select ON public.mavinci_familiada_questions;
CREATE POLICY mavinci_familiada_questions_select
ON public.mavinci_familiada_questions FOR SELECT
USING (
  public.can_use_mavinci_global_module('familiada')
  AND (
    public.can_use_mavinci_hub('view')
    OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'familiada', 'view'))
  )
);

DROP POLICY IF EXISTS mavinci_familiada_questions_write ON public.mavinci_familiada_questions;
CREATE POLICY mavinci_familiada_questions_write
ON public.mavinci_familiada_questions FOR ALL
USING (
  public.can_use_mavinci_global_module('familiada')
  AND (
    public.can_use_mavinci_hub('manage')
    OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'familiada', 'edit'))
  )
)
WITH CHECK (
  public.can_use_mavinci_global_module('familiada')
  AND (
    public.can_use_mavinci_hub('manage')
    OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'familiada', 'edit'))
  )
);

GRANT EXECUTE ON FUNCTION public.is_mavinci_live_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_mavinci_desktop() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_use_mavinci_global_module(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_use_mavinci_module(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_desktop_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_desktop_events() TO authenticated;
