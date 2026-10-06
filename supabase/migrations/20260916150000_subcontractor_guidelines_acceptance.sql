BEGIN;
ALTER TABLE public.subcontractor_tasks
  ADD COLUMN IF NOT EXISTS guidelines_sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guidelines_snapshot jsonb;

CREATE OR REPLACE FUNCTION public.reset_changed_subcontractor_guidelines()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF ROW(NEW.task_name,NEW.description,NEW.scope_of_work,NEW.deliverables,NEW.guidelines,
    NEW.scheduled_start,NEW.scheduled_end,NEW.subcontractor_id,NEW.contact_email_snapshot,NEW.event_id)
    IS DISTINCT FROM ROW(OLD.task_name,OLD.description,OLD.scope_of_work,OLD.deliverables,OLD.guidelines,
    OLD.scheduled_start,OLD.scheduled_end,OLD.subcontractor_id,OLD.contact_email_snapshot,OLD.event_id)
    OR (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    NEW.guidelines_status := 'draft';
    NEW.confirmation_token_hash := NULL;
    NEW.confirmation_expires_at := NULL;
    NEW.confirmed_at := NULL;
    NEW.declined_at := NULL;
    NEW.confirmed_by_name := NULL;
    NEW.response_note := NULL;
    NEW.guidelines_sent_at := NULL;
    NEW.guidelines_sent_by := NULL;
    NEW.guidelines_snapshot := NULL;
    NEW.reminder_week_sent_at := NULL;
    NEW.reminder_day_sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reset_changed_subcontractor_guidelines ON public.subcontractor_tasks;
CREATE TRIGGER reset_changed_subcontractor_guidelines BEFORE UPDATE ON public.subcontractor_tasks
FOR EACH ROW EXECUTE FUNCTION public.reset_changed_subcontractor_guidelines();

CREATE OR REPLACE FUNCTION public.notify_subcontractor_guidelines_response()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE notice_id uuid;
BEGIN
  IF OLD.guidelines_status IS DISTINCT FROM 'sent' OR NEW.guidelines_status NOT IN ('confirmed','declined')
    OR NEW.guidelines_sent_by IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.notifications(title,message,type,category,action_url,related_entity_type,related_entity_id,metadata)
  VALUES(CASE WHEN NEW.guidelines_status='confirmed' THEN 'Podwykonawca zaakceptował wytyczne' ELSE 'Podwykonawca zgłosił problem z wytycznymi' END,
    concat_ws(' · ',NEW.task_name,NEW.confirmed_by_name,NEW.response_note),'info','event',
    '/crm/events/'||NEW.event_id::text||'?tab=subcontractors','event',NEW.event_id,
    jsonb_build_object('subcontractor_task_id',NEW.id,'status',NEW.guidelines_status,
      'confirmed_by_name',NEW.confirmed_by_name,'responded_at',coalesce(NEW.confirmed_at,NEW.declined_at),
      'guidelines_sent_at',NEW.guidelines_sent_at,'guidelines_snapshot',NEW.guidelines_snapshot)) RETURNING id INTO notice_id;
  INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
    VALUES(notice_id,NEW.guidelines_sent_by,false);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_subcontractor_guidelines_response() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS notify_subcontractor_guidelines_response ON public.subcontractor_tasks;
CREATE TRIGGER notify_subcontractor_guidelines_response AFTER UPDATE OF guidelines_status ON public.subcontractor_tasks
FOR EACH ROW EXECUTE FUNCTION public.notify_subcontractor_guidelines_response();
COMMIT;
