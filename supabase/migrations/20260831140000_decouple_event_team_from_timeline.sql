/*
  # Niezależny zespół wydarzenia i timeline

  Pracownik może należeć do zespołu wydarzenia bez gotowego harmonogramu.
  Jeżeli zostanie przypisany bezpośrednio do etapu timeline, baza automatycznie
  zapewnia również jego członkostwo w zespole wydarzenia.
*/

CREATE OR REPLACE FUNCTION public.ensure_event_team_member_for_phase_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_event_id uuid;
  default_access_level_id uuid;
BEGIN
  SELECT phase.event_id
  INTO target_event_id
  FROM public.event_phases phase
  WHERE phase.id = NEW.phase_id;

  IF target_event_id IS NULL OR NEW.employee_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT level.id
  INTO default_access_level_id
  FROM public.access_levels level
  WHERE level.slug = 'employee'
  LIMIT 1;

  INSERT INTO public.employee_assignments (
    event_id,
    employee_id,
    role,
    responsibilities,
    access_level_id
  )
  VALUES (
    target_event_id,
    NEW.employee_id,
    COALESCE(NEW.role, ''),
    'Dodano automatycznie podczas planowania timeline',
    default_access_level_id
  )
  ON CONFLICT (event_id, employee_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_event_team_member_from_timeline
  ON public.event_phase_assignments;

CREATE TRIGGER ensure_event_team_member_from_timeline
  AFTER INSERT OR UPDATE OF phase_id, employee_id
  ON public.event_phase_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_event_team_member_for_phase_assignment();

COMMENT ON FUNCTION public.ensure_event_team_member_for_phase_assignment() IS
  'Zapewnia członkostwo w zespole wydarzenia przy bezpośrednim przypisaniu pracownika do timeline.';
