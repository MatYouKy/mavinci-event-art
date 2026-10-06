-- Small payload for the team and workflow controls, independent of operational attachments.
CREATE OR REPLACE FUNCTION public.get_event_realization_assignment(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object(
  'realization', CASE WHEN r.event_id IS NULL THEN NULL ELSE to_jsonb(r) END,
  'status',(SELECT s.status FROM public.get_event_operational_states(ARRAY[e.id]) s),
  'is_manager',public.is_realization_manager(e.id),
  'can_manage',public.can_direct_realization(e.id),
  'can_change',r.completed_at IS NULL AND e.status::text NOT IN ('cancelled','completed')
    AND NOT (e.status::text IN ('invoiced','settled') AND coalesce(e.event_end_date<=now(),false))
 ) FROM public.events e LEFT JOIN public.event_realizations r ON r.event_id=e.id
 WHERE e.id=p_event_id AND (public.can_direct_realization(e.id) OR public.is_realization_manager(e.id) OR public.current_employee_can_view_event(e.id));
$$;

CREATE OR REPLACE FUNCTION public.revoke_realization_manager(p_event_id uuid,p_employee_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ev public.events%ROWTYPE; result public.event_realizations%ROWTYPE;
BEGIN
 IF NOT public.can_direct_realization(p_event_id) THEN
  RAISE EXCEPTION 'Tylko autor lub osoba zarządzająca wydarzeniem może odebrać rolę kierownika.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO ev FROM public.events WHERE id=p_event_id FOR UPDATE;
 SELECT * INTO result FROM public.event_realizations WHERE event_id=p_event_id FOR UPDATE;
 IF ev.status::text IN ('cancelled','completed') OR result.completed_at IS NOT NULL
    OR (ev.status::text IN ('invoiced','settled') AND ev.event_end_date<=now()) THEN
  RAISE EXCEPTION 'Nie można zmienić kierownika zakończonej realizacji.' USING ERRCODE='22023';
 END IF;
 -- Idempotent retry; do not revoke a replacement appointed from another session.
 IF result.manager_id IS NULL THEN RETURN to_jsonb(result); END IF;
 IF result.manager_id IS DISTINCT FROM p_employee_id THEN
  RAISE EXCEPTION 'Kierownik został już zmieniony. Odśwież zespół i spróbuj ponownie.' USING ERRCODE='22023';
 END IF;
 UPDATE public.event_realizations SET manager_id=NULL,manager_name=NULL
 WHERE event_id=p_event_id RETURNING * INTO result;
 -- Preserve who started/completed the realization and its operational history.
 RETURN to_jsonb(result);
END $$;
REVOKE ALL ON FUNCTION public.get_event_realization_assignment(uuid), public.revoke_realization_manager(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_realization_assignment(uuid), public.revoke_realization_manager(uuid,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
