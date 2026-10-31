BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
ALTER TABLE public.event_calculation_items ADD COLUMN IF NOT EXISTS transport_estimate jsonb;
COMMENT ON COLUMN public.event_calculation_items.transport_estimate IS 'Internal route and fuel assumptions; client-facing calculation uses days as distance and unit_price as the net per-km rate.';
NOTIFY pgrst,'reload schema';
COMMIT;
