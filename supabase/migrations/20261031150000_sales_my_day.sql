BEGIN;

-- „Mój dzień” sprzedawcy: lista działań zamiast samych wskaźników zafakturowanych.
-- Zwraca wyłącznie rekordy bieżącego pracownika (nie przyjmuje identyfikatora z zewnątrz).
CREATE OR REPLACE FUNCTION public.get_my_sales_day()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  actor uuid := public.current_crm_employee_id();
  actor_auth uuid;
  day_end timestamptz;
BEGIN
  IF actor IS NULL OR public.current_session_is_seller_portal() THEN
    RAISE EXCEPTION 'Wymagane aktywne konto pracownika.' USING ERRCODE = '42501';
  END IF;
  SELECT auth_user_id INTO actor_auth FROM public.employees WHERE id = actor;
  day_end := (date_trunc('day', now() AT TIME ZONE 'Europe/Warsaw') + interval '1 day') AT TIME ZONE 'Europe/Warsaw';

  RETURN jsonb_build_object(
    'generated_at', now(),
    'followups', (
      SELECT coalesce(jsonb_agg(item ORDER BY item.next_action_at), '[]'::jsonb) FROM (
        SELECT t.id, t.title, t.inquiry_stage AS stage, t.next_action_at, t.estimated_value,
          t.next_action_at < now() AS overdue, t.tender_id
        FROM public.tasks t
        WHERE t.is_inquiry AND t.inquiry_owner_id = actor AND t.archived_at IS NULL
          AND coalesce(t.inquiry_stage, 'new') NOT IN ('won', 'lost')
          AND t.next_action_at IS NOT NULL AND t.next_action_at < day_end
        ORDER BY t.next_action_at
        LIMIT 30
      ) item
    ),
    'unscheduled_inquiries', (
      SELECT count(*) FROM public.tasks t
      WHERE t.is_inquiry AND t.inquiry_owner_id = actor AND t.archived_at IS NULL
        AND coalesce(t.inquiry_stage, 'new') NOT IN ('won', 'lost') AND t.next_action_at IS NULL
    ),
    'waiting_offers', (
      SELECT coalesce(jsonb_agg(item ORDER BY item.sent_at), '[]'::jsonb) FROM (
        SELECT o.id, coalesce(nullif(o.title, ''), o.offer_number) AS title, o.offer_number, o.sent_at, o.viewed_at,
          o.total_amount, o.valid_until, o.inquiry_id, o.event_id,
          floor(extract(epoch FROM now() - o.sent_at) / 86400)::int AS days_waiting
        FROM public.offers o
        LEFT JOIN public.tasks inquiry ON inquiry.id = o.inquiry_id
        WHERE o.status::text = 'sent' AND o.sent_at IS NOT NULL AND o.sent_at < now() - interval '3 days'
          AND (o.created_by IN (actor, actor_auth) OR inquiry.inquiry_owner_id = actor)
          AND (inquiry.id IS NULL OR (inquiry.archived_at IS NULL AND coalesce(inquiry.inquiry_stage, '') NOT IN ('won', 'lost')))
        ORDER BY o.sent_at
        LIMIT 20
      ) item
    ),
    'tenders', CASE WHEN public.current_employee_can_view_tenders() THEN (
      SELECT coalesce(jsonb_agg(item ORDER BY item.submission_deadline), '[]'::jsonb) FROM (
        SELECT t.id, t.title, t.submission_deadline, t.status, t.inquiry_id, t.relevance_score,
          t.assigned_to = actor AS mine
        FROM public.tenders t
        WHERE t.submission_deadline > now() AND t.submission_deadline <= now() + interval '7 days'
          AND t.status IN ('new', 'reviewing', 'interested', 'preparing')
          AND NOT coalesce(t.is_hidden, false)
          AND (t.assigned_to = actor
            OR (t.assigned_to IS NULL AND (t.is_matched OR t.manual_relevance = 'relevant' OR t.is_watched)))
        ORDER BY t.submission_deadline
        LIMIT 15
      ) item
    ) ELSE '[]'::jsonb END,
    'pipeline', (
      SELECT coalesce(jsonb_agg(item ORDER BY item.position), '[]'::jsonb) FROM (
        SELECT coalesce(t.inquiry_stage, 'new') AS stage,
          CASE coalesce(t.inquiry_stage, 'new') WHEN 'new' THEN 1 WHEN 'contacted' THEN 2 WHEN 'qualified' THEN 3
            WHEN 'proposal' THEN 4 WHEN 'negotiation' THEN 5 ELSE 6 END AS position,
          count(*) AS count,
          coalesce(sum(t.estimated_value), 0) AS value,
          coalesce(sum(t.estimated_value * coalesce(t.win_probability, 0) / 100.0), 0) AS weighted_value
        FROM public.tasks t
        WHERE t.is_inquiry AND t.inquiry_owner_id = actor AND t.archived_at IS NULL
          AND coalesce(t.inquiry_stage, 'new') NOT IN ('won', 'lost')
        GROUP BY coalesce(t.inquiry_stage, 'new')
      ) item
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_sales_day() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_sales_day() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
