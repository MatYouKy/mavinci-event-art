-- Conversation membership is resolved on read, so future replies join automatically.
-- Everything runs as the caller: both inquiry and mailbox RLS remain in force.
BEGIN;
CREATE TABLE public.inquiry_email_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  received_email_id uuid REFERENCES public.received_emails(id) ON DELETE CASCADE,
  sent_email_id uuid REFERENCES public.sent_emails(id) ON DELETE CASCADE,
  include_thread boolean NOT NULL DEFAULT true,
  excluded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(received_email_id, sent_email_id) = 1)
);
CREATE UNIQUE INDEX inquiry_email_received ON public.inquiry_email_links(inquiry_id, received_email_id) WHERE received_email_id IS NOT NULL;
CREATE UNIQUE INDEX inquiry_email_sent ON public.inquiry_email_links(inquiry_id, sent_email_id) WHERE sent_email_id IS NOT NULL;
ALTER TABLE public.inquiry_email_links ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inquiry_email_links TO authenticated;
CREATE POLICY inquiry_email_read ON public.inquiry_email_links FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.tasks t WHERE t.id=inquiry_id AND t.is_inquiry)
  AND (EXISTS (SELECT 1 FROM public.received_emails e WHERE e.id=received_email_id)
    OR EXISTS (SELECT 1 FROM public.sent_emails e WHERE e.id=sent_email_id))
);
CREATE POLICY inquiry_email_write ON public.inquiry_email_links FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.tasks t WHERE t.id=inquiry_id AND t.is_inquiry AND public.can_manage_inquiry(t.inquiry_owner_id))
  AND (EXISTS (SELECT 1 FROM public.received_emails e WHERE e.id=received_email_id)
    OR EXISTS (SELECT 1 FROM public.sent_emails e WHERE e.id=sent_email_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.tasks t WHERE t.id=inquiry_id AND t.is_inquiry AND public.can_manage_inquiry(t.inquiry_owner_id))
  AND (EXISTS (SELECT 1 FROM public.received_emails e WHERE e.id=received_email_id)
    OR EXISTS (SELECT 1 FROM public.sent_emails e WHERE e.id=sent_email_id))
);

CREATE FUNCTION public.crm_email_reference_ids(value text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce(array_agg(DISTINCT token) FILTER (WHERE token LIKE '%@%'), '{}'::text[])
 FROM regexp_split_to_table(coalesce(value,''), '[[:space:]<>,"\[\]]+') token;
$$;

CREATE VIEW public.inquiry_email_index WITH (security_invoker=true) AS
 SELECT 'received'::text AS type, e.id, e.email_account_id,
   btrim(e.message_id, '<> ') AS message_id, e.subject,
   public.normalize_email_sales_subject(e.subject) AS topic,
   public.extract_email_address(e.from_address) AS participant,
   e.from_address, e.to_address, e.received_date AS message_at,
   public.crm_email_reference_ids((SELECT string_agg(h.value::text, ' ') FROM jsonb_each(
     CASE WHEN jsonb_typeof(e.raw_headers)='object' THEN e.raw_headers ELSE '{}'::jsonb END
   ) h WHERE lower(h.key) IN ('in-reply-to','references'))) AS reference_ids,
   coalesce(nullif(e.body_text,''), regexp_replace(coalesce(e.body_html,''), '<[^>]*>', ' ', 'g')) AS body
 FROM public.received_emails e WHERE e.deleted_at IS NULL
 UNION ALL
 SELECT 'sent', e.id, e.email_account_id, btrim(e.message_id, '<> '), e.subject,
   public.normalize_email_sales_subject(e.subject), public.extract_email_address(e.to_address),
   coalesce(a.email_address,''), e.to_address, coalesce(e.sent_at,e.created_at),
   public.crm_email_reference_ids(coalesce(e.in_reply_to,'') || ' ' || array_to_string(e.email_references,' ')),
   regexp_replace(e.body, '<[^>]*>', ' ', 'g')
 FROM public.sent_emails e LEFT JOIN public.employee_email_accounts a ON a.id=e.email_account_id
 WHERE e.deleted_at IS NULL AND coalesce(to_jsonb(e)->>'status','sent') IN ('sent','delivered');
GRANT SELECT ON public.inquiry_email_index TO authenticated;

CREATE FUNCTION public.get_email_conversation(p_type text, p_id uuid, p_thread boolean DEFAULT true)
RETURNS SETOF public.inquiry_email_index LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH RECURSIVE seed AS MATERIALIZED (
   SELECT * FROM public.inquiry_email_index WHERE type=p_type AND id=p_id
 ), mail AS MATERIALIZED (
   SELECT m.* FROM public.inquiry_email_index m JOIN seed s ON m.email_account_id=s.email_account_id OR (m.type=s.type AND m.id=s.id)
 ), members(type,id) AS (
   SELECT m.type,m.id FROM mail m CROSS JOIN seed s
   WHERE (m.type=s.type AND m.id=s.id)
     OR (p_thread AND length(s.topic)>2 AND m.topic=s.topic AND s.participant LIKE '%@%' AND m.participant=s.participant)
   UNION
   SELECT m.type,m.id FROM members found
   JOIN mail parent ON parent.type=found.type AND parent.id=found.id
   JOIN mail m ON p_thread AND (
     (nullif(m.message_id,'') IS NOT NULL AND m.message_id=ANY(parent.reference_ids))
     OR (nullif(parent.message_id,'') IS NOT NULL AND parent.message_id=ANY(m.reference_ids))
     OR m.reference_ids && parent.reference_ids
     OR (nullif(parent.message_id,'') IS NOT NULL AND m.message_id=parent.message_id)
   )
 ) SELECT m.* FROM members f JOIN mail m ON m.type=f.type AND m.id=f.id ORDER BY m.message_at,m.id;
$$;

CREATE FUNCTION public.get_inquiry_correspondence(p_inquiry_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE details jsonb; source_id uuid; source_type text; result jsonb;
BEGIN
 SELECT t.inquiry_details INTO details FROM public.tasks t WHERE t.id=p_inquiry_id AND t.is_inquiry;
 IF NOT FOUND THEN RAISE EXCEPTION 'Brak dostępu do zapytania'; END IF;
 source_type := CASE WHEN details ? 'received_email_id' THEN 'received' ELSE details->>'source_message_type' END;
 IF coalesce(details->>'received_email_id',details->>'source_message_id','') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
   source_id := coalesce(details->>'received_email_id',details->>'source_message_id')::uuid;
 END IF;
 WITH seeds AS (
   SELECT CASE WHEN l.received_email_id IS NOT NULL THEN 'received' ELSE 'sent' END type,
     coalesce(l.received_email_id,l.sent_email_id) id, l.include_thread
   FROM public.inquiry_email_links l WHERE l.inquiry_id=p_inquiry_id
   UNION ALL
   SELECT source_type, source_id, true WHERE source_type IN ('received','sent') AND source_id IS NOT NULL
     AND NOT EXISTS(SELECT 1 FROM public.inquiry_email_links l WHERE l.inquiry_id=p_inquiry_id
       AND coalesce(l.received_email_id,l.sent_email_id)=source_id)
 ), messages AS (
   SELECT DISTINCT m.* FROM seeds s CROSS JOIN LATERAL public.get_email_conversation(s.type,s.id,s.include_thread) m
   WHERE NOT EXISTS(SELECT 1 FROM public.inquiry_email_links l WHERE l.inquiry_id=p_inquiry_id AND l.excluded
     AND ((m.type='received' AND l.received_email_id=m.id) OR (m.type='sent' AND l.sent_email_id=m.id)))
 ) SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.message_at,m.id),'[]'::jsonb) INTO result FROM messages m;
 RETURN jsonb_build_object('messages',result,'links',coalesce((
   SELECT jsonb_agg(jsonb_build_object('type',CASE WHEN l.received_email_id IS NOT NULL THEN 'received' ELSE 'sent' END,
     'id',coalesce(l.received_email_id,l.sent_email_id),'include_thread',l.include_thread,'excluded',l.excluded))
   FROM public.inquiry_email_links l WHERE l.inquiry_id=p_inquiry_id
 ),'[]'::jsonb));
