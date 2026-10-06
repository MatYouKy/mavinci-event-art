BEGIN;
LOCK TABLE public.event_phase_types IN SHARE ROW EXCLUSIVE MODE;
-- Retain old IDs for already scheduled phases; only retire duplicate choices.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
  ) AS position
  FROM public.event_phase_types WHERE is_active = true
)
UPDATE public.event_phase_types t SET is_active = false
FROM ranked r WHERE t.id = r.id AND r.position > 1;
CREATE UNIQUE INDEX IF NOT EXISTS event_phase_types_unique_active_name
ON public.event_phase_types (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')))
WHERE is_active = true;
COMMIT;
