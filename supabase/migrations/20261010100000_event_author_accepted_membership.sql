BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.event_assignment_is_author(p_event_id uuid, p_employee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.events e JOIN public.employees employee
    ON e.created_by = employee.id OR e.created_by = employee.auth_user_id
  WHERE e.id = p_event_id AND employee.id = p_employee_id
 );
$$;
REVOKE ALL ON FUNCTION public.event_assignment_is_author(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Keep the existing invitation/response behavior for everyone except the author.
-- Also bypass expiry checks when correcting the author's historical pending row.
DO $migration$
DECLARE definition text; function_name text;
BEGIN
 FOREACH function_name IN ARRAY ARRAY['notify_employee_assignment', 'notify_assignment_response', 'guard_repeated_assignment_response'] LOOP
  definition := pg_get_functiondef(('public.' || function_name || '()')::regprocedure);
  definition := regexp_replace(definition, 'BEGIN', $guard$BEGIN
   IF public.event_assignment_is_author(NEW.event_id, NEW.employee_id) THEN RETURN NEW; END IF;
$guard$);
  -- The existing guard runs as invoker; use a definer to access the private helper.
  IF function_name = 'guard_repeated_assignment_response' THEN
   definition := replace(definition, 'LANGUAGE plpgsql', 'LANGUAGE plpgsql SECURITY DEFINER');
  END IF;
  EXECUTE definition;
 END LOOP;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.enforce_event_author_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF public.event_assignment_is_author(NEW.event_id, NEW.employee_id) THEN
  NEW.status := 'accepted';
  NEW.responded_at := coalesce(NEW.responded_at, now());
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_event_author_membership() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER zz_enforce_event_author_membership
 BEFORE INSERT OR UPDATE ON public.employee_assignments
 FOR EACH ROW EXECUTE FUNCTION public.enforce_event_author_membership();

CREATE OR REPLACE FUNCTION public.add_event_author_to_team()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE author_id uuid;
BEGIN
 SELECT employee.id INTO author_id FROM public.employees employee
 WHERE NEW.created_by = employee.id OR NEW.created_by = employee.auth_user_id
 ORDER BY (employee.auth_user_id = NEW.created_by) DESC NULLS LAST, employee.id LIMIT 1;
 IF author_id IS NOT NULL THEN
  INSERT INTO public.employee_assignments(event_id, employee_id, role, status, responded_at)
  VALUES (NEW.id, author_id, 'Autor/Koordynator', 'accepted', now())
  ON CONFLICT(event_id, employee_id) DO NOTHING;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.add_event_author_to_team() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER add_event_author_to_team
 AFTER INSERT ON public.events
 FOR EACH ROW EXECUTE FUNCTION public.add_event_author_to_team();

-- Repair authors awaiting a response without generating an acceptance notification.
UPDATE public.employee_assignments assignment
 SET status = 'accepted', responded_at = coalesce(assignment.responded_at, now())
 WHERE (assignment.status IS NULL OR assignment.status = 'pending')
 AND public.event_assignment_is_author(assignment.event_id, assignment.employee_id);

-- Fill missing author memberships, including events converted from inquiries.
INSERT INTO public.employee_assignments(event_id, employee_id, role, status, responded_at)
 SELECT event.id, author.id, 'Autor/Koordynator', 'accepted', now()
 FROM public.events event
 CROSS JOIN LATERAL (
  SELECT employee.id FROM public.employees employee
  WHERE event.created_by = employee.id OR event.created_by = employee.auth_user_id
  ORDER BY (employee.auth_user_id = event.created_by) DESC NULLS LAST, employee.id LIMIT 1
 ) author
 WHERE NOT EXISTS (SELECT 1 FROM public.employee_assignments a WHERE a.event_id = event.id AND a.employee_id = author.id)
 ON CONFLICT(event_id, employee_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;
