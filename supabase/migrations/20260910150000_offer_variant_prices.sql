ALTER TABLE public.offer_items ADD COLUMN IF NOT EXISTS variant_prices_net jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE OR REPLACE FUNCTION public.validate_offer_variant_prices() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE entry record;
BEGIN
  IF jsonb_typeof(NEW.variant_prices_net) <> 'object' THEN RAISE EXCEPTION 'Ceny wariantów muszą być obiektem'; END IF;
  FOR entry IN SELECT key, value FROM jsonb_each(NEW.variant_prices_net) LOOP
    IF jsonb_typeof(entry.value) <> 'number' OR entry.value::text::numeric < 0 OR entry.value::text::numeric > 999999999.99 THEN
      RAISE EXCEPTION 'Nieprawidłowa cena wariantu';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.offer_product_variants WHERE id::text = entry.key AND product_id = NEW.product_id) THEN
      RAISE EXCEPTION 'Wariant nie należy do produktu';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_offer_variant_prices ON public.offer_items;
CREATE TRIGGER validate_offer_variant_prices BEFORE INSERT OR UPDATE OF variant_prices_net, product_id ON public.offer_items FOR EACH ROW EXECUTE FUNCTION public.validate_offer_variant_prices();
NOTIFY pgrst, 'reload schema';
