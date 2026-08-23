-- Mavinci LIVE Cloud: projekty wydarzeń, dostęp modułowy i presety LightMagic.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.current_mavinci_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.employees
  WHERE is_active = true
    AND (auth_user_id = auth.uid() OR id = auth.uid())
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.can_access_mavinci_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = p_event_id
      AND (
        e.created_by = public.current_mavinci_employee_id()
        OR e.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.employee_assignments ea
          WHERE ea.event_id = e.id
            AND ea.employee_id = public.current_mavinci_employee_id()
            AND COALESCE(ea.status::text, 'accepted') = 'accepted'
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
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = p_event_id
      AND (
        e.created_by = public.current_mavinci_employee_id()
        OR e.created_by = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.employees employee
          WHERE employee.id = public.current_mavinci_employee_id()
            AND employee.role = 'admin'
        )
      )
  )
$$;

CREATE TABLE IF NOT EXISTS public.mavinci_event_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  enabled_modules text[] NOT NULL DEFAULT ARRAY['quiz_show']::text[],
  draft_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_manifest jsonb,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mavinci_event_project_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.mavinci_event_projects(id) ON DELETE CASCADE,
  version integer NOT NULL,
  manifest jsonb NOT NULL,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, version)
);

CREATE TABLE IF NOT EXISTS public.mavinci_event_module_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  module_key text NOT NULL CHECK (module_key IN ('quiz_show', 'familiada', 'wedding_show', 'light_magic', 'streaming')),
  can_view boolean NOT NULL DEFAULT true,
  can_edit boolean NOT NULL DEFAULT false,
  can_run boolean NOT NULL DEFAULT false,
  can_admin boolean NOT NULL DEFAULT false,
  valid_from timestamptz,
  valid_until timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, employee_id, module_key)
);

CREATE TABLE IF NOT EXISTS public.mavinci_light_magic_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  schema_version integer NOT NULL DEFAULT 1,
  snapshot jsonb NOT NULL,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

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
  SELECT public.can_manage_mavinci_event(p_event_id) OR EXISTS (
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
$$;

CREATE INDEX IF NOT EXISTS idx_mavinci_projects_event ON public.mavinci_event_projects(event_id);
CREATE INDEX IF NOT EXISTS idx_mavinci_module_access_employee ON public.mavinci_event_module_access(employee_id, event_id);
CREATE INDEX IF NOT EXISTS idx_mavinci_presets_event ON public.mavinci_light_magic_presets(event_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.set_mavinci_audit_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := public.current_mavinci_employee_id();
  IF TG_OP = 'INSERT' AND NEW.created_by IS NULL THEN NEW.created_by := public.current_mavinci_employee_id(); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mavinci_projects_audit ON public.mavinci_event_projects;
CREATE TRIGGER trg_mavinci_projects_audit BEFORE INSERT OR UPDATE ON public.mavinci_event_projects
FOR EACH ROW EXECUTE FUNCTION public.set_mavinci_audit_fields();

DROP TRIGGER IF EXISTS trg_mavinci_presets_audit ON public.mavinci_light_magic_presets;
CREATE TRIGGER trg_mavinci_presets_audit BEFORE INSERT OR UPDATE ON public.mavinci_light_magic_presets
FOR EACH ROW EXECUTE FUNCTION public.set_mavinci_audit_fields();

ALTER TABLE public.mavinci_event_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavinci_event_project_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavinci_event_module_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavinci_light_magic_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY mavinci_projects_select ON public.mavinci_event_projects FOR SELECT
USING (public.can_access_mavinci_event(event_id));
CREATE POLICY mavinci_projects_write ON public.mavinci_event_projects FOR ALL
USING (public.can_manage_mavinci_event(event_id))
WITH CHECK (public.can_manage_mavinci_event(event_id));

CREATE POLICY mavinci_revisions_select ON public.mavinci_event_project_revisions FOR SELECT
USING (EXISTS (SELECT 1 FROM public.mavinci_event_projects p WHERE p.id = project_id AND public.can_access_mavinci_event(p.event_id)));
CREATE POLICY mavinci_revisions_insert ON public.mavinci_event_project_revisions FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.mavinci_event_projects p WHERE p.id = project_id AND public.can_manage_mavinci_event(p.event_id)));

CREATE POLICY mavinci_module_access_select ON public.mavinci_event_module_access FOR SELECT
USING (employee_id = public.current_mavinci_employee_id() OR public.can_manage_mavinci_event(event_id));
CREATE POLICY mavinci_module_access_write ON public.mavinci_event_module_access FOR ALL
USING (public.can_manage_mavinci_event(event_id))
WITH CHECK (public.can_manage_mavinci_event(event_id));

CREATE POLICY mavinci_presets_select ON public.mavinci_light_magic_presets FOR SELECT
USING ((event_id IS NULL AND created_by = public.current_mavinci_employee_id()) OR public.can_use_mavinci_module(event_id, 'light_magic', 'view'));
CREATE POLICY mavinci_presets_write ON public.mavinci_light_magic_presets FOR ALL
USING ((event_id IS NULL AND created_by = public.current_mavinci_employee_id()) OR public.can_use_mavinci_module(event_id, 'light_magic', 'edit'))
WITH CHECK (event_id IS NULL OR public.can_use_mavinci_module(event_id, 'light_magic', 'edit'));

