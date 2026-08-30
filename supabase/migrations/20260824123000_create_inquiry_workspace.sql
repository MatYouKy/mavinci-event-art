/*
  # Prywatny obszar pracy zapytania

  Zapytanie nadal zachowuje dotychczasowy identyfikator w tasks (kompatybilność
  z lejkiem i automatyzacjami), ale zwykłe zadania, oferty i kalkulacje mogą być
  od teraz jego niezależnymi powiązaniami. Po konwersji dokumenty są przepinane
  do wydarzenia bez utraty historii sprzedaży.
*/

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS inquiry_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_inquiry_actions
  ON public.tasks (inquiry_id, created_at DESC)
  WHERE inquiry_id IS NOT NULL;

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS inquiry_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_offers_inquiry
  ON public.offers (inquiry_id, created_at DESC)
  WHERE inquiry_id IS NOT NULL;

ALTER TABLE public.event_calculations
  ALTER COLUMN event_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS inquiry_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_calculations_inquiry
  ON public.event_calculations (inquiry_id, created_at DESC)
  WHERE inquiry_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_calculations_context_check'
      AND conrelid = 'public.event_calculations'::regclass
  ) THEN
    ALTER TABLE public.event_calculations
      ADD CONSTRAINT event_calculations_context_check
      CHECK (event_id IS NOT NULL OR inquiry_id IS NOT NULL);
  END IF;
END $$;

-- Dodatkowe polityki są celowo PERMISSIVE. Dostęp do zapytania jest nadal
-- ograniczany przez RLS tabeli tasks; nie otwieramy kalkulacji całej firmie.
DROP POLICY IF EXISTS "inquiry_calculations_select" ON public.event_calculations;
CREATE POLICY "inquiry_calculations_select"
  ON public.event_calculations FOR SELECT TO authenticated
  USING (
    inquiry_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tasks inquiry
      WHERE inquiry.id = event_calculations.inquiry_id
        AND inquiry.is_inquiry = true
        AND public.can_view_inquiry(inquiry.inquiry_owner_id)
    )
  );

DROP POLICY IF EXISTS "inquiry_calculations_insert" ON public.event_calculations;
CREATE POLICY "inquiry_calculations_insert"
  ON public.event_calculations FOR INSERT TO authenticated
  WITH CHECK (
    inquiry_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tasks inquiry
      WHERE inquiry.id = event_calculations.inquiry_id
        AND inquiry.is_inquiry = true
        AND public.can_manage_inquiry(inquiry.inquiry_owner_id)
    )
  );

DROP POLICY IF EXISTS "inquiry_calculations_update" ON public.event_calculations;
CREATE POLICY "inquiry_calculations_update"
  ON public.event_calculations FOR UPDATE TO authenticated
  USING (
    inquiry_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tasks inquiry
      WHERE inquiry.id = event_calculations.inquiry_id
        AND inquiry.is_inquiry = true
        AND public.can_manage_inquiry(inquiry.inquiry_owner_id)
    )
  )
  WITH CHECK (
    inquiry_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tasks inquiry
      WHERE inquiry.id = event_calculations.inquiry_id
        AND inquiry.is_inquiry = true
        AND public.can_manage_inquiry(inquiry.inquiry_owner_id)
    )
  );

DROP POLICY IF EXISTS "inquiry_calculations_delete" ON public.event_calculations;
CREATE POLICY "inquiry_calculations_delete"
  ON public.event_calculations FOR DELETE TO authenticated
  USING (
    inquiry_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tasks inquiry
      WHERE inquiry.id = event_calculations.inquiry_id
        AND inquiry.is_inquiry = true
        AND public.can_manage_inquiry(inquiry.inquiry_owner_id)
    )
  );

DROP POLICY IF EXISTS "inquiry_calculation_items_select" ON public.event_calculation_items;
CREATE POLICY "inquiry_calculation_items_select"
  ON public.event_calculation_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_calculations calculation
      JOIN public.tasks inquiry ON inquiry.id = calculation.inquiry_id
      WHERE calculation.id = event_calculation_items.calculation_id
        AND inquiry.is_inquiry = true
        AND public.can_view_inquiry(inquiry.inquiry_owner_id)
    )
  );

-- Istniejące polityki pozycji kalkulacji pozwalają pisać do każdej widocznej
-- kalkulacji. Dla zapytań dokładamy więc strażnika: sam podgląd nie daje prawa
-- do zmiany kosztorysu. Kalkulacje już przepięte do eventu zachowują reguły eventu.
DROP POLICY IF EXISTS "inquiry_calculation_items_insert_guard" ON public.event_calculation_items;
CREATE POLICY "inquiry_calculation_items_insert_guard"
  ON public.event_calculation_items AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.event_calculations calculation
      LEFT JOIN public.tasks inquiry ON inquiry.id = calculation.inquiry_id
      WHERE calculation.id = event_calculation_items.calculation_id
        AND (
          calculation.inquiry_id IS NULL
          OR calculation.event_id IS NOT NULL
          OR public.can_manage_inquiry(inquiry.inquiry_owner_id)
        )
    )
  );

