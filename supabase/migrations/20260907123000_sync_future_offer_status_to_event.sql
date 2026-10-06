/*
  # Synchronizacja etapu oferty z wydarzeniem

  Działa wyłącznie dla przyszłych zmian statusu ofert. Nie przelicza wstecz
  istniejących wydarzeń i nie cofa wydarzenia, które weszło już w realizację.
*/

CREATE OR REPLACE FUNCTION public.sync_event_status_from_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.event_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text = 'sent' THEN
    UPDATE public.events
    SET status = 'offer_sent', updated_at = now()
    WHERE id = NEW.event_id
      AND status::text IN ('inquiry', 'offer_to_send');
  ELSIF NEW.status::text = 'accepted' THEN
    UPDATE public.events
    SET status = 'offer_accepted', updated_at = now()
    WHERE id = NEW.event_id
      AND status::text IN ('inquiry', 'offer_to_send', 'offer_sent');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_event_status_from_offer ON public.offers;
CREATE TRIGGER trg_sync_event_status_from_offer
AFTER UPDATE OF status ON public.offers
FOR EACH ROW
EXECUTE FUNCTION public.sync_event_status_from_offer();

COMMENT ON FUNCTION public.sync_event_status_from_offer() IS
'Przesuwa wydarzenie do offer_sent lub offer_accepted w tej samej transakcji co przyszła zmiana oferty.';
