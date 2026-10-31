-- Reuse CRM recipients and the existing native push dispatch queue.
CREATE OR REPLACE FUNCTION public.notify_time_entry_discussion_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE entry public.time_entries%ROWTYPE; nid uuid; first_message boolean;
BEGIN
 SELECT e.* INTO STRICT entry FROM public.time_entries e
 JOIN public.time_entry_threads t ON t.time_entry_id=e.id WHERE t.id=NEW.thread_id;
 SELECT count(*)=1 INTO first_message FROM public.time_entry_thread_messages WHERE thread_id=NEW.thread_id;
 INSERT INTO public.notifications(category,title,message,type,related_entity_type,related_entity_id,action_url,metadata)
 VALUES('employee', CASE WHEN first_message THEN 'Czas pracy — nowy wątek do wyjaśnienia' ELSE 'Czas pracy — nowa odpowiedź' END,
 format('%s: %s (%s)', NEW.author_name, coalesce(entry.title,'Wpis czasu pracy'), to_char(entry.start_time AT TIME ZONE 'Europe/Warsaw','DD.MM.YYYY')),
 'info','time_entry',entry.id::text,
 '/crm/time-tracking/'||entry.employee_id||'?discussion='||entry.id,
 jsonb_build_object('time_entry_id',entry.id,'thread_id',NEW.thread_id,'message_id',NEW.id)) RETURNING id INTO nid;
 INSERT INTO public.notification_recipients(notification_id,user_id)
 SELECT nid,e.id FROM public.employees e WHERE e.is_active AND e.id<>NEW.author_id AND (
 e.id=entry.employee_id OR ((e.access_level='admin' OR e.role='admin') AND EXISTS (
 SELECT 1 FROM public.time_entry_thread_messages m WHERE m.thread_id=NEW.thread_id AND m.author_id=e.id)))
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_time_entry_discussion_message() FROM PUBLIC;
CREATE TRIGGER notify_time_entry_discussion_message AFTER INSERT ON public.time_entry_thread_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_time_entry_discussion_message();
