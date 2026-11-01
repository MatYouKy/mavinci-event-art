BEGIN;

-- Optional delta transport shared by desktop, future mobile and browser clients.
-- SECURITY INVOKER is deliberate: all source rows retain the caller's existing RLS,
-- company, owner, team and finance restrictions. No new policy or service_role access.
CREATE OR REPLACE FUNCTION public.native_workspace_sync(p_set text, p_hashes jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
SET statement_timeout = '15s'
AS $function$
DECLARE
  actor uuid;
  permissions text[];
  admin boolean;
  source_sql text;
  result jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.current_session_is_seller_portal() THEN
    RAISE EXCEPTION 'Brak dostępu do aplikacji pracownika.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.employees WHERE auth_user_id = auth.uid() AND is_active) <> 1 THEN
    RAISE EXCEPTION 'Nie można potwierdzić pracownika.' USING ERRCODE = '42501';
  END IF;
  SELECT id, coalesce(e.permissions, '{}'::text[]),
    (e.role::text = 'admin' OR e.access_level::text = 'admin' OR 'admin' = ANY(coalesce(e.permissions, '{}'::text[])))
  INTO actor, permissions, admin FROM public.employees e WHERE auth_user_id = auth.uid() AND is_active;
  IF p_set NOT IN ('tasks','inquiries','contacts','events','offers','tenders','notifications','calendar') THEN
    RAISE EXCEPTION 'Nieznany zbiór.' USING ERRCODE = '22023';
  END IF;
  IF p_set <> 'notifications' AND NOT (admin OR permissions && ARRAY[p_set || '_view',p_set || '_manage']) THEN
    RAISE EXCEPTION 'Brak dostępu do modułu.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_hashes) IS DISTINCT FROM 'object' OR octet_length(p_hashes::text) > 4096 THEN
    RAISE EXCEPTION 'Nieprawidłowy manifest.' USING ERRCODE = '22023';
  END IF;
  CASE p_set
    WHEN 'calendar' THEN source_sql := $sql$SELECT e.id::text AS id,e.id::text AS source_id,'event'::text AS kind,e.name,e.description,e.event_date,e.event_end_date,e.status::text AS status,e.location,NULL::integer AS recurrence_days FROM public.events e
UNION ALL
SELECT 'meeting:'||m.id::text,m.id::text,'meeting',m.title,NULL::text,m.datetime_start,m.datetime_end,'meeting',m.location_text,m.recurrence_days FROM public.meetings m
WHERE m.deleted_at IS NULL AND (m.created_by=$1 OR EXISTS(SELECT 1 FROM public.meeting_participants p WHERE p.meeting_id=m.id AND p.employee_id=$1))$sql$;
    WHEN 'tasks' THEN source_sql := $sql$SELECT id,title,description,priority,status,board_column,due_date,created_at,updated_at,is_private,owner_id,created_by,event_id,is_inquiry,inquiry_stage,inquiry_owner_id,inquiry_details,next_action_at,archived_at,deleted_at FROM public.tasks t WHERE t.is_inquiry = false AND t.deleted_at IS NULL AND ((t.is_private AND t.owner_id = $2) OR (t.is_private = false AND EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = t.id AND a.employee_id = $1)))$sql$;
    WHEN 'inquiries' THEN source_sql := $sql$SELECT id,title,description,priority,status,board_column,due_date,created_at,updated_at,is_private,owner_id,created_by,event_id,is_inquiry,inquiry_stage,inquiry_owner_id,inquiry_details,next_action_at,archived_at,deleted_at FROM public.tasks WHERE is_inquiry = true AND deleted_at IS NULL AND archived_at IS NULL$sql$;
    WHEN 'contacts' THEN source_sql := $sql$SELECT id,first_name,last_name,email,phone,mobile,status,last_contact_date,tags FROM public.contacts WHERE status = 'active'$sql$;
    WHEN 'events' THEN source_sql := $sql$SELECT id,name,description,event_date,event_end_date,status,location,created_by,created_at,updated_at FROM public.events$sql$;
    WHEN 'offers' THEN source_sql := $sql$SELECT id,title,offer_number,status,valid_until,inquiry_id,event_id,created_at,updated_at FROM public.offers$sql$;
    WHEN 'tenders' THEN source_sql := $sql$SELECT id,title,status,submission_deadline,assigned_to,inquiry_id,created_at FROM public.tenders$sql$;
    WHEN 'notifications' THEN source_sql := $sql$SELECT r.id,r.is_read,n.title,n.message,n.category,n.related_entity_type,n.related_entity_id,n.action_url,n.created_at FROM public.notification_recipients r JOIN public.notifications n ON n.id = r.notification_id WHERE r.user_id = $1 AND n.related_entity_type IS DISTINCT FROM 'event_phase_assignment'$sql$;
  END CASE;
  -- Hash complete row content, not updated_at: changes to joins, visibility and deletions
  -- also replace a bucket. All 16 buckets are present, including empty ones.
  EXECUTE format($sql$
    WITH source AS MATERIALIZED (%s),
    rows AS (SELECT left(md5(s.id::text), 1) AS bucket, s.id::text AS id, to_jsonb(s) AS item FROM source s),
    buckets AS (
      SELECT to_hex(i) AS key, coalesce(jsonb_agg(r.item ORDER BY r.id) FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb) AS items
      FROM generate_series(0,15) i LEFT JOIN rows r ON r.bucket = to_hex(i) GROUP BY i
    ),
    hashed AS (SELECT key, items, md5(items::text) AS hash FROM buckets)
    SELECT jsonb_build_object(
      'hashes', jsonb_object_agg(key, hash),
      'changed', coalesce(jsonb_object_agg(key, items) FILTER (WHERE hash IS DISTINCT FROM $3 ->> key), '{}'::jsonb)
    ) FROM hashed
  $sql$, source_sql) INTO result USING actor, auth.uid(), p_hashes;
  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.native_workspace_sync(text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.native_workspace_sync(text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.native_workspace_sync(text,jsonb) IS
  'Protokół desktop v1: 16 kubełków, skróty treści i tylko zmienione kubełki; zawsze RLS wywołującego. Bez trwałych migawek serwera — każdy zapis jest widoczny w następnym odczycie.';
NOTIFY pgrst, 'reload schema';
COMMIT;
