BEGIN;
CREATE OR REPLACE FUNCTION public.personnel_can_report_own_time(p_employee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_employee
    AND e.is_active AND (e.id = auth.uid() OR e.auth_user_id = auth.uid()));
$$;
ALTER POLICY crm_parent_scope_event_id ON public.time_entries
USING (public.personnel_can_report_own_time(employee_id) OR event_id IS NULL OR public.crm_record_id_scope_allows('events', event_id))
WITH CHECK (public.personnel_can_report_own_time(employee_id) OR event_id IS NULL OR public.crm_record_id_scope_allows('events', event_id));

ALTER TABLE public.time_entries_history ADD COLUMN IF NOT EXISTS changed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION public.time_entry_audit_actor() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.employees WHERE id = auth.uid() OR auth_user_id = auth.uid()
  ORDER BY (auth_user_id = auth.uid()) DESC NULLS LAST LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public.log_time_entry_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.time_entries_history(time_entry_id,employee_id,action,new_values,changed_by)
  VALUES(NEW.id,NEW.employee_id,'created',to_jsonb(NEW),public.time_entry_audit_actor());
  RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.log_time_entry_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.time_entries_history(time_entry_id,employee_id,action,old_values,changed_by)
  VALUES(OLD.id,OLD.employee_id,'deleted',to_jsonb(OLD),public.time_entry_audit_actor());
  RETURN OLD;
END; $$;
CREATE OR REPLACE FUNCTION public.log_time_entry_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE fields text[];
BEGIN
  SELECT array_agg(key ORDER BY key) INTO fields FROM jsonb_each(to_jsonb(NEW))
  WHERE key NOT IN ('updated_at','edit_count','duration_minutes') AND value IS DISTINCT FROM to_jsonb(OLD)->key;
  IF cardinality(fields) > 0 THEN
    INSERT INTO public.time_entries_history(time_entry_id,employee_id,action,changed_fields,old_values,new_values,changed_by)
    VALUES(NEW.id,NEW.employee_id,'updated',fields,to_jsonb(OLD),to_jsonb(NEW),public.time_entry_audit_actor());
  END IF;
  RETURN NEW;
END; $$;
DROP POLICY IF EXISTS time_history_authorized_read ON public.time_entries_history;
CREATE POLICY time_history_authorized_read ON public.time_entries_history FOR SELECT TO authenticated
USING (public.personnel_can_report_own_time(employee_id) OR EXISTS (
 SELECT 1 FROM public.employees e WHERE e.is_active AND (e.id=auth.uid() OR e.auth_user_id=auth.uid())
 AND (e.role='admin' OR e.access_level='admin' OR 'admin'=ANY(coalesce(e.permissions,'{}')))
));
CREATE OR REPLACE VIEW public.admin_time_entries_history_view WITH (security_invoker=true) AS
 SELECT h.id,h.time_entry_id,h.employee_id,h.action,h.changed_fields,h.old_values,h.new_values,h.changed_at,
 e.name AS employee_name,e.surname AS employee_surname,e.email AS employee_email,
 te.title AS entry_title,te.start_time AS entry_start_time,te.end_time AS entry_end_time,
 h.changed_by,actor.name AS actor_name,actor.surname AS actor_surname
 FROM public.time_entries_history h JOIN public.employees e ON e.id=h.employee_id
 LEFT JOIN public.time_entries te ON te.id=h.time_entry_id
 LEFT JOIN public.employees actor ON actor.id=h.changed_by
 ORDER BY h.changed_at DESC;
COMMIT;
