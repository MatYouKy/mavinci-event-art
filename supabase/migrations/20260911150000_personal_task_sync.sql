BEGIN;
-- Only the authenticated bridge resolves the employee from a personal feed token.
-- Check assignment again in the same transaction as the status change; admin is no exception.
CREATE OR REPLACE FUNCTION public.set_personal_synced_task_completion(
  p_employee_id uuid, p_task_id uuid, p_completed boolean, p_expected_updated_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_task public.tasks%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Brak uprawnień.' USING ERRCODE='42501';
  END IF;
  IF p_completed IS NULL THEN RETURN false; END IF;
  PERFORM id FROM public.employees WHERE id=p_employee_id AND is_active=true FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM task_id FROM public.task_assignees
    WHERE employee_id=p_employee_id AND task_id=p_task_id FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_task FROM public.tasks WHERE id=p_task_id
    AND is_private=false AND is_inquiry=false AND event_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF COALESCE(v_task.status::text IN ('completed','cancelled'),false)
      OR COALESCE(v_task.board_column::text='completed',false) THEN
    IF p_completed THEN RETURN true; END IF;
  ELSIF NOT p_completed THEN RETURN true;
  END IF;
  IF v_task.status::text='cancelled' OR p_expected_updated_at IS NULL
    OR v_task.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN false; END IF;
  IF p_completed THEN
    v_task.status:='completed'; v_task.board_column:='completed';
  ELSE
    v_task.status:='todo'; v_task.board_column:='todo';
  END IF;
  UPDATE public.tasks SET status=v_task.status,board_column=v_task.board_column,updated_at=now()
    WHERE id=p_task_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.set_personal_synced_task_completion(uuid,uuid,boolean,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_personal_synced_task_completion(uuid,uuid,boolean,timestamptz) TO service_role;
COMMIT;
