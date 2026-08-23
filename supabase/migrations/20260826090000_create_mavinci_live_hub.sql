-- Centralny hub Mavinci LIVE: bank Familiady, aktywne instalacje i stan synchronizacji.

CREATE OR REPLACE FUNCTION public.can_use_mavinci_hub(p_capability text DEFAULT 'view')
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
        OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'mavinci_live_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR (
          p_capability = 'view'
          AND 'mavinci_live_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
      )
  )
$$;

CREATE TABLE IF NOT EXISTS public.mavinci_familiada_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'Ogólne',
  question text NOT NULL,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  is_active boolean NOT NULL DEFAULT true,
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  source text NOT NULL DEFAULT 'crm' CHECK (source IN ('crm', 'desktop', 'import')),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(btrim(question)) BETWEEN 2 AND 500),
  CHECK (jsonb_typeof(answers) = 'array'),
  CHECK (jsonb_array_length(answers) BETWEEN 1 AND 8)
);

CREATE OR REPLACE FUNCTION public.validate_mavinci_familiada_answers()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  answer jsonb;
  answer_points integer;
  points_sum integer := 0;
BEGIN
  FOR answer IN SELECT value FROM jsonb_array_elements(NEW.answers)
  LOOP
    IF jsonb_typeof(answer) <> 'object'
      OR length(btrim(COALESCE(answer->>'text', ''))) = 0
      OR NOT (answer ? 'points')
      OR jsonb_typeof(answer->'points') <> 'number'
    THEN
      RAISE EXCEPTION 'Każda odpowiedź musi zawierać tekst i liczbę punktów';
    END IF;

    answer_points := (answer->>'points')::integer;
    IF answer_points < 0 OR answer_points > 100 THEN
      RAISE EXCEPTION 'Punkty odpowiedzi muszą mieścić się w zakresie 0–100';
    END IF;
    points_sum := points_sum + answer_points;
  END LOOP;

  IF points_sum > 100 THEN
    RAISE EXCEPTION 'Suma punktów odpowiedzi nie może przekraczać 100';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_mavinci_familiada_answers ON public.mavinci_familiada_questions;
CREATE TRIGGER trg_validate_mavinci_familiada_answers
BEFORE INSERT OR UPDATE OF answers ON public.mavinci_familiada_questions
FOR EACH ROW EXECUTE FUNCTION public.validate_mavinci_familiada_answers();

DROP TRIGGER IF EXISTS trg_mavinci_familiada_audit ON public.mavinci_familiada_questions;
CREATE TRIGGER trg_mavinci_familiada_audit
BEFORE INSERT OR UPDATE ON public.mavinci_familiada_questions
FOR EACH ROW EXECUTE FUNCTION public.set_mavinci_audit_fields();

CREATE TABLE IF NOT EXISTS public.mavinci_desktop_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id text NOT NULL UNIQUE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  device_name text NOT NULL DEFAULT 'Mavinci LIVE',
  platform text NOT NULL DEFAULT 'unknown',
  app_version text NOT NULL DEFAULT '',
  active_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  active_module text,
  sync_status text NOT NULL DEFAULT 'online' CHECK (sync_status IN ('online', 'idle', 'offline', 'error')),
  sync_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  signed_in_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mavinci_questions_category
  ON public.mavinci_familiada_questions(category, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mavinci_questions_event
  ON public.mavinci_familiada_questions(event_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mavinci_desktop_sessions_seen
  ON public.mavinci_desktop_sessions(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_mavinci_desktop_sessions_employee
  ON public.mavinci_desktop_sessions(employee_id, last_seen_at DESC);

ALTER TABLE public.mavinci_familiada_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavinci_desktop_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY mavinci_familiada_questions_select
ON public.mavinci_familiada_questions FOR SELECT
USING (
  public.can_use_mavinci_hub('view')
  OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'familiada', 'view'))
  OR (
    event_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.mavinci_event_module_access access
      WHERE access.employee_id = public.current_mavinci_employee_id()
        AND access.module_key = 'familiada'
        AND access.revoked_at IS NULL
        AND (access.valid_from IS NULL OR access.valid_from <= now())
        AND (access.valid_until IS NULL OR access.valid_until >= now())
        AND (access.can_view OR access.can_edit OR access.can_run OR access.can_admin)
    )
  )
);

CREATE POLICY mavinci_familiada_questions_write
ON public.mavinci_familiada_questions FOR ALL
USING (
  public.can_use_mavinci_hub('manage')
  OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'familiada', 'edit'))
)
WITH CHECK (
  public.can_use_mavinci_hub('manage')
  OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'familiada', 'edit'))
);

