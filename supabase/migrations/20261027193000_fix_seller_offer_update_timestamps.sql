-- Repair the UPDATE branch without adding unused timestamp columns.
-- Existing rows, saved PDFs, prices, permissions and idempotency are untouched.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $repair$
DECLARE
  v_function regprocedure := to_regprocedure('public.save_seller_portal_offer(jsonb,jsonb)');
  v_before text;
  v_after text;
  v_column text;
  v_pattern text;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'Brak funkcji zapisu portalu sprzedawcy. Najpierw wdroż podstawowe migracje portalu.';
  END IF;
  SELECT pg_get_functiondef(v_function) INTO v_before;
  v_after := v_before;
  FOREACH v_column IN ARRAY ARRAY['sent_at', 'viewed_at'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = 'public.offers'::regclass
        AND attname = v_column AND attnum > 0 AND NOT attisdropped
    ) THEN
      -- Remove only a standalone NULL assignment for a column absent here.
      -- Keep the installed function, including newer security/pricing fixes.
      v_pattern := E'(^|\\n)[\\t ]*' || v_column || E'[\\t ]*=[\\t ]*NULL[\\t ]*,';
      v_after := regexp_replace(v_after, v_pattern, E'\\1', 'gi');
      IF v_after ~* (E'\\m' || v_column || E'\\M') THEN
        RAISE EXCEPTION 'Funkcja ma niestandardowe odwołanie do pola %. Nie zmieniono funkcji.', v_column;
      END IF;
    END IF;
  END LOOP;
  IF v_after IS DISTINCT FROM v_before THEN
    EXECUTE v_after;
  END IF;
END;
$repair$;

NOTIFY pgrst, 'reload schema';
COMMIT;
