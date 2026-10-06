BEGIN;

-- Return the revision through the existing authorized inbox function. Keep its
-- access checks and grants, and keep the sidebar SECURITY INVOKER and its RLS.
-- No table privileges are added and no SECURITY DEFINER scope is expanded.
DO $migration$
DECLARE
  definition text;
  old_fragment text;
BEGIN
  SELECT pg_get_functiondef('public.get_seller_inbox()'::regprocedure) INTO definition;
  IF position(' AS read_token' in definition)=0 THEN
    old_fragment := 'NULL::uuid AS recipient_id,NULL::uuid AS conversation_id,o.id AS offer_id';
    IF position(old_fragment in definition)=0 THEN RAISE EXCEPTION 'Unsupported inbox review projection'; END IF;
    definition := replace(definition,old_fragment,old_fragment||$fragment$,
     r.document_id,md5(r.document_id::text||'|'||extract(epoch FROM r.requested_at)::text||'|'||COALESCE(r.source_key,'')) AS read_token$fragment$);

    old_fragment := 'END,NULL::uuid,c.id,c.offer_id';
    IF position(old_fragment in definition)=0 THEN RAISE EXCEPTION 'Unsupported inbox chat projection'; END IF;
    definition := replace(definition,old_fragment,old_fragment||',NULL::uuid,NULL::text');

    old_fragment := 'n.action_url,nr.id,NULL::uuid,o.id';
    IF position(old_fragment in definition)=0 THEN RAISE EXCEPTION 'Unsupported inbox notification projection'; END IF;
    definition := replace(definition,old_fragment,old_fragment||',NULL::uuid,NULL::text');
    EXECUTE definition;
  END IF;

  SELECT pg_get_functiondef('public.get_seller_sidebar_badge()'::regprocedure) INTO definition;
  IF position('LEFT JOIN public.seller_offer_reviews r' in definition)>0 THEN
    old_fragment := 'SELECT item.value,r.document_id,';
    IF position(old_fragment in definition)=0 THEN RAISE EXCEPTION 'Unsupported sidebar document projection'; END IF;
    definition := replace(definition,old_fragment,$fragment$SELECT item.value,(item.value->>'document_id')::uuid AS document_id,$fragment$);

    old_fragment := $fragment$md5(r.document_id::text||'|'||extract(epoch FROM r.requested_at)::text||'|'||COALESCE(r.source_key,'')) AS token$fragment$;
    IF position(old_fragment in definition)=0 THEN RAISE EXCEPTION 'Unsupported sidebar revision projection'; END IF;
    definition := replace(definition,old_fragment,$fragment$(item.value->>'read_token') AS token$fragment$);

    old_fragment := $fragment$LEFT JOIN public.seller_offer_reviews r ON item.value->>'kind'='review' AND r.offer_id::text=item.value->>'offer_id'$fragment$;
    IF position(old_fragment in definition)=0 THEN RAISE EXCEPTION 'Unsupported sidebar review join'; END IF;
    definition := replace(definition,old_fragment,'');
    old_fragment := 'seen.offer_id=r.offer_id';
    IF position(old_fragment in definition)=0 THEN RAISE EXCEPTION 'Unsupported sidebar read join'; END IF;
    definition := replace(definition,old_fragment,$fragment$seen.offer_id=(item.value->>'offer_id')::uuid$fragment$);
    EXECUTE definition;
  END IF;
END;
$migration$;

NOTIFY pgrst,'reload schema';
COMMIT;
