-- Discussion is independent of the time entry's accounting fields.
CREATE TABLE public.time_entry_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  time_entry_id uuid NOT NULL UNIQUE REFERENCES public.time_entries(id) ON DELETE CASCADE,
  resolved boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.time_entry_thread_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.time_entry_threads(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.employees(id),
  author_name text NOT NULL,
  body text NOT NULL CHECK (length(trim(body)) > 0 AND length(body) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_entry_thread_messages_order ON public.time_entry_thread_messages(thread_id, created_at, id);
ALTER TABLE public.time_entry_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entry_thread_messages ENABLE ROW LEVEL SECURITY;
-- Access only through scoped RPCs; messages cannot be changed or deleted by clients.
REVOKE ALL ON public.time_entry_threads, public.time_entry_thread_messages FROM anon, authenticated;

CREATE FUNCTION public.time_discussion_actor() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT id FROM public.employees WHERE is_active AND (id=auth.uid() OR auth_user_id=auth.uid())
 ORDER BY (auth_user_id=auth.uid()) DESC NULLS LAST LIMIT 1
$$;
CREATE FUNCTION public.time_discussion_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT coalesce((SELECT access_level='admin' OR role='admin' FROM public.employees WHERE id=public.time_discussion_actor()), false)
$$;

CREATE FUNCTION public.list_time_entry_discussions(p_entry uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT coalesce(jsonb_agg(item ORDER BY updated_at DESC), '[]'::jsonb) FROM (
 SELECT t.updated_at, jsonb_build_object(
   'id', t.id, 'time_entry_id', e.id, 'resolved', t.resolved, 'updated_at', t.updated_at,
   'title', coalesce(e.title, 'Praca'), 'description', e.description, 'start_time', e.start_time,
   'duration_minutes', e.duration_minutes, 'employee_name', concat_ws(' ', owner.name, owner.surname),
   'messages', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'author_name', m.author_name,
     'body', m.body, 'created_at', m.created_at) ORDER BY m.created_at, m.id)
     FROM public.time_entry_thread_messages m WHERE m.thread_id=t.id), '[]'::jsonb)
 ) AS item
 FROM public.time_entry_threads t JOIN public.time_entries e ON e.id=t.time_entry_id
 JOIN public.employees owner ON owner.id=e.employee_id
 WHERE public.time_discussion_actor() IS NOT NULL
   AND (public.time_discussion_admin() OR e.employee_id=public.time_discussion_actor())
   AND (p_entry IS NULL OR e.id=p_entry)
 ) scoped
$$;

CREATE FUNCTION public.post_time_entry_discussion(p_entry uuid, p_body text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid := public.time_discussion_actor(); owner_id uuid; thread public.time_entry_threads%ROWTYPE;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Brak dostępu'; END IF;
 IF p_body IS NULL OR length(trim(p_body))=0 OR length(p_body)>4000 THEN RAISE EXCEPTION 'Wpisz wiadomość (maksymalnie 4000 znaków)'; END IF;
 SELECT employee_id INTO owner_id FROM public.time_entries WHERE id=p_entry FOR UPDATE;
 IF NOT FOUND OR NOT (public.time_discussion_admin() OR owner_id=actor) THEN RAISE EXCEPTION 'Brak dostępu do wpisu'; END IF;
 SELECT * INTO thread FROM public.time_entry_threads WHERE time_entry_id=p_entry FOR UPDATE;
 IF NOT FOUND THEN
   IF NOT public.time_discussion_admin() THEN RAISE EXCEPTION 'Wątek rozpoczyna administrator'; END IF;
   INSERT INTO public.time_entry_threads(time_entry_id) VALUES(p_entry) RETURNING * INTO thread;
 END IF;
 IF thread.resolved THEN RAISE EXCEPTION 'Wątek jest zamknięty. Administrator może go ponownie otworzyć.'; END IF;
 INSERT INTO public.time_entry_thread_messages(thread_id, author_id, author_name, body)
 SELECT thread.id, actor, concat_ws(' ', name, surname), p_body FROM public.employees WHERE id=actor;
 UPDATE public.time_entry_threads SET updated_at=clock_timestamp() WHERE id=thread.id;
 RETURN thread.id;
END $$;

CREATE FUNCTION public.resolve_time_entry_discussion(p_entry uuid, p_resolved boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF NOT public.time_discussion_admin() THEN RAISE EXCEPTION 'Tylko administrator może zmienić status wątku'; END IF;
 PERFORM 1 FROM public.time_entries WHERE id=p_entry FOR UPDATE;
 UPDATE public.time_entry_threads SET resolved=p_resolved, updated_at=clock_timestamp() WHERE time_entry_id=p_entry;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono wątku'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.time_discussion_actor(), public.time_discussion_admin(), public.list_time_entry_discussions(uuid), public.post_time_entry_discussion(uuid,text), public.resolve_time_entry_discussion(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_time_entry_discussions(uuid), public.post_time_entry_discussion(uuid,text), public.resolve_time_entry_discussion(uuid,boolean) TO authenticated;