CREATE OR REPLACE FUNCTION public.publish_mavinci_event_project(p_project_id uuid)
RETURNS public.mavinci_event_projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project public.mavinci_event_projects;
BEGIN
  SELECT * INTO v_project FROM public.mavinci_event_projects WHERE id = p_project_id FOR UPDATE;
  IF v_project.id IS NULL OR NOT public.can_manage_mavinci_event(v_project.event_id) THEN
    RAISE EXCEPTION 'Brak dostępu do projektu Mavinci LIVE';
  END IF;
  UPDATE public.mavinci_event_projects
  SET version = version + 1, published_manifest = draft_manifest
  WHERE id = p_project_id
  RETURNING * INTO v_project;
  INSERT INTO public.mavinci_event_project_revisions(project_id, version, manifest, created_by)
  VALUES (v_project.id, v_project.version, v_project.published_manifest, public.current_mavinci_employee_id());
  RETURN v_project;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_mavinci_module_access(
  p_event_id uuid,
  p_employee_id uuid,
  p_access jsonb,
  p_valid_from timestamptz DEFAULT NULL,
  p_valid_until timestamptz DEFAULT NULL
)
RETURNS SETOF public.mavinci_event_module_access
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_mavinci_event(p_event_id) THEN
    RAISE EXCEPTION 'Brak uprawnień do zarządzania dostępem Mavinci LIVE';
  END IF;
  IF p_valid_from IS NOT NULL AND p_valid_until IS NOT NULL AND p_valid_from >= p_valid_until THEN
    RAISE EXCEPTION 'Data końca dostępu musi być późniejsza niż data rozpoczęcia';
  END IF;

  DELETE FROM public.mavinci_event_module_access
  WHERE event_id = p_event_id AND employee_id = p_employee_id;

  INSERT INTO public.mavinci_event_module_access (
    event_id, employee_id, module_key, can_view, can_edit, can_run, can_admin,
    valid_from, valid_until, created_by
  )
  SELECT
    p_event_id,
    p_employee_id,
    item->>'module_key',
    true,
    item->>'level' IN ('edit', 'run', 'admin'),
    item->>'level' IN ('run', 'admin'),
    item->>'level' = 'admin',
    p_valid_from,
    p_valid_until,
    public.current_mavinci_employee_id()
  FROM jsonb_array_elements(COALESCE(p_access, '[]'::jsonb)) item
  WHERE item->>'module_key' IN ('quiz_show', 'familiada', 'wedding_show', 'light_magic', 'streaming')
    AND item->>'level' IN ('view', 'edit', 'run', 'admin');

  RETURN QUERY
  SELECT * FROM public.mavinci_event_module_access
  WHERE event_id = p_event_id AND employee_id = p_employee_id
  ORDER BY module_key;
END;
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
  SELECT e.id, e.name, e.event_date, e.status::text,
    p.id, p.name, COALESCE(p.version, 0), COALESCE(p.enabled_modules, ARRAY[]::text[]), p.published_manifest,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'module', a.module_key, 'view', a.can_view, 'edit', a.can_edit,
        'run', a.can_run, 'admin', a.can_admin, 'validFrom', a.valid_from, 'validUntil', a.valid_until
      ))
      FROM public.mavinci_event_module_access a
      WHERE a.event_id = e.id
        AND a.employee_id = public.current_mavinci_employee_id()
        AND a.revoked_at IS NULL
        AND (a.valid_from IS NULL OR a.valid_from <= now())
        AND (a.valid_until IS NULL OR a.valid_until >= now())
    ), '[]'::jsonb),
    public.can_manage_mavinci_event(e.id)
  FROM public.events e
  LEFT JOIN public.mavinci_event_projects p ON p.event_id = e.id
  WHERE public.can_access_mavinci_event(e.id)
    AND (
      public.can_manage_mavinci_event(e.id)
      OR EXISTS (
        SELECT 1
        FROM public.mavinci_event_module_access access
        WHERE access.event_id = e.id
          AND access.employee_id = public.current_mavinci_employee_id()
          AND access.can_view = true
          AND access.revoked_at IS NULL
          AND (access.valid_from IS NULL OR access.valid_from <= now())
          AND (access.valid_until IS NULL OR access.valid_until >= now())
      )
    )
  ORDER BY e.event_date DESC;
$$;

GRANT EXECUTE ON FUNCTION public.mavinci_desktop_events() TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_mavinci_event_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_mavinci_module_access(uuid, uuid, jsonb, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_mavinci_event(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_use_mavinci_module(uuid, text, text) TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavinci_event_projects TO authenticated;
GRANT SELECT, INSERT ON public.mavinci_event_project_revisions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavinci_event_module_access TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavinci_light_magic_presets TO authenticated;
