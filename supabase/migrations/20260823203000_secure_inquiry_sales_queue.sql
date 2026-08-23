/*
  # Bezpieczna wspólna kolejka zapytań sprzedażowych

  - nowe zapytania pozostają nieprzypisane i trafiają do wspólnej kolejki,
  - przejęcie jest atomowe (jedno zapytanie może wygrać tylko jedna osoba),
  - dostęp do zapytań jest niezależny od zwykłych uprawnień do zadań,
  - administrator widzi wszystko, a menedżer może pracować w obrębie zespołu,
  - ustawienia dostarczania powiadomień pozostają niezależne od dostępu do danych.
*/

CREATE TABLE IF NOT EXISTS public.sales_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS sales_team_id uuid REFERENCES public.sales_teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_sales_team_manager boolean NOT NULL DEFAULT false;

ALTER TABLE public.employee_notification_settings
  ADD COLUMN IF NOT EXISTS inquiry_assignments_enabled boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_employees_sales_team
  ON public.employees (sales_team_id)
  WHERE is_active = true;

INSERT INTO public.sales_teams (name)
VALUES ('Sprzedaż')
ON CONFLICT (name) DO NOTHING;

-- Zachowujemy dostęp dotychczasowych osób zarządzających zadaniami. Pozostałym
-- pracownikom administrator nada dostęp świadomie w panelu pracownika.
UPDATE public.employees
SET permissions = ARRAY(
  SELECT DISTINCT permission
  FROM unnest(
    COALESCE(permissions, '{}'::text[])
    || ARRAY[
      'inquiries_view',
      'inquiries_manage',
      'inquiries_view_pool',
      'inquiries_view_own',
      'inquiries_manage_own',
      'inquiries_view_team',
      'inquiries_manage_team',
      'inquiries_assign'
    ]::text[]
  ) AS permission
)
WHERE is_active = true
  AND 'tasks_manage' = ANY(COALESCE(permissions, '{}'::text[]));

UPDATE public.employees employee
SET sales_team_id = team.id
FROM public.sales_teams team
WHERE team.name = 'Sprzedaż'
  AND employee.sales_team_id IS NULL
  AND employee.is_active = true
  AND (
    employee.role = 'admin'
    OR employee.access_level = 'admin'
    OR 'inquiries_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
    OR 'inquiries_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
  );

UPDATE public.employees
SET is_sales_team_manager = true
WHERE is_active = true
  AND access_level IN ('manager', 'event_manager')
  AND 'tasks_manage' = ANY(COALESCE(permissions, '{}'::text[]));

ALTER TABLE public.sales_teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_teams_select ON public.sales_teams;
CREATE POLICY sales_teams_select
  ON public.sales_teams FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS sales_teams_manage ON public.sales_teams;
CREATE POLICY sales_teams_manage
  ON public.sales_teams FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.id = auth.uid()
        AND employee.is_active = true
        AND (employee.role = 'admin' OR employee.access_level = 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.id = auth.uid()
        AND employee.is_active = true
        AND (employee.role = 'admin' OR employee.access_level = 'admin')
    )
  );

