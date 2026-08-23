/*
  # Normalize wedding people and schedule

  Witnesses, parents and the couple are first-class records instead of text
  embedded in wedding_card_answers. The schedule is an ordered collection so
  both CRM and Event Rulers can render and edit the same timeline.
*/

CREATE TABLE IF NOT EXISTS public.wedding_card_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_card_id uuid NOT NULL REFERENCES public.wedding_cards(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('bride', 'groom', 'shared')),
  role text NOT NULL CHECK (role IN (
    'bride', 'groom', 'witness', 'mother', 'father', 'guardian', 'other'
  )),
  first_name text NOT NULL,
  last_name text,
  phone text,
  email text,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'crm' CHECK (source IN ('crm', 'event_rulers')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wedding_schedule_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_card_id uuid NOT NULL REFERENCES public.wedding_cards(id) ON DELETE CASCADE,
  title text NOT NULL,
  scheduled_at timestamptz,
  category text NOT NULL DEFAULT 'other' CHECK (category IN (
    'preparation', 'ceremony', 'arrival', 'meal', 'first_dance', 'cake',
    'parents_thanks', 'oczepiny', 'attraction', 'ending', 'other'
  )),
  location text,
  responsible_person text,
  notes text,
  is_confirmed boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'crm' CHECK (source IN ('crm', 'event_rulers')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wedding_card_people_card_side
  ON public.wedding_card_people(wedding_card_id, side, sort_order);
CREATE INDEX IF NOT EXISTS idx_wedding_schedule_card_time
  ON public.wedding_schedule_items(wedding_card_id, scheduled_at, sort_order);

DROP TRIGGER IF EXISTS update_wedding_card_people_updated_at ON public.wedding_card_people;
CREATE TRIGGER update_wedding_card_people_updated_at
  BEFORE UPDATE ON public.wedding_card_people
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_wedding_schedule_items_updated_at ON public.wedding_schedule_items;
CREATE TRIGGER update_wedding_schedule_items_updated_at
  BEFORE UPDATE ON public.wedding_schedule_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.wedding_card_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_schedule_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees view accessible wedding people" ON public.wedding_card_people;
CREATE POLICY "Employees view accessible wedding people"
  ON public.wedding_card_people FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.wedding_cards wc
    JOIN public.events e ON e.id = wc.event_id
    WHERE wc.id = wedding_card_id
  ));

DROP POLICY IF EXISTS "Employees manage permitted wedding people" ON public.wedding_card_people;
CREATE POLICY "Employees manage permitted wedding people"
  ON public.wedding_card_people FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.wedding_cards wc
    WHERE wc.id = wedding_card_id
      AND public.can_user_edit_event(wc.event_id, auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.wedding_cards wc
    WHERE wc.id = wedding_card_id
      AND public.can_user_edit_event(wc.event_id, auth.uid())
  ));

DROP POLICY IF EXISTS "Employees view accessible wedding schedule" ON public.wedding_schedule_items;
CREATE POLICY "Employees view accessible wedding schedule"
  ON public.wedding_schedule_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.wedding_cards wc
    JOIN public.events e ON e.id = wc.event_id
    WHERE wc.id = wedding_card_id
  ));

DROP POLICY IF EXISTS "Employees manage permitted wedding schedule" ON public.wedding_schedule_items;
CREATE POLICY "Employees manage permitted wedding schedule"
  ON public.wedding_schedule_items FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.wedding_cards wc
    WHERE wc.id = wedding_card_id
      AND public.can_user_edit_event(wc.event_id, auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.wedding_cards wc
    WHERE wc.id = wedding_card_id
      AND public.can_user_edit_event(wc.event_id, auth.uid())
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wedding_card_people TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wedding_schedule_items TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wedding_card_people'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wedding_card_people;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wedding_schedule_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wedding_schedule_items;
  END IF;
END $$;

COMMENT ON TABLE public.wedding_card_people IS
  'Individual people associated with each side of a wedding.';
COMMENT ON TABLE public.wedding_schedule_items IS
  'Canonical ordered wedding-day schedule shared by CRM and Event Rulers.';