DROP POLICY IF EXISTS "inquiry_calculation_items_update_guard" ON public.event_calculation_items;
CREATE POLICY "inquiry_calculation_items_update_guard"
  ON public.event_calculation_items AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_calculations calculation
      LEFT JOIN public.tasks inquiry ON inquiry.id = calculation.inquiry_id
      WHERE calculation.id = event_calculation_items.calculation_id
        AND (
          calculation.inquiry_id IS NULL
          OR calculation.event_id IS NOT NULL
          OR public.can_manage_inquiry(inquiry.inquiry_owner_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.event_calculations calculation
      LEFT JOIN public.tasks inquiry ON inquiry.id = calculation.inquiry_id
      WHERE calculation.id = event_calculation_items.calculation_id
        AND (
          calculation.inquiry_id IS NULL
          OR calculation.event_id IS NOT NULL
          OR public.can_manage_inquiry(inquiry.inquiry_owner_id)
        )
    )
  );

DROP POLICY IF EXISTS "inquiry_calculation_items_delete_guard" ON public.event_calculation_items;
CREATE POLICY "inquiry_calculation_items_delete_guard"
  ON public.event_calculation_items AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_calculations calculation
      LEFT JOIN public.tasks inquiry ON inquiry.id = calculation.inquiry_id
      WHERE calculation.id = event_calculation_items.calculation_id
        AND (
          calculation.inquiry_id IS NULL
          OR calculation.event_id IS NOT NULL
          OR public.can_manage_inquiry(inquiry.inquiry_owner_id)
        )
    )
  );

CREATE OR REPLACE FUNCTION public.convert_inquiry_to_event(
  p_inquiry_id uuid,
  p_event_name text DEFAULT NULL,
  p_event_date timestamptz DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_my_company_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  inquiry public.tasks%ROWTYPE;
  created_event_id uuid;
  resolved_event_date timestamptz;
BEGIN
  SELECT * INTO inquiry
  FROM public.tasks
  WHERE id = p_inquiry_id
    AND is_inquiry = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zapytanie nie istnieje lub nie masz do niego dostępu';
  END IF;

  IF inquiry.event_id IS NOT NULL THEN
    RETURN inquiry.event_id;
  END IF;

  resolved_event_date := COALESCE(
    p_event_date,
    NULLIF(inquiry.inquiry_details ->> 'termin', '')::timestamptz,
    inquiry.due_date
  );

  IF resolved_event_date IS NULL THEN
    RAISE EXCEPTION 'Przed konwersją uzupełnij termin wydarzenia';
  END IF;

  INSERT INTO public.events (
    name, description, event_date, location, status, budget,
    organization_id, contact_person_id, category_id, my_company_id, created_by
  ) VALUES (
    COALESCE(NULLIF(btrim(p_event_name), ''), regexp_replace(inquiry.title, '^Zapytanie:\\s*', '', 'i')),
    COALESCE(inquiry.inquiry_details ->> 'source_message_content', inquiry.description),
    resolved_event_date,
    inquiry.inquiry_details ->> 'location_text',
    'inquiry',
    inquiry.estimated_value,
    inquiry.organization_id,
    inquiry.contact_id,
    p_category_id,
    p_my_company_id,
    auth.uid()
  )
  RETURNING id INTO created_event_id;

  UPDATE public.tasks
  SET event_id = created_event_id,
      inquiry_stage = 'won',
      next_action_at = NULL,
      updated_at = now()
  WHERE id = inquiry.id;

  UPDATE public.tasks
  SET event_id = created_event_id
  WHERE inquiry_id = inquiry.id
    AND event_id IS NULL;

  UPDATE public.offers
  SET event_id = created_event_id
  WHERE inquiry_id = inquiry.id
    AND event_id IS NULL;

  UPDATE public.event_calculations
  SET event_id = created_event_id
  WHERE inquiry_id = inquiry.id
    AND event_id IS NULL;

  RETURN created_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_inquiry_to_event(uuid, text, timestamptz, uuid, uuid)
  TO authenticated;

COMMENT ON COLUMN public.tasks.inquiry_id IS 'Zapytanie sprzedażowe, którego dotyczy zwykłe zadanie.';
COMMENT ON COLUMN public.offers.inquiry_id IS 'Zapytanie źródłowe oferty, zachowane również po konwersji do eventu.';
COMMENT ON COLUMN public.event_calculations.inquiry_id IS 'Zapytanie źródłowe kalkulacji, zachowane również po konwersji do eventu.';
