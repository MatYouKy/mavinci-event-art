BEGIN;

ALTER TABLE public.event_partner_arrangements
  ADD COLUMN include_contract boolean NOT NULL DEFAULT false;

-- A shared sequence makes concurrent saves allocate different order numbers.
CREATE SEQUENCE public.partner_order_number_seq;
REVOKE ALL ON SEQUENCE public.partner_order_number_seq FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.assign_partner_order_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Preserve the reference on subsequent edits, including disabling cooperation.
  IF TG_OP = 'UPDATE' AND btrim(coalesce(OLD.order_reference, '')) <> '' THEN
    NEW.order_reference := OLD.order_reference;
  ELSIF NEW.enabled AND btrim(coalesce(NEW.order_reference, '')) = '' THEN
    NEW.order_reference := 'ZP/'
      || to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Warsaw', 'YYYY')
      || '/' || nextval('public.partner_order_number_seq'::regclass)::text;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assign_partner_order_reference() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER assign_partner_order_reference
BEFORE INSERT OR UPDATE ON public.event_partner_arrangements
FOR EACH ROW EXECUTE FUNCTION public.assign_partner_order_reference();

-- Existing enabled arrangements receive a reference, while external references remain intact.
UPDATE public.event_partner_arrangements
SET order_reference = ''
WHERE enabled AND btrim(coalesce(order_reference, '')) = '';

NOTIFY pgrst, 'reload schema';
COMMIT;
