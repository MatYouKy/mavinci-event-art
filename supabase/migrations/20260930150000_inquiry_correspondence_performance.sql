BEGIN;
-- Resolve the thread using headers only. Rendering every body in the mailbox
-- before selecting members can exceed the authenticated API statement timeout.
CREATE OR REPLACE FUNCTION public.get_email_conversation(p_type text, p_id uuid, p_thread boolean DEFAULT true)
RETURNS SETOF public.inquiry_email_index
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT p_thread THEN
   RETURN QUERY SELECT m.* FROM public.inquiry_email_index m WHERE m.type=p_type AND m.id=p_id;
   RETURN;
 END IF;
 RETURN QUERY
 WITH RECURSIVE seed AS MATERIALIZED (
   SELECT m.type,m.id,m.email_account_id,m.message_id,m.topic,m.participant,m.reference_ids
   FROM public.inquiry_email_index m WHERE m.type=p_type AND m.id=p_id
 ), mail AS MATERIALIZED (
   SELECT m.type,m.id,m.message_id,m.topic,m.participant,m.reference_ids
   FROM public.inquiry_email_index m JOIN seed s ON m.email_account_id=s.email_account_id
   UNION ALL
   SELECT s.type,s.id,s.message_id,s.topic,s.participant,s.reference_ids FROM seed s WHERE s.email_account_id IS NULL
 ), members(type,id) AS (
   SELECT m.type,m.id FROM mail m CROSS JOIN seed s
   WHERE (m.type=s.type AND m.id=s.id)
     OR (length(s.topic)>2 AND m.topic=s.topic AND s.participant LIKE '%@%' AND m.participant=s.participant)
   UNION
   SELECT m.type,m.id FROM members found
   JOIN mail parent ON parent.type=found.type AND parent.id=found.id
   JOIN mail m ON (
     (nullif(m.message_id,'') IS NOT NULL AND m.message_id=ANY(parent.reference_ids))
     OR (nullif(parent.message_id,'') IS NOT NULL AND parent.message_id=ANY(m.reference_ids))
     OR m.reference_ids && parent.reference_ids
     OR (nullif(parent.message_id,'') IS NOT NULL AND m.message_id=parent.message_id)
   )
 ) SELECT m.* FROM members f JOIN public.inquiry_email_index m ON m.type=f.type AND m.id=f.id
 ORDER BY m.message_at,m.id;
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
