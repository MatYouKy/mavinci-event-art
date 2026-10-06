CREATE OR REPLACE FUNCTION public.assign_warehouse_preparer_to_team()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.accepted_by IS NULL OR NEW.accepted_at IS NULL THEN RETURN NEW; END IF;
 INSERT INTO public.employee_assignments(event_id,employee_id,status,role,responsibilities,responded_at)
 VALUES(NEW.event_id,NEW.accepted_by,'accepted','Przygotowanie magazynu','Odpowiedzialność za przygotowanie wydarzenia w magazynie.',NEW.accepted_at)
 ON CONFLICT(event_id,employee_id) DO UPDATE SET
 status='accepted', responded_at=coalesce(employee_assignments.responded_at,excluded.responded_at),
 role=coalesce(nullif(employee_assignments.role,''),excluded.role),
 responsibilities=CASE WHEN coalesce(employee_assignments.responsibilities,'') LIKE '%Odpowiedzialność za przygotowanie wydarzenia w magazynie.%'
 THEN employee_assignments.responsibilities ELSE concat_ws(E'\n',nullif(employee_assignments.responsibilities,''),excluded.responsibilities) END;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.assign_warehouse_preparer_to_team() FROM PUBLIC;
CREATE TRIGGER assign_warehouse_preparer_to_team AFTER INSERT OR UPDATE OF accepted_at,accepted_by ON public.event_warehouse_handoffs
 FOR EACH ROW EXECUTE FUNCTION public.assign_warehouse_preparer_to_team();
-- Warehouse acceptance already has its own single notification to the author.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.notify_assignment_response()'::regprocedure);
 definition:=regexp_replace(definition,'BEGIN', $guard$BEGIN
 IF pg_trigger_depth()>1 AND NEW.status='accepted' AND EXISTS(
 SELECT 1 FROM public.event_warehouse_handoffs h WHERE h.event_id=NEW.event_id AND h.accepted_by=NEW.employee_id AND h.accepted_at IS NOT NULL
 ) THEN RETURN NEW; END IF;
 $guard$);
 EXECUTE definition;
END $$;
-- The acceptance trigger may synchronize workflow tasks for its own warehouse member.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.refresh_event_workflow_after_related_change()'::regprocedure);
 definition:=replace(definition,' IF related_event_id IS NOT NULL', $guard$
 IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='employee_assignments' AND TG_OP IN ('INSERT','UPDATE') AND pg_trigger_depth()>1 THEN
  own_response:=own_response OR (
   NEW.status='accepted' AND NEW.employee_id=public.sales_employee_id()
   AND public.can_receive_warehouse_event(NEW.event_id)
   AND EXISTS(SELECT 1 FROM public.event_warehouse_handoffs h WHERE h.event_id=NEW.event_id AND h.accepted_by=NEW.employee_id AND h.accepted_at IS NOT NULL)
  );
 END IF;
 IF related_event_id IS NOT NULL$guard$);
 EXECUTE definition;
END $$;
-- Previously accepted handoffs: add only missing memberships, without new invitations.
INSERT INTO public.employee_assignments(event_id,employee_id,status,role,responsibilities,responded_at)
SELECT h.event_id,h.accepted_by,'accepted','Przygotowanie magazynu','Odpowiedzialność za przygotowanie wydarzenia w magazynie.',h.accepted_at
FROM public.event_warehouse_handoffs h JOIN public.employees e ON e.id=h.accepted_by
WHERE h.accepted_at IS NOT NULL ON CONFLICT(event_id,employee_id) DO NOTHING;
