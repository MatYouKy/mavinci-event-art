/*
  # Repair public analytics duration reporting

  Page views are inserted anonymously, but public UPDATE access is intentionally disabled.
  This narrow function lets a browser update only the row it has just created, using both
  the unguessable row id and the current session id.
*/

CREATE OR REPLACE FUNCTION public.update_page_analytics_duration(
  p_id uuid,
  p_session_id text,
  p_time_on_page integer
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE page_analytics
  SET time_on_page = GREATEST(
    COALESCE(time_on_page, 0),
    LEAST(GREATEST(p_time_on_page, 0), 86400)
  )
  WHERE id = p_id
    AND session_id = p_session_id;
$$;

REVOKE ALL ON FUNCTION public.update_page_analytics_duration(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_page_analytics_duration(uuid, text, integer) TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_contact_messages_source_page_created_at
  ON public.contact_messages(source_page, created_at DESC);
