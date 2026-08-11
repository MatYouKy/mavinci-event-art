/*
  # Deliver every CRM notification as a mobile push

  notification_recipients is the single source of truth for who receives a
  notification. Every new unread recipient row asynchronously invokes the
  push Edge Function. Delivery claims prevent explicit legacy callers and the
  database trigger from producing duplicate banners.
*/

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.notification_push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_recipient_id uuid NOT NULL UNIQUE
    REFERENCES public.notification_recipients(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'sent', 'skipped', 'failed')),
  attempt_count integer NOT NULL DEFAULT 1,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_push_deliveries_status
  ON public.notification_push_deliveries(status, created_at DESC);

ALTER TABLE public.notification_push_deliveries ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.dispatch_notification_recipient_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
BEGIN
  IF COALESCE(NEW.is_read, false) THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://fuuljhhuhfojtmmfmskq.supabase.co/functions/v1/send-crm-notification-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'notification_recipients',
      'schema', 'public',
      'record', to_jsonb(NEW),
      'old_record', NULL
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A push outage must never roll back the business notification itself.
  RAISE WARNING 'Unable to enqueue push for notification recipient %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dispatch_notification_recipient_push_after_insert
  ON public.notification_recipients;
CREATE TRIGGER dispatch_notification_recipient_push_after_insert
  AFTER INSERT ON public.notification_recipients
  FOR EACH ROW
  EXECUTE FUNCTION public.dispatch_notification_recipient_push();

REVOKE ALL ON FUNCTION public.dispatch_notification_recipient_push() FROM PUBLIC;

COMMENT ON TABLE public.notification_push_deliveries IS
  'Idempotency and delivery status for native pushes generated from CRM notification recipients.';
COMMENT ON FUNCTION public.dispatch_notification_recipient_push() IS
  'Asynchronously requests one native mobile push for every new unread notification recipient.';