END;
$$;

CREATE FUNCTION public.link_inquiry_email(p_inquiry_id uuid,p_type text,p_id uuid,p_thread boolean DEFAULT true,p_excluded boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_inquiry_id AND t.is_inquiry AND public.can_manage_inquiry(t.inquiry_owner_id))
   OR NOT EXISTS(SELECT 1 FROM public.inquiry_email_index m WHERE m.type=p_type AND m.id=p_id)
 THEN RAISE EXCEPTION 'Brak dostępu do zapytania lub wiadomości'; END IF;
 IF p_type='received' THEN
   INSERT INTO public.inquiry_email_links(inquiry_id,received_email_id,include_thread,excluded)
   VALUES(p_inquiry_id,p_id,p_thread,p_excluded)
   ON CONFLICT(inquiry_id,received_email_id) WHERE received_email_id IS NOT NULL
   DO UPDATE SET include_thread=CASE WHEN excluded.excluded THEN inquiry_email_links.include_thread ELSE excluded.include_thread END,excluded=excluded.excluded;
 ELSIF p_type='sent' THEN
   INSERT INTO public.inquiry_email_links(inquiry_id,sent_email_id,include_thread,excluded)
   VALUES(p_inquiry_id,p_id,p_thread,p_excluded)
   ON CONFLICT(inquiry_id,sent_email_id) WHERE sent_email_id IS NOT NULL
   DO UPDATE SET include_thread=CASE WHEN excluded.excluded THEN inquiry_email_links.include_thread ELSE excluded.include_thread END,excluded=excluded.excluded;
 ELSE RAISE EXCEPTION 'Nieprawidłowy typ wiadomości'; END IF;
END;
$$;
CREATE FUNCTION public.get_email_conversation_preview(p_type text,p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('type',m.type,'id',m.id,'subject',m.subject,'message_at',m.message_at) ORDER BY m.message_at,m.id),'[]'::jsonb)
 FROM public.get_email_conversation(p_type,p_id,true) m;
$$;
REVOKE ALL ON FUNCTION public.get_email_conversation_preview(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_conversation_preview(text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_email_conversation(text,uuid,boolean),public.get_inquiry_correspondence(uuid),public.link_inquiry_email(uuid,text,uuid,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_conversation(text,uuid,boolean),public.get_inquiry_correspondence(uuid),public.link_inquiry_email(uuid,text,uuid,boolean,boolean) TO authenticated;
COMMIT;
