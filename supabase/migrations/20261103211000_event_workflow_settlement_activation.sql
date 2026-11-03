BEGIN;
SET LOCAL lock_timeout='5s';
-- A missed preparation checkbox must not postpone final invoicing after realization.
-- Preserve the earlier invoice rule: first day after the event ends, never before.
DO $$ DECLARE definition text; needle text; BEGIN
 definition:=pg_get_functiondef('private.event_workflow_next_action(uuid)'::regprocedure);
 needle:=$old$IF ev.status::text='completed' AND NOT coalesce(req.post_event,false) THEN CONTINUE; END IF;$old$;
 IF position(needle in definition)=0 THEN RAISE EXCEPTION 'Nieznana wersja kolejki działań'; END IF;
 definition:=replace(definition,needle,$new$IF (ev.status::text='completed' OR
   (now() AT TIME ZONE 'Europe/Warsaw')::date > (coalesce(ev.event_end_date,ev.event_date) AT TIME ZONE 'Europe/Warsaw')::date)
   AND NOT coalesce(req.post_event,false) THEN CONTINUE; END IF;$new$);
 needle:=$old$starts_at:=ev.event_date+make_interval(days=>coalesce(req.due_offset_days,-1));$old$;
 IF position(needle in definition)=0 THEN RAISE EXCEPTION 'Nieznana wersja terminu kontroli gotowości'; END IF;
 definition:=replace(definition,needle,$new$starts_at:=ev.event_date+make_interval(days=>coalesce(req.due_offset_days,-1))-interval '2 days';$new$);
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
