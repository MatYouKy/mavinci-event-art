ALTER TABLE public.event_equipment_component_reviews
  ADD COLUMN IF NOT EXISTS dismissed_component_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

COMMENT ON COLUMN public.event_equipment_component_reviews.dismissed_component_ids IS
  'Rekomendacje świadomie odrzucone dla danego sprzętu w konkretnym wydarzeniu.';
