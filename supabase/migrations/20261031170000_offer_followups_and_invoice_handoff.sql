BEGIN;

-- 1. Przypomnienia o ofertach bez odpowiedzi (3 i 7 dni od wysłania) i o wygasającej ofercie (2 dni).
-- 2. Przekazanie sprzedaży do fakturowania: po akceptacji oferty administrator/finanse dostają
--    powiadomienie z kwotą i linkiem — sprzedawca nie wystawia faktur (zakres sales_lead).

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS follow_up_reminders_sent text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.offer_sales_owner_user_ids(p_offer_id uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(array_agg(DISTINCT coalesce(e.auth_user_id, e.id)), '{}'::uuid[])
  FROM public.offers o
  LEFT JOIN public.tasks inquiry ON inquiry.id = o.inquiry_id
  JOIN public.employees e ON e.is_active
    AND (e.id = inquiry.inquiry_owner_id
      OR (inquiry.inquiry_owner_id IS NULL AND (e.id = o.created_by OR e.auth_user_id = o.created_by)))
  WHERE o.id = p_offer_id;
$$;

CREATE OR REPLACE FUNCTION public.process_offer_followup_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE offer record; kind text; recipients uuid[]; sent integer := 0; label text;
BEGIN
  FOR offer IN
    SELECT o.* FROM public.offers o
    LEFT JOIN public.tasks inquiry ON inquiry.id = o.inquiry_id
    WHERE o.status::text = 'sent' AND o.sent_at IS NOT NULL
      AND coalesce(o.sales_channel, 'crm') <> 'seller_portal'
      AND (inquiry.id IS NULL OR (inquiry.archived_at IS NULL AND coalesce(inquiry.inquiry_stage, '') NOT IN ('won', 'lost')))
      -- Tylko oferty z ostatnich 30 dni i z co najmniej jednym niewysłanym przypomnieniem
      -- (inaczej stare rekordy zapełniłyby limit i nowe oferty nie dostawałyby przypomnień).
      AND o.sent_at > now() - interval '30 days'
      AND (
        (o.sent_at < now() - interval '3 days' AND NOT ('no_reply_3d' = ANY(o.follow_up_reminders_sent)))
        OR (o.sent_at < now() - interval '7 days' AND NOT ('no_reply_7d' = ANY(o.follow_up_reminders_sent)))
        OR (o.valid_until IS NOT NULL
          AND o.valid_until::date BETWEEN (now() AT TIME ZONE 'Europe/Warsaw')::date
            AND (now() AT TIME ZONE 'Europe/Warsaw')::date + 2
          AND NOT ('expires_2d' = ANY(o.follow_up_reminders_sent))))
    ORDER BY o.sent_at
    LIMIT 500
  LOOP
    kind := CASE
      WHEN offer.valid_until IS NOT NULL
        AND offer.valid_until::date >= (now() AT TIME ZONE 'Europe/Warsaw')::date
        AND offer.valid_until::date <= (now() AT TIME ZONE 'Europe/Warsaw')::date + 2
        AND NOT ('expires_2d' = ANY(offer.follow_up_reminders_sent)) THEN 'expires_2d'
      WHEN offer.sent_at < now() - interval '7 days' AND NOT ('no_reply_7d' = ANY(offer.follow_up_reminders_sent)) THEN 'no_reply_7d'
      WHEN offer.sent_at < now() - interval '3 days' AND offer.sent_at >= now() - interval '7 days'
        AND NOT ('no_reply_3d' = ANY(offer.follow_up_reminders_sent)) THEN 'no_reply_3d'
      -- Po 7 dniach przypomnienie 3-dniowe nie ma już sensu: oznaczamy je jako obsłużone.
      WHEN offer.sent_at < now() - interval '7 days' AND NOT ('no_reply_3d' = ANY(offer.follow_up_reminders_sent))
        THEN 'skip_3d'
      ELSE NULL END;
    CONTINUE WHEN kind IS NULL;

    IF kind = 'skip_3d' THEN
      UPDATE public.offers SET follow_up_reminders_sent = array_append(follow_up_reminders_sent, 'no_reply_3d')
      WHERE id = offer.id;
      CONTINUE;
    END IF;

    recipients := public.offer_sales_owner_user_ids(offer.id);
    label := coalesce(nullif(offer.title, ''), offer.offer_number, 'Oferta');
    IF cardinality(recipients) > 0 THEN
      PERFORM public.enqueue_crm_business_notification(
        'offer-' || kind || ':' || offer.id::text, 'offer_followup',
        CASE kind
          WHEN 'expires_2d' THEN 'Oferta wygasa za 2 dni'
          WHEN 'no_reply_7d' THEN 'Oferta bez odpowiedzi od tygodnia'
          ELSE 'Oferta bez odpowiedzi od 3 dni' END,
        label || CASE WHEN offer.viewed_at IS NULL THEN ' — klient jeszcze jej nie otworzył' ELSE ' — klient ją otworzył' END,
        CASE kind WHEN 'no_reply_3d' THEN 'info' ELSE 'warning' END, 'system',
        coalesce('/crm/inquiries/' || offer.inquiry_id::text, '/crm/offers/' || offer.id::text),
        NULL, NULL, jsonb_build_object('offer_id', offer.id, 'reminder', kind), recipients);
      sent := sent + 1;
    END IF;

    UPDATE public.offers SET follow_up_reminders_sent = array_append(follow_up_reminders_sent, kind)
    WHERE id = offer.id;
  END LOOP;
  RETURN sent;
END;
$$;

-- Ta sama definicja co w 20261031160000; kolumna przypomnień nie zmienia treści oferty.
CREATE OR REPLACE FUNCTION public.mark_offer_modified() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ignored text[]:=ARRAY['updated_at','generated_pdf_url','generated_pdf_revision','last_generated_at','last_generated_by','modified_after_generation','content_revision','status','sent_at','accepted_at','accepted_by','acceptance_note','accepted_package_id','accepted_variant_selections','event_id','inquiry_id',
  'approval_status','approval_requested_at','approval_requested_by','approval_decided_at','approval_decided_by','approval_note','approval_snapshot','viewed_at',
  'follow_up_reminders_sent'];
BEGIN
 IF (to_jsonb(NEW)-ignored) IS DISTINCT FROM (to_jsonb(OLD)-ignored) THEN NEW.content_revision:=OLD.content_revision+1; END IF;
 IF NEW.content_revision IS DISTINCT FROM OLD.content_revision THEN NEW.modified_after_generation:=true; END IF;
 RETURN NEW;
END $$;

-- Data wysyłki oferty: record_sales_delivery (send-offer-email) zmienia tylko status na „sent”,
-- nie ustawia sent_at — bez tego przypomnienia i „Mój dzień” nie widziałyby ofert z CRM.
-- Ten sam wyzwalacz zeruje przypomnienia przy nowej dacie wysyłki i dla nowych ofert (także kopii).
CREATE OR REPLACE FUNCTION public.reset_offer_followups_on_send()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.follow_up_reminders_sent := '{}';
    IF NEW.status::text = 'sent' AND NEW.sent_at IS NULL THEN NEW.sent_at := now(); END IF;
    RETURN NEW;
  END IF;
  IF NEW.status::text = 'sent' AND OLD.status::text IS DISTINCT FROM 'sent'
    AND NEW.sent_at IS NOT DISTINCT FROM OLD.sent_at THEN
    NEW.sent_at := now();
  END IF;
  IF NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
    NEW.follow_up_reminders_sent := '{}';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reset_offer_followups_on_send ON public.offers;
CREATE TRIGGER reset_offer_followups_on_send BEFORE INSERT OR UPDATE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.reset_offer_followups_on_send();

-- Uzupełnienie sent_at dla ofert już wysłanych: ostatnia wysyłka z historii zapytania,
-- a gdy jej brak — data ostatniej zmiany oferty (przybliżenie).
UPDATE public.offers o SET sent_at = delivery.last_sent
FROM (
  SELECT (a.metadata->>'document_id')::uuid AS offer_id, max(a.created_at) AS last_sent
  FROM public.inquiry_activity a
  WHERE a.kind = 'delivery' AND a.metadata->>'document_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  GROUP BY 1
) delivery
WHERE o.id = delivery.offer_id AND o.status::text = 'sent' AND o.sent_at IS NULL;
UPDATE public.offers SET sent_at = coalesce(updated_at, created_at)
WHERE status::text = 'sent' AND sent_at IS NULL;

-- Start bez lawiny powiadomień: oferty wysłane wcześniej mają już „wykorzystane” przypomnienia
-- za miniony czas (i tak widać je w „Mój dzień” jako oferty bez odpowiedzi).
UPDATE public.offers SET follow_up_reminders_sent = CASE
    WHEN sent_at < now() - interval '7 days' THEN ARRAY['no_reply_3d', 'no_reply_7d']
    ELSE ARRAY['no_reply_3d'] END
WHERE status::text = 'sent' AND sent_at IS NOT NULL AND sent_at < now() - interval '3 days'
  AND follow_up_reminders_sent = '{}';

-- Przekazanie do fakturowania po akceptacji oferty.
CREATE OR REPLACE FUNCTION public.notify_finance_on_offer_accepted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE recipients uuid[]; event_name text; seller text;
BEGIN
  IF NEW.status::text <> 'accepted' OR OLD.status::text IS NOT DISTINCT FROM 'accepted' THEN RETURN NEW; END IF;

  -- Finanse firmy: administratorzy i osoby z uprawnieniami finansowymi, bez zakresów sprzedażowych
  -- (sprzedawca nie widzi kwot cudzej sprzedaży).
  SELECT array_agg(DISTINCT coalesce(e.auth_user_id, e.id)) INTO recipients
  FROM public.employees e
  LEFT JOIN public.access_levels level ON level.id = e.access_level_id
  WHERE e.is_active
    AND (e.role::text = 'admin' OR e.access_level::text = 'admin'
      OR 'admin' = ANY(coalesce(e.permissions, '{}'::text[]))
      OR (coalesce(e.permissions, '{}'::text[]) && ARRAY['finances_manage', 'invoices_manage']::text[]
        AND coalesce(e.finance_access_scope, 'inherit') NOT IN ('sales', 'sales_lead')
        AND NOT (coalesce(e.finance_access_scope, 'inherit') = 'inherit' AND level.slug = 'sales-specialist')));
  SELECT name INTO event_name FROM public.events WHERE id = NEW.event_id;
  SELECT concat_ws(' ', e.name, e.surname) INTO seller FROM public.employees e
  WHERE e.id = NEW.created_by OR e.auth_user_id = NEW.created_by LIMIT 1;

  IF coalesce(cardinality(recipients), 0) > 0 THEN
    PERFORM public.enqueue_crm_business_notification(
      'offer-accepted-invoice:' || NEW.id::text, 'sale_ready_for_invoicing',
      'Nowa sprzedaż do zafakturowania',
      concat_ws(' · ',
        coalesce(nullif(NEW.title, ''), NEW.offer_number, 'Oferta'),
        event_name,
        to_char(coalesce(NEW.total_amount, 0), 'FM999G999G990D00') || ' zł',
        'sprzedawca: ' || nullif(seller, ''),
        'sprawdź zaliczkę lub proformę'),
      'info', 'system',
      CASE WHEN NEW.event_id IS NOT NULL THEN '/crm/events/' || NEW.event_id::text || '?tab=finances'
        ELSE '/crm/offers/' || NEW.id::text END,
      NULL, NULL, jsonb_build_object('offer_id', NEW.id, 'event_id', NEW.event_id), recipients);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS notify_finance_on_offer_accepted ON public.offers;
CREATE TRIGGER notify_finance_on_offer_accepted AFTER UPDATE OF status ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.notify_finance_on_offer_accepted();

REVOKE ALL ON FUNCTION public.offer_sales_owner_user_ids(uuid), public.process_offer_followup_reminders(),
  public.reset_offer_followups_on_send(), public.notify_finance_on_offer_accepted() FROM PUBLIC, anon, authenticated;

DO $schedule$
DECLARE job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR job_id IN EXECUTE 'SELECT jobid FROM cron.job WHERE jobname = $1' USING 'offer-followup-reminders' LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING job_id;
    END LOOP;
    EXECUTE 'SELECT cron.schedule($1, $2, $3)'
      USING 'offer-followup-reminders', '23 6 * * 1-5', 'SELECT public.process_offer_followup_reminders();';
  ELSE
    RAISE WARNING 'pg_cron niedostępny: przypomnienia o ofertach nie zostały zaplanowane.';
  END IF;
END $schedule$;

NOTIFY pgrst, 'reload schema';
COMMIT;
