BEGIN;

-- A catalog recipe has no event/date and must not rewrite reservations of every
-- offer that has ever used it. The legacy trigger deleted and recreated those
-- reservations even for unrelated catalog edits, causing stock errors and
-- overwriting event-specific equipment choices.
-- Reservation/synchronization at offer acceptance and explicit event operations
-- is unchanged, including physical kit/component inventory validation.
DROP TRIGGER IF EXISTS trg_sync_offer_equipment_product_equipment
  ON public.offer_product_equipment;

COMMIT;
