/*
  # Lejek sprzedaży dla zapytań

  Rozszerza istniejące zadania oznaczone is_inquiry bez duplikowania danych.
  Każda zmiana etapu jest zapisywana w historii i synchronizowana ze statusem zadania.
*/

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS inquiry_stage text,
  ADD COLUMN IF NOT EXISTS inquiry_owner_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS next_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_contact_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_value numeric(12, 2),
  ADD COLUMN IF NOT EXISTS win_probability smallint,
  ADD COLUMN IF NOT EXISTS lost_reason text,
  ADD COLUMN IF NOT EXISTS linked_offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
  ALTER COLUMN inquiry_stage DROP DEFAULT,
  ALTER COLUMN win_probability DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_inquiry_stage_check'
      AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_inquiry_stage_check
      CHECK (inquiry_stage IN ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_win_probability_check'
      AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_win_probability_check
      CHECK (win_probability BETWEEN 0 AND 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_lost_reason_required_check'
      AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_lost_reason_required_check
      CHECK (
        inquiry_stage <> 'lost'
        OR NULLIF(btrim(lost_reason), '') IS NOT NULL
      );
  END IF;
END $$;

UPDATE public.tasks
SET
  inquiry_stage = CASE
    WHEN status::text = 'cancelled' THEN 'lost'
    WHEN status::text = 'completed' OR board_column = 'completed' THEN 'won'
    WHEN status::text = 'in_progress' OR board_column = 'in_progress' THEN 'contacted'
    WHEN board_column = 'review' THEN 'qualified'
    ELSE COALESCE(inquiry_stage, 'new')
  END,
  inquiry_owner_id = COALESCE(inquiry_owner_id, created_by),
  next_action_at = CASE
    WHEN status::text IN ('completed', 'cancelled') OR board_column = 'completed' THEN NULL
    ELSE COALESCE(next_action_at, created_at + interval '2 hours')
  END,
  lost_reason = CASE
    WHEN status::text = 'cancelled'
      THEN COALESCE(NULLIF(btrim(lost_reason), ''), 'Zamknięte przed wdrożeniem lejka')
    ELSE lost_reason
  END,
  win_probability = CASE
    WHEN status::text = 'cancelled' THEN 0
    WHEN status::text = 'completed' OR board_column = 'completed' THEN 100
    ELSE COALESCE(win_probability, 10)
  END
WHERE is_inquiry = true;

CREATE INDEX IF NOT EXISTS idx_tasks_inquiry_stage
  ON public.tasks (inquiry_stage, created_at DESC)
  WHERE is_inquiry = true;

CREATE INDEX IF NOT EXISTS idx_tasks_inquiry_owner
  ON public.tasks (inquiry_owner_id, inquiry_stage)
  WHERE is_inquiry = true;

CREATE INDEX IF NOT EXISTS idx_tasks_inquiry_next_action
  ON public.tasks (next_action_at)
  WHERE is_inquiry = true
    AND inquiry_stage NOT IN ('won', 'lost');

CREATE TABLE IF NOT EXISTS public.inquiry_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  from_stage text,
  to_stage text NOT NULL,
  changed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inquiry_stage_history_from_check
    CHECK (from_stage IS NULL OR from_stage IN ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
  CONSTRAINT inquiry_stage_history_to_check
    CHECK (to_stage IN ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'))
);

CREATE INDEX IF NOT EXISTS idx_inquiry_stage_history_inquiry_created
  ON public.inquiry_stage_history (inquiry_id, created_at DESC);

INSERT INTO public.inquiry_stage_history (
  inquiry_id,
  from_stage,
  to_stage,
  changed_by,
  reason,
  metadata,
  created_at
)
SELECT
  task.id,
  NULL,
  task.inquiry_stage,
  task.inquiry_owner_id,
  CASE WHEN task.inquiry_stage = 'lost' THEN task.lost_reason ELSE 'Stan początkowy lejka' END,
  jsonb_strip_nulls(jsonb_build_object(
    'estimated_value', task.estimated_value,
    'win_probability', task.win_probability,
    'next_action_at', task.next_action_at,
    'migration_baseline', true
  )),
  COALESCE(task.updated_at, task.created_at, now())
FROM public.tasks task
WHERE task.is_inquiry = true
  AND task.inquiry_stage IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.inquiry_stage_history history
    WHERE history.inquiry_id = task.id
  );

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
  NEW.inquiry_owner_id := COALESCE(NEW.inquiry_owner_id, NEW.created_by);

  IF TG_OP = 'INSERT'
    AND NEW.inquiry_stage = 'new'
    AND NEW.next_action_at IS NULL
  THEN
    NEW.next_action_at := COALESCE(NEW.created_at, now()) + interval '2 hours';
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.inquiry_stage IS NOT DISTINCT FROM OLD.inquiry_stage
    AND (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.board_column IS DISTINCT FROM OLD.board_column
    )
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
      NEW.status := 'todo';
      NEW.board_column := 'todo';
      NEW.win_probability := COALESCE(NEW.win_probability, 10);
    WHEN 'contacted' THEN
      NEW.status := 'in_progress';
      NEW.board_column := 'in_progress';
      NEW.win_probability := COALESCE(NEW.win_probability, 20);
    WHEN 'qualified' THEN
      NEW.status := 'in_progress';
      NEW.board_column := 'review';
      NEW.win_probability := COALESCE(NEW.win_probability, 40);
    WHEN 'proposal' THEN
      NEW.status := 'in_progress';
      NEW.board_column := 'review';
      NEW.win_probability := COALESCE(NEW.win_probability, 60);
    WHEN 'negotiation' THEN
      NEW.status := 'in_progress';
      NEW.board_column := 'review';
      NEW.win_probability := COALESCE(NEW.win_probability, 75);
    WHEN 'won' THEN
      NEW.status := 'completed';
      NEW.board_column := 'completed';
      NEW.win_probability := 100;
      NEW.lost_reason := NULL;
      NEW.next_action_at := NULL;
    WHEN 'lost' THEN
      IF NULLIF(btrim(NEW.lost_reason), '') IS NULL THEN
        RAISE EXCEPTION 'Powód przegrania zapytania jest wymagany';
      END IF;
      NEW.status := 'cancelled';
      NEW.board_column := 'cancelled';
      NEW.win_probability := 0;
      NEW.next_action_at := NULL;
  END CASE;

  IF NEW.inquiry_stage <> 'lost' THEN
    NEW.lost_reason := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_normalize_inquiry_pipeline ON public.tasks;
CREATE TRIGGER trigger_normalize_inquiry_pipeline
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_inquiry_pipeline();

CREATE OR REPLACE FUNCTION public.log_inquiry_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_inquiry IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.inquiry_stage IS NOT DISTINCT FROM OLD.inquiry_stage
  THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.inquiry_stage_history (
      inquiry_id,
      from_stage,
      to_stage,
      changed_by,
      reason,
      metadata
    ) VALUES (
      NEW.id,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.inquiry_stage ELSE NULL END,
      NEW.inquiry_stage,
      COALESCE(auth.uid(), NEW.inquiry_owner_id, NEW.created_by),
      CASE WHEN NEW.inquiry_stage = 'lost' THEN NEW.lost_reason ELSE NULL END,
      jsonb_strip_nulls(jsonb_build_object(
        'estimated_value', NEW.estimated_value,
        'win_probability', NEW.win_probability,
        'next_action_at', NEW.next_action_at,
        'linked_offer_id', NEW.linked_offer_id,
        'event_id', NEW.event_id
      ))
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_log_inquiry_stage_change ON public.tasks;
CREATE TRIGGER trigger_log_inquiry_stage_change
  AFTER INSERT OR UPDATE OF inquiry_stage ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.log_inquiry_stage_change();

CREATE OR REPLACE FUNCTION public.sync_inquiry_from_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.event_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.tasks inquiry
  SET
    linked_offer_id = NEW.id,
    estimated_value = COALESCE(
      inquiry.estimated_value,
      NULLIF(to_jsonb(NEW) ->> 'total_final_price', '')::numeric,
      NULLIF(to_jsonb(NEW) ->> 'total_amount', '')::numeric
    ),
    inquiry_stage = CASE
      WHEN NEW.status = 'accepted' THEN 'won'
      WHEN NEW.status = 'sent'
        AND inquiry.inquiry_stage IN ('new', 'contacted', 'qualified')
        THEN 'proposal'
      ELSE inquiry.inquiry_stage
    END,
    last_contact_at = CASE
      WHEN NEW.status = 'sent' THEN COALESCE(
        NULLIF(to_jsonb(NEW) ->> 'sent_at', '')::timestamptz,
        now()
      )
      ELSE inquiry.last_contact_at
    END
  WHERE inquiry.is_inquiry = true
    AND inquiry.event_id = NEW.event_id
    AND inquiry.inquiry_stage <> 'lost';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_inquiry_from_offer ON public.offers;
CREATE TRIGGER trigger_sync_inquiry_from_offer
  AFTER INSERT OR UPDATE OF status, event_id, total_amount
  ON public.offers
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_inquiry_from_offer();

ALTER TABLE public.inquiry_stage_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inquiry_stage_history_select ON public.inquiry_stage_history;
CREATE POLICY inquiry_stage_history_select
  ON public.inquiry_stage_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = auth.uid()
        AND employee.is_active = true
        AND (
          employee.role = 'admin'
          OR employee.access_level = 'admin'
          OR 'tasks_view' = ANY(employee.permissions)
          OR 'tasks_manage' = ANY(employee.permissions)
        )
    )
  );

DROP POLICY IF EXISTS inquiry_stage_history_insert ON public.inquiry_stage_history;
CREATE POLICY inquiry_stage_history_insert
  ON public.inquiry_stage_history
  FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS inquiry_stage_history_update ON public.inquiry_stage_history;
CREATE POLICY inquiry_stage_history_update
  ON public.inquiry_stage_history
  FOR UPDATE TO authenticated
  USING (false);

DROP POLICY IF EXISTS inquiry_stage_history_delete ON public.inquiry_stage_history;
CREATE POLICY inquiry_stage_history_delete
  ON public.inquiry_stage_history
  FOR DELETE TO authenticated
  USING (false);

COMMENT ON TABLE public.inquiry_stage_history IS
  'Niemodyfikowalna historia przejść zapytań przez etapy sprzedaży.';

COMMENT ON COLUMN public.tasks.inquiry_stage IS
  'Etap lejka sprzedażowego dla rekordów oznaczonych is_inquiry.';
