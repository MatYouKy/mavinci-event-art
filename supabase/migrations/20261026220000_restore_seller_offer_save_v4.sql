BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Repair installations which have v5 but were deployed before the v4 response
-- wrapper was added to the daily-schedule migration. No offer rows are changed.
DO $dependencies$
BEGIN
  IF to_regprocedure('public.save_seller_portal_offer_v3(uuid,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.get_seller_offer_arrangements(uuid)') IS NULL
     OR to_regprocedure('public.normalize_seller_event_days(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Najpierw wdroż migrację 20261026200000_seller_event_daily_schedule.sql, a następnie ponów tę poprawkę.';
  END IF;
END;
$dependencies$;

CREATE OR REPLACE FUNCTION public.save_seller_portal_offer_v4(
  p_request_id uuid,
  p_offer jsonb,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $save$
DECLARE
  v_offer_id uuid;
BEGIN
  -- Keep the existing authentication, ownership, validation, revision checks
  -- and idempotency ledger. Return the revision committed by that same save.
  v_offer_id := public.save_seller_portal_offer_v3(p_request_id, p_offer, p_items);
  RETURN jsonb_build_object(
    'offer_id', v_offer_id,
    'arrangements', public.get_seller_offer_arrangements(v_offer_id)
  );
END;
$save$;

REVOKE ALL ON FUNCTION public.save_seller_portal_offer_v4(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_offer_v4(uuid, jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
