-- Przypomnienia o zaplanowanym kontakcie telefonicznym (CRM) nie były wysyłane.
--
-- Zadanie pg_cron „process-crm-call-followups” (co 5 minut) kończyło się błędem
-- „column reference "notification_id" is ambiguous”, gdy tylko było choć jedno przypomnienie do wysłania:
-- zmienna funkcji nazywała się tak samo jak kolumna notification_recipients.notification_id użyta w ON CONFLICT.
-- Błąd cofał całą transakcję, więc żadne przypomnienie nie wychodziło (pierwszy błąd 2026-08-24,
-- od 2026-10-19 przy każdym uruchomieniu). Poprawka: zmienna v_notification_id; reszta funkcji bez zmian.
-- Po wdrożeniu najbliższe uruchomienie wyśle zaległe przypomnienia (stan na 2026-11-01: 2, z 19.10).

BEGIN;

CREATE OR REPLACE FUNCTION public.process_due_crm_call_followups()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  activity record;
  v_notification_id uuid;
  processed integer := 0;
  target_name text;
BEGIN
  FOR activity IN
    SELECT call.*
    FROM public.crm_call_activities call
    WHERE call.status = 'completed'
      AND call.next_action_at IS NOT NULL
      AND call.next_action_at <= now()
      AND call.reminder_sent_at IS NULL
    ORDER BY call.next_action_at
    FOR UPDATE SKIP LOCKED
  LOOP
    target_name := COALESCE(activity.metadata->>'display_name', activity.phone_number);
    INSERT INTO public.notifications (
      title, message, type, category, action_url,
      related_entity_type, related_entity_id, metadata, created_at
    ) VALUES (
      'Zaplanowany kontakt telefoniczny',
      format('Czas skontaktować się z: %s (%s).', target_name, activity.phone_number),
      'warning',
      'system',
      CASE
        WHEN activity.inquiry_id IS NOT NULL THEN format('/crm/tasks/%s', activity.inquiry_id)
        WHEN activity.event_id IS NOT NULL THEN format('/crm/events/%s', activity.event_id)
        WHEN activity.contact_id IS NOT NULL THEN format('/crm/contacts/%s', activity.contact_id)
        ELSE '/crm/contacts'
      END,
      CASE
        WHEN activity.inquiry_id IS NOT NULL THEN 'task'
        WHEN activity.event_id IS NOT NULL THEN 'event'
        ELSE NULL
      END,
      COALESCE(activity.inquiry_id, activity.event_id),
      jsonb_build_object(
        'kind', 'crm_call_followup',
        'call_activity_id', activity.id,
        'contact_id', activity.contact_id,
        'inquiry_id', activity.inquiry_id,
        'event_id', activity.event_id,
        'phone_number', activity.phone_number
      ),
      now()
    ) RETURNING id INTO v_notification_id;

    IF activity.created_by IS NOT NULL THEN
      INSERT INTO public.notification_recipients (notification_id, user_id, is_read)
      VALUES (v_notification_id, activity.created_by, false)
      ON CONFLICT (notification_id, user_id) DO NOTHING;
    END IF;

    UPDATE public.crm_call_activities
    SET reminder_sent_at = now(), updated_at = now()
    WHERE id = activity.id;
    processed := processed + 1;
  END LOOP;
  RETURN processed;
END;
$function$;

-- Funkcję wywołuje tylko pg_cron (rola postgres); z API nie powinna być dostępna.
REVOKE EXECUTE ON FUNCTION public.process_due_crm_call_followups() FROM PUBLIC, anon, authenticated;

COMMIT;