CREATE POLICY mavinci_desktop_sessions_select
ON public.mavinci_desktop_sessions FOR SELECT
USING (
  employee_id = public.current_mavinci_employee_id()
  OR public.can_use_mavinci_hub('view')
);

CREATE POLICY mavinci_desktop_sessions_delete
ON public.mavinci_desktop_sessions FOR DELETE
USING (public.can_use_mavinci_hub('manage'));

DROP POLICY IF EXISTS mavinci_presets_select ON public.mavinci_light_magic_presets;
CREATE POLICY mavinci_presets_select ON public.mavinci_light_magic_presets FOR SELECT
USING (
  public.can_use_mavinci_hub('view')
  OR (event_id IS NULL AND created_by = public.current_mavinci_employee_id())
  OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'light_magic', 'view'))
);

DROP POLICY IF EXISTS mavinci_presets_write ON public.mavinci_light_magic_presets;
CREATE POLICY mavinci_presets_write ON public.mavinci_light_magic_presets FOR ALL
USING (
  public.can_use_mavinci_hub('manage')
  OR (event_id IS NULL AND created_by = public.current_mavinci_employee_id())
  OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'light_magic', 'edit'))
)
WITH CHECK (
  public.can_use_mavinci_hub('manage')
  OR (event_id IS NULL AND created_by = public.current_mavinci_employee_id())
  OR (event_id IS NOT NULL AND public.can_use_mavinci_module(event_id, 'light_magic', 'edit'))
);

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
  result public.mavinci_desktop_sessions;
BEGIN
  IF employee_id_value IS NULL THEN
    RAISE EXCEPTION 'Brak aktywnego pracownika CRM';
  END IF;
  IF length(btrim(COALESCE(p_instance_id, ''))) < 8 THEN
    RAISE EXCEPTION 'Nieprawidłowy identyfikator instalacji';
  END IF;

  safe_event_id := CASE
    WHEN p_event_id IS NULL THEN NULL
    WHEN public.can_access_mavinci_event(p_event_id) OR public.can_manage_mavinci_event(p_event_id) THEN p_event_id
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
    left(COALESCE(p_app_version, ''), 40), safe_event_id,
    left(NULLIF(btrim(COALESCE(p_active_module, '')), ''), 80),
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

CREATE OR REPLACE FUNCTION public.mavinci_desktop_disconnect(p_instance_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.mavinci_desktop_sessions
  SET sync_status = 'offline', last_seen_at = now(), updated_at = now()
  WHERE instance_id = p_instance_id
    AND employee_id = public.current_mavinci_employee_id();
END;
$$;

CREATE OR REPLACE FUNCTION public.mavinci_hub_desktop_sessions()
RETURNS TABLE (
  id uuid,
  instance_id text,
  employee_id uuid,
  employee_name text,
  employee_email text,
  device_name text,
  platform text,
  app_version text,
  active_event_id uuid,
  event_name text,
  active_module text,
  sync_status text,
  sync_summary jsonb,
  last_sync_at timestamptz,
  last_seen_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    session.id,
    session.instance_id,
    session.employee_id,
    concat_ws(' ', employee.name, employee.surname),
    employee.email,
    session.device_name,
    session.platform,
    session.app_version,
    session.active_event_id,
    event.name,
    session.active_module,
    session.sync_status,
    session.sync_summary,
    session.last_sync_at,
    session.last_seen_at
  FROM public.mavinci_desktop_sessions session
  JOIN public.employees employee ON employee.id = session.employee_id
  LEFT JOIN public.events event ON event.id = session.active_event_id
  WHERE public.can_use_mavinci_hub('view')
  ORDER BY session.last_seen_at DESC
$$;

CREATE OR REPLACE FUNCTION public.mavinci_hub_projects()
RETURNS TABLE (
  id uuid,
  event_id uuid,
  event_name text,
  event_date timestamptz,
  event_status text,
  name text,
  enabled_modules text[],
  version integer,
  published_manifest jsonb,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    project.id,
    project.event_id,
    event.name,
    event.event_date,
    event.status::text,
    project.name,
    project.enabled_modules,
    project.version,
    project.published_manifest,
    project.updated_at
  FROM public.mavinci_event_projects project
  JOIN public.events event ON event.id = project.event_id
  WHERE public.can_use_mavinci_hub('view')
  ORDER BY project.updated_at DESC
$$;

GRANT EXECUTE ON FUNCTION public.can_use_mavinci_hub(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_desktop_heartbeat(text, text, text, text, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_desktop_disconnect(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_hub_desktop_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_hub_projects() TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavinci_familiada_questions TO authenticated;
GRANT SELECT, DELETE ON public.mavinci_desktop_sessions TO authenticated;
