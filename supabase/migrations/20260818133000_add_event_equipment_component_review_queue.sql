CREATE TABLE IF NOT EXISTS public.event_equipment_component_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES public.equipment_items(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'skipped', 'not_applicable')),
  reviewed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, equipment_id)
);

ALTER TABLE public.event_equipment_component_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_manage_equipment_component_reviews"
  ON public.event_equipment_component_reviews;
DROP POLICY IF EXISTS "view_equipment_component_reviews"
  ON public.event_equipment_component_reviews;
DROP POLICY IF EXISTS "manage_equipment_component_reviews"
  ON public.event_equipment_component_reviews;

CREATE POLICY "view_equipment_component_reviews"
  ON public.event_equipment_component_reviews
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.id = auth.uid()
        AND (
          employee.role = 'admin'
          OR 'admin' = ANY(employee.permissions)
          OR 'events_manage' = ANY(employee.permissions)
          OR 'calendar_view' = ANY(employee.permissions)
        )
    )
  );

CREATE POLICY "manage_equipment_component_reviews"
  ON public.event_equipment_component_reviews
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.id = auth.uid()
        AND (
          employee.role = 'admin'
          OR 'admin' = ANY(employee.permissions)
          OR 'events_manage' = ANY(employee.permissions)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees employee
      WHERE employee.id = auth.uid()
        AND (
          employee.role = 'admin'
          OR 'admin' = ANY(employee.permissions)
          OR 'events_manage' = ANY(employee.permissions)
        )
    )
  );

CREATE OR REPLACE FUNCTION public.queue_event_equipment_component_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.equipment_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.equipment_compatible_items eci
    WHERE eci.equipment_id = NEW.equipment_id
      AND eci.compatibility_type IN ('required', 'recommended')
  ) THEN
    INSERT INTO public.event_equipment_component_reviews (
      event_id,
      equipment_id,
      source,
      status,
      reviewed_at,
      updated_at
    )
    VALUES (
      NEW.event_id,
      NEW.equipment_id,
      CASE WHEN NEW.offer_id IS NULL THEN 'manual' ELSE 'import' END,
      'pending',
      NULL,
      now()
    )
    ON CONFLICT (event_id, equipment_id) DO UPDATE
    SET source = EXCLUDED.source,
        status = 'pending',
        reviewed_by = NULL,
        reviewed_at = NULL,
        updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS queue_event_equipment_component_review_trigger
  ON public.event_equipment;
CREATE TRIGGER queue_event_equipment_component_review_trigger
AFTER INSERT ON public.event_equipment
FOR EACH ROW
EXECUTE FUNCTION public.queue_event_equipment_component_review();

INSERT INTO public.event_equipment_component_reviews (event_id, equipment_id, source)
SELECT DISTINCT
  ee.event_id,
  ee.equipment_id,
  CASE WHEN ee.offer_id IS NULL THEN 'manual' ELSE 'import' END
FROM public.event_equipment ee
WHERE ee.equipment_id IS NOT NULL
  AND COALESCE(ee.quantity, 0) > 0
  AND EXISTS (
    SELECT 1
    FROM public.equipment_compatible_items eci
    WHERE eci.equipment_id = ee.equipment_id
      AND eci.compatibility_type IN ('required', 'recommended')
  )
ON CONFLICT (event_id, equipment_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_event_equipment_component_reviews_pending
  ON public.event_equipment_component_reviews (event_id, created_at)
  WHERE status = 'pending';