CREATE OR REPLACE FUNCTION public.is_inquiry_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = auth.uid()
      AND employee.is_active = true
      AND (
        employee.role = 'admin'
        OR employee.access_level = 'admin'
        OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.has_inquiry_permission(permission_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.is_inquiry_admin() OR EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = auth.uid()
      AND employee.is_active = true
      AND permission_name = ANY(COALESCE(employee.permissions, '{}'::text[]))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_inquiry(inquiry_owner uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    public.is_inquiry_admin()
    OR public.has_inquiry_permission('inquiries_view_all')
    OR (
      inquiry_owner IS NULL
      AND (
        public.has_inquiry_permission('inquiries_view')
        OR public.has_inquiry_permission('inquiries_manage')
        OR public.has_inquiry_permission('inquiries_view_pool')
      )
    )
    OR (
      inquiry_owner = auth.uid()
      AND (
        public.has_inquiry_permission('inquiries_view')
        OR public.has_inquiry_permission('inquiries_manage')
        OR public.has_inquiry_permission('inquiries_view_own')
        OR public.has_inquiry_permission('inquiries_manage_own')
      )
    )
    OR (
      public.has_inquiry_permission('inquiries_view_team')
      AND EXISTS (
        SELECT 1
        FROM public.employees viewer
        JOIN public.employees owner ON owner.id = inquiry_owner
        WHERE viewer.id = auth.uid()
          AND viewer.is_active = true
          AND owner.is_active = true
          AND viewer.sales_team_id IS NOT NULL
          AND owner.sales_team_id = viewer.sales_team_id
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_inquiry(inquiry_owner uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    public.is_inquiry_admin()
    OR public.has_inquiry_permission('inquiries_manage_all')
    OR (
      inquiry_owner = auth.uid()
      AND (
        public.has_inquiry_permission('inquiries_manage')
        OR public.has_inquiry_permission('inquiries_manage_own')
      )
    )
    OR (
      public.has_inquiry_permission('inquiries_manage_team')
      AND EXISTS (
        SELECT 1
        FROM public.employees viewer
        JOIN public.employees owner ON owner.id = inquiry_owner
        WHERE viewer.id = auth.uid()
          AND viewer.is_active = true
          AND viewer.is_sales_team_manager = true
          AND owner.is_active = true
          AND viewer.sales_team_id IS NOT NULL
          AND owner.sales_team_id = viewer.sales_team_id
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_assign_inquiry_owner(target_owner uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    public.is_inquiry_admin()
    OR (
      public.has_inquiry_permission('inquiries_assign')
      AND (
        target_owner IS NULL
        OR target_owner = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.employees viewer
          JOIN public.employees target ON target.id = target_owner
          WHERE viewer.id = auth.uid()
            AND viewer.is_active = true
            AND target.is_active = true
            AND viewer.sales_team_id IS NOT NULL
            AND target.sales_team_id = viewer.sales_team_id
        )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.is_inquiry_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_inquiry_permission(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_inquiry(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_inquiry(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_assign_inquiry_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_inquiry_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_inquiry_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_inquiry(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_inquiry(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_assign_inquiry_owner(uuid) TO authenticated;

-- PostgreSQL 15 łączy polityki RESTRICTIVE operatorem AND z istniejącymi
-- politykami. Dzięki temu nie zmieniamy reguł zwykłych zadań.
DROP POLICY IF EXISTS inquiry_sales_visibility_guard ON public.tasks;
DROP POLICY IF EXISTS inquiry_sales_select_grant ON public.tasks;
CREATE POLICY inquiry_sales_select_grant
  ON public.tasks FOR SELECT TO authenticated
  USING (
    is_inquiry = true
    AND public.can_view_inquiry(inquiry_owner_id)
  );

CREATE POLICY inquiry_sales_visibility_guard
  ON public.tasks AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    is_inquiry IS DISTINCT FROM true
    OR public.can_view_inquiry(inquiry_owner_id)
  );

DROP POLICY IF EXISTS inquiry_sales_update_guard ON public.tasks;
DROP POLICY IF EXISTS inquiry_sales_update_grant ON public.tasks;
CREATE POLICY inquiry_sales_update_grant
  ON public.tasks FOR UPDATE TO authenticated
  USING (
    is_inquiry = true
    AND public.can_manage_inquiry(inquiry_owner_id)
  )
  WITH CHECK (
    is_inquiry = true
    AND (
      public.can_manage_inquiry(inquiry_owner_id)
      OR public.can_assign_inquiry_owner(inquiry_owner_id)
    )
  );

CREATE POLICY inquiry_sales_update_guard
  ON public.tasks AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    is_inquiry IS DISTINCT FROM true
    OR public.can_manage_inquiry(inquiry_owner_id)
  )
  WITH CHECK (
    is_inquiry IS DISTINCT FROM true
    OR public.can_manage_inquiry(inquiry_owner_id)
    OR public.can_assign_inquiry_owner(inquiry_owner_id)
  );

CREATE OR REPLACE FUNCTION public.inquiry_task_access_allowed(task_identifier uuid, require_manage boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN task.is_inquiry IS DISTINCT FROM true THEN true
      WHEN require_manage THEN public.can_manage_inquiry(task.inquiry_owner_id)
      ELSE public.can_view_inquiry(task.inquiry_owner_id)
    END
    FROM public.tasks task
    WHERE task.id = task_identifier
  ), false);
$$;

REVOKE ALL ON FUNCTION public.inquiry_task_access_allowed(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inquiry_task_access_allowed(uuid, boolean) TO authenticated;

DROP POLICY IF EXISTS inquiry_comments_visibility_guard ON public.task_comments;
DROP POLICY IF EXISTS inquiry_comments_select_grant ON public.task_comments;
CREATE POLICY inquiry_comments_select_grant
  ON public.task_comments FOR SELECT TO authenticated
  USING (public.inquiry_task_access_allowed(task_id, false));

CREATE POLICY inquiry_comments_visibility_guard
  ON public.task_comments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.inquiry_task_access_allowed(task_id, false));

DROP POLICY IF EXISTS inquiry_comments_write_guard ON public.task_comments;
DROP POLICY IF EXISTS inquiry_comments_insert_guard ON public.task_comments;
DROP POLICY IF EXISTS inquiry_comments_update_guard ON public.task_comments;
DROP POLICY IF EXISTS inquiry_comments_delete_guard ON public.task_comments;
DROP POLICY IF EXISTS inquiry_comments_write_grant ON public.task_comments;
CREATE POLICY inquiry_comments_write_grant
  ON public.task_comments FOR ALL TO authenticated
  USING (public.inquiry_task_access_allowed(task_id, true))
  WITH CHECK (public.inquiry_task_access_allowed(task_id, true));

CREATE POLICY inquiry_comments_insert_guard
  ON public.task_comments AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.inquiry_task_access_allowed(task_id, true));

CREATE POLICY inquiry_comments_update_guard
  ON public.task_comments AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.inquiry_task_access_allowed(task_id, true))
  WITH CHECK (public.inquiry_task_access_allowed(task_id, true));

CREATE POLICY inquiry_comments_delete_guard
  ON public.task_comments AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.inquiry_task_access_allowed(task_id, true));

DROP POLICY IF EXISTS inquiry_attachments_visibility_guard ON public.task_attachments;
DROP POLICY IF EXISTS inquiry_attachments_select_grant ON public.task_attachments;
CREATE POLICY inquiry_attachments_select_grant
  ON public.task_attachments FOR SELECT TO authenticated
  USING (public.inquiry_task_access_allowed(task_id, false));

CREATE POLICY inquiry_attachments_visibility_guard
  ON public.task_attachments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.inquiry_task_access_allowed(task_id, false));

DROP POLICY IF EXISTS inquiry_attachments_write_guard ON public.task_attachments;
DROP POLICY IF EXISTS inquiry_attachments_insert_guard ON public.task_attachments;
DROP POLICY IF EXISTS inquiry_attachments_update_guard ON public.task_attachments;
DROP POLICY IF EXISTS inquiry_attachments_delete_guard ON public.task_attachments;
DROP POLICY IF EXISTS inquiry_attachments_write_grant ON public.task_attachments;
CREATE POLICY inquiry_attachments_write_grant
  ON public.task_attachments FOR ALL TO authenticated
  USING (public.inquiry_task_access_allowed(task_id, true))
  WITH CHECK (public.inquiry_task_access_allowed(task_id, true));

CREATE POLICY inquiry_attachments_insert_guard
  ON public.task_attachments AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.inquiry_task_access_allowed(task_id, true));

CREATE POLICY inquiry_attachments_update_guard
  ON public.task_attachments AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.inquiry_task_access_allowed(task_id, true))
  WITH CHECK (public.inquiry_task_access_allowed(task_id, true));

CREATE POLICY inquiry_attachments_delete_guard
  ON public.task_attachments AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.inquiry_task_access_allowed(task_id, true));

CREATE OR REPLACE FUNCTION public.claim_inquiry(p_inquiry_id uuid)
RETURNS TABLE (inquiry_id uuid, owner_id uuid, claimed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_id uuid;
  existing_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Brak aktywnej sesji';
  END IF;

  IF NOT (
    public.is_inquiry_admin()
    OR public.has_inquiry_permission('inquiries_assign')
    OR public.has_inquiry_permission('inquiries_manage')
  ) THEN
    RAISE EXCEPTION 'Brak uprawnienia do przejmowania zapytań';
  END IF;

  UPDATE public.tasks inquiry
  SET inquiry_owner_id = auth.uid(), updated_at = now()
  WHERE inquiry.id = p_inquiry_id
    AND inquiry.is_inquiry = true
    AND inquiry.inquiry_owner_id IS NULL
  RETURNING inquiry.id INTO claimed_id;

  IF claimed_id IS NOT NULL THEN
    RETURN QUERY SELECT claimed_id, auth.uid(), true;
    RETURN;
  END IF;

  SELECT inquiry.inquiry_owner_id
  INTO existing_owner
  FROM public.tasks inquiry
  WHERE inquiry.id = p_inquiry_id
    AND inquiry.is_inquiry = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nie znaleziono zapytania';
  END IF;

  IF existing_owner = auth.uid() THEN
    RETURN QUERY SELECT p_inquiry_id, existing_owner, false;
    RETURN;
  END IF;

  RAISE EXCEPTION 'To zapytanie zostało już przejęte przez inną osobę';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_inquiry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_inquiry(uuid) TO authenticated;

-- Nowe zapytanie ma trafić do kolejki. created_by zachowujemy wyłącznie jako
-- informację audytową; opiekun pojawia się dopiero po przejęciu/przypisaniu.
CREATE OR REPLACE FUNCTION public.normalize_inquiry_pipeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_inquiry IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  NEW.inquiry_stage := COALESCE(NEW.inquiry_stage, 'new');

  IF TG_OP = 'INSERT'
    AND NEW.inquiry_stage = 'new'
    AND NEW.next_action_at IS NULL
  THEN
    NEW.next_action_at := COALESCE(NEW.created_at, now()) + interval '2 hours';
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.inquiry_stage IS NOT DISTINCT FROM OLD.inquiry_stage
    AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.board_column IS DISTINCT FROM OLD.board_column)
  THEN
    NEW.inquiry_stage := CASE
      WHEN NEW.status::text = 'cancelled' THEN 'lost'
      WHEN NEW.status::text = 'completed' OR NEW.board_column = 'completed' THEN 'won'
      WHEN NEW.board_column = 'review' THEN 'qualified'
      WHEN NEW.status::text = 'in_progress' OR NEW.board_column = 'in_progress' THEN 'contacted'
      ELSE 'new'
    END;
  END IF;

  CASE NEW.inquiry_stage
    WHEN 'new' THEN
      NEW.status := 'todo'; NEW.board_column := 'todo';
      NEW.win_probability := COALESCE(NEW.win_probability, 10);
    WHEN 'contacted' THEN
      NEW.status := 'in_progress'; NEW.board_column := 'in_progress';
      NEW.win_probability := COALESCE(NEW.win_probability, 20);
    WHEN 'qualified' THEN
      NEW.status := 'in_progress'; NEW.board_column := 'review';
      NEW.win_probability := COALESCE(NEW.win_probability, 40);
    WHEN 'proposal' THEN
      NEW.status := 'in_progress'; NEW.board_column := 'review';
      NEW.win_probability := COALESCE(NEW.win_probability, 60);
    WHEN 'negotiation' THEN
      NEW.status := 'in_progress'; NEW.board_column := 'review';
      NEW.win_probability := COALESCE(NEW.win_probability, 75);
    WHEN 'won' THEN
      NEW.status := 'completed'; NEW.board_column := 'completed';
      NEW.win_probability := 100; NEW.lost_reason := NULL; NEW.next_action_at := NULL;
    WHEN 'lost' THEN
      IF NULLIF(btrim(NEW.lost_reason), '') IS NULL THEN
        RAISE EXCEPTION 'Powód przegrania zapytania jest wymagany';
      END IF;
      NEW.status := 'cancelled'; NEW.board_column := 'cancelled';
      NEW.win_probability := 0; NEW.next_action_at := NULL;
  END CASE;

  IF NEW.inquiry_stage <> 'lost' THEN
    NEW.lost_reason := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Historia jest widoczna dokładnie dla osób, które mogą zobaczyć zapytanie.
DROP POLICY IF EXISTS inquiry_stage_history_select ON public.inquiry_stage_history;
CREATE POLICY inquiry_stage_history_select
  ON public.inquiry_stage_history FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tasks inquiry
      WHERE inquiry.id = inquiry_stage_history.inquiry_id
        AND public.can_view_inquiry(inquiry.inquiry_owner_id)
    )
  );

COMMENT ON FUNCTION public.claim_inquiry(uuid) IS
  'Atomowo przypisuje nieprzyjęte zapytanie do zalogowanego pracownika.';

CREATE OR REPLACE FUNCTION public.notify_inquiry_owner_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  notification_id uuid;
  notifications_enabled boolean;
BEGIN
  IF NEW.is_inquiry IS DISTINCT FROM true OR NEW.inquiry_owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.inquiry_owner_id IS NOT DISTINCT FROM OLD.inquiry_owner_id THEN
    RETURN NEW;
  END IF;

  -- Samodzielne przejęcie ma natychmiastowy feedback w interfejsie i nie wymaga
  -- dodatkowego bannera do tej samej osoby.
  IF NEW.inquiry_owner_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(settings.inquiry_assignments_enabled, true)
  INTO notifications_enabled
  FROM public.employees employee
  LEFT JOIN public.employee_notification_settings settings
    ON settings.employee_id = employee.id
  WHERE employee.id = NEW.inquiry_owner_id
    AND employee.is_active = true
    AND (
      employee.role = 'admin'
      OR employee.access_level = 'admin'
      OR 'inquiries_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR 'inquiries_view_own' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR 'inquiries_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR 'inquiries_manage_own' = ANY(COALESCE(employee.permissions, '{}'::text[]))
    );

  IF COALESCE(notifications_enabled, false) IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    title, message, type, category, action_url,
    related_entity_type, related_entity_id, metadata, created_at
  ) VALUES (
    'Przypisano Ci zapytanie',
    format('Otrzymujesz odpowiedzialność za „%s”.', NEW.title),
    'info',
    'tasks',
    format('/crm/tasks/%s', NEW.id),
    'task',
    NEW.id::text,
    jsonb_build_object('kind', 'inquiry_assignment', 'inquiry_id', NEW.id),
    now()
  ) RETURNING id INTO notification_id;

  INSERT INTO public.notification_recipients (notification_id, user_id, is_read)
  VALUES (notification_id, NEW.inquiry_owner_id, false)
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Nie udało się wysłać powiadomienia o przypisaniu zapytania: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_inquiry_owner_change_after_write ON public.tasks;
CREATE TRIGGER notify_inquiry_owner_change_after_write
  AFTER INSERT OR UPDATE OF inquiry_owner_id ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_inquiry_owner_change();

REVOKE ALL ON FUNCTION public.notify_inquiry_owner_change() FROM PUBLIC;

COMMENT ON COLUMN public.employees.sales_team_id IS
  'Zespół używany do ograniczania dostępu menedżerów do zapytań sprzedażowych.';
COMMENT ON COLUMN public.employees.is_sales_team_manager IS
  'Pozwala zarządzać zapytaniami pracowników z tego samego zespołu, jeśli nadano inquiries_manage_team.';
