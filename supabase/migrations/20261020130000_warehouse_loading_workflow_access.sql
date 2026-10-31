BEGIN;
-- Loading is shared warehouse work, not acceptance of responsibility for preparation.
DO $migration$
DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('public.set_event_equipment_loaded(uuid,boolean)'::regprocedure);
 needle:='coalesce(public.can_prepare_warehouse_event(v_event.id),false)';
 IF position(needle in definition)=0 THEN RAISE EXCEPTION 'Nieznana wersja funkcji załadunku'; END IF;
 EXECUTE replace(definition,needle,'coalesce(public.can_receive_warehouse_event(v_event.id),false)');

 definition:=pg_get_functiondef('public.refresh_event_workflow_after_related_change()'::regprocedure);
 needle:=' IF related_event_id IS NOT NULL AND EXISTS';
 IF position(needle in definition)=0 THEN RAISE EXCEPTION 'Nieznana wersja synchronizacji procesu'; END IF;
 definition:=replace(definition,needle,$patch$
 -- Allow only a loading-state update by an active warehouse worker within company scope.
 -- The public workflow-management function keeps its existing authorization.
 IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='event_equipment' AND TG_OP='UPDATE' THEN
  own_response:=auth.uid() IS NOT NULL
   AND (to_jsonb(NEW)-ARRAY['is_loaded','loaded_at','loaded_by','updated_at'])
       = (to_jsonb(OLD)-ARRAY['is_loaded','loaded_at','loaded_by','updated_at'])
   AND coalesce(public.can_receive_warehouse_event(NEW.event_id),false)
   AND EXISTS(SELECT 1 FROM public.employees e WHERE e.id=public.current_employee_id() AND e.is_active);
 END IF;
 IF related_event_id IS NOT NULL AND EXISTS$patch$);
 EXECUTE definition;
END; $migration$;
COMMIT;
