/*
  # Wedding cards as the canonical wedding-planning record

  The CRM remains the source of truth. Couples never authenticate against this
  project; Event Rulers will access a single wedding card through a server-side
  integration authenticated as a webhook source.
*/

CREATE TABLE IF NOT EXISTS public.wedding_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'submitted', 'approved', 'changes_requested')),
  progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  last_portal_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wedding_card_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_card_id uuid NOT NULL REFERENCES public.wedding_cards(id) ON DELETE CASCADE,
  section text NOT NULL,
  field_key text NOT NULL,
  value jsonb NOT NULL DEFAULT 'null'::jsonb,
  source text NOT NULL DEFAULT 'crm' CHECK (source IN ('crm', 'event_rulers')),
  updated_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wedding_card_id, field_key)
);

CREATE TABLE IF NOT EXISTS public.wedding_music_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_card_id uuid NOT NULL REFERENCES public.wedding_cards(id) ON DELETE CASCADE,
  list_type text NOT NULL CHECK (list_type IN ('play', 'do_not_play', 'special')),
  title text NOT NULL,
  artist text,
  url text,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'crm' CHECK (source IN ('crm', 'event_rulers')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wedding_attraction_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_card_id uuid NOT NULL REFERENCES public.wedding_cards(id) ON DELETE CASCADE,
  attraction_id uuid,
  attraction_key text NOT NULL,
  attraction_name text NOT NULL,
  choice text NOT NULL DEFAULT 'undecided'
    CHECK (choice IN ('undecided', 'interested', 'selected', 'rejected')),
  notes text,
  source text NOT NULL DEFAULT 'crm' CHECK (source IN ('crm', 'event_rulers')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wedding_card_id, attraction_key)
);

CREATE INDEX IF NOT EXISTS idx_wedding_card_answers_card_section
  ON public.wedding_card_answers(wedding_card_id, section);
CREATE INDEX IF NOT EXISTS idx_wedding_music_tracks_card_type
  ON public.wedding_music_tracks(wedding_card_id, list_type, sort_order);
CREATE INDEX IF NOT EXISTS idx_wedding_attraction_choices_card_choice
  ON public.wedding_attraction_choices(wedding_card_id, choice);

DROP TRIGGER IF EXISTS update_wedding_cards_updated_at ON public.wedding_cards;
CREATE TRIGGER update_wedding_cards_updated_at
  BEFORE UPDATE ON public.wedding_cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_wedding_card_answers_updated_at ON public.wedding_card_answers;
CREATE TRIGGER update_wedding_card_answers_updated_at
  BEFORE UPDATE ON public.wedding_card_answers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_wedding_music_tracks_updated_at ON public.wedding_music_tracks;
CREATE TRIGGER update_wedding_music_tracks_updated_at
  BEFORE UPDATE ON public.wedding_music_tracks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_wedding_attraction_choices_updated_at ON public.wedding_attraction_choices;
CREATE TRIGGER update_wedding_attraction_choices_updated_at
  BEFORE UPDATE ON public.wedding_attraction_choices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.wedding_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_card_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_music_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_attraction_choices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees can view accessible wedding cards" ON public.wedding_cards;
CREATE POLICY "Employees can view accessible wedding cards"
  ON public.wedding_cards FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id));

DROP POLICY IF EXISTS "Employees can manage permitted wedding cards" ON public.wedding_cards;
CREATE POLICY "Employees can manage permitted wedding cards"
  ON public.wedding_cards FOR ALL TO authenticated
  USING (public.can_user_edit_event(event_id, auth.uid()))
  WITH CHECK (public.can_user_edit_event(event_id, auth.uid()));

DROP POLICY IF EXISTS "Employees can view accessible wedding answers" ON public.wedding_card_answers;
CREATE POLICY "Employees can view accessible wedding answers"
  ON public.wedding_card_answers FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.wedding_cards wc
    JOIN public.events e ON e.id = wc.event_id
    WHERE wc.id = wedding_card_id
  ));

DROP POLICY IF EXISTS "Employees can manage permitted wedding answers" ON public.wedding_card_answers;
CREATE POLICY "Employees can manage permitted wedding answers"
  ON public.wedding_card_answers FOR ALL TO authenticated
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

DROP POLICY IF EXISTS "Employees can view accessible wedding music" ON public.wedding_music_tracks;
CREATE POLICY "Employees can view accessible wedding music"
  ON public.wedding_music_tracks FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.wedding_cards wc
    JOIN public.events e ON e.id = wc.event_id
    WHERE wc.id = wedding_card_id
  ));

DROP POLICY IF EXISTS "Employees can manage permitted wedding music" ON public.wedding_music_tracks;
CREATE POLICY "Employees can manage permitted wedding music"
  ON public.wedding_music_tracks FOR ALL TO authenticated
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

DROP POLICY IF EXISTS "Employees can view accessible wedding attractions" ON public.wedding_attraction_choices;
CREATE POLICY "Employees can view accessible wedding attractions"
  ON public.wedding_attraction_choices FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.wedding_cards wc
    JOIN public.events e ON e.id = wc.event_id
    WHERE wc.id = wedding_card_id
  ));

DROP POLICY IF EXISTS "Employees can manage permitted wedding attractions" ON public.wedding_attraction_choices;
CREATE POLICY "Employees can manage permitted wedding attractions"
  ON public.wedding_attraction_choices FOR ALL TO authenticated
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wedding_cards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wedding_card_answers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wedding_music_tracks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wedding_attraction_choices TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wedding_cards'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wedding_cards;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wedding_card_answers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wedding_card_answers;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wedding_music_tracks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wedding_music_tracks;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wedding_attraction_choices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wedding_attraction_choices;
  END IF;
END $$;

COMMENT ON TABLE public.wedding_cards IS
  'Canonical CRM wedding card. Couple access is mediated only by the Event Rulers server integration.';
