-- Jedno źródło czasu trwania usługi i kosztu jej przedłużenia.
-- Wariant dziedziczy wartości produktu, dopóki nie otrzyma własnej wartości.

ALTER TABLE public.offer_products
  ADD COLUMN IF NOT EXISTS service_duration_hours numeric(6, 2),
  ADD COLUMN IF NOT EXISTS extension_price_net_per_hour numeric(12, 2);

ALTER TABLE public.offer_product_variants
  ADD COLUMN IF NOT EXISTS service_duration_hours numeric(6, 2),
  ADD COLUMN IF NOT EXISTS extension_price_net_per_hour numeric(12, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'offer_products_service_duration_hours_check'
      AND conrelid = 'public.offer_products'::regclass
  ) THEN
    ALTER TABLE public.offer_products
      ADD CONSTRAINT offer_products_service_duration_hours_check
      CHECK (service_duration_hours IS NULL OR service_duration_hours > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'offer_products_extension_price_net_per_hour_check'
      AND conrelid = 'public.offer_products'::regclass
  ) THEN
    ALTER TABLE public.offer_products
      ADD CONSTRAINT offer_products_extension_price_net_per_hour_check
      CHECK (extension_price_net_per_hour IS NULL OR extension_price_net_per_hour >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'offer_product_variants_service_duration_hours_check'
      AND conrelid = 'public.offer_product_variants'::regclass
  ) THEN
    ALTER TABLE public.offer_product_variants
      ADD CONSTRAINT offer_product_variants_service_duration_hours_check
      CHECK (service_duration_hours IS NULL OR service_duration_hours > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'offer_product_variants_extension_price_net_per_hour_check'
      AND conrelid = 'public.offer_product_variants'::regclass
  ) THEN
    ALTER TABLE public.offer_product_variants
      ADD CONSTRAINT offer_product_variants_extension_price_net_per_hour_check
      CHECK (extension_price_net_per_hour IS NULL OR extension_price_net_per_hour >= 0) NOT VALID;
  END IF;
END
$$;

COMMENT ON COLUMN public.offer_products.service_duration_hours IS
  'Bazowy czas trwania usługi w godzinach, dziedziczony przez warianty.';
COMMENT ON COLUMN public.offer_products.extension_price_net_per_hour IS
  'Bazowy koszt netto każdej rozpoczętej dodatkowej godziny usługi.';
COMMENT ON COLUMN public.offer_product_variants.service_duration_hours IS
  'Opcjonalne nadpisanie czasu usługi dla wariantu; NULL oznacza dziedziczenie produktu.';
COMMENT ON COLUMN public.offer_product_variants.extension_price_net_per_hour IS
  'Opcjonalne nadpisanie kosztu dodatkowej godziny dla wariantu; NULL oznacza dziedziczenie produktu.';

-- DJ Eventowy jest usługą sześciogodzinną. Ceny przedłużenia pozostają do uzupełnienia,
-- ponieważ mogą różnić się pomiędzy wariantami Standard, Premium i VIP.
UPDATE public.offer_products
SET service_duration_hours = 6
WHERE id = '00f4e2f5-baae-4222-a19d-9030452ddf3a'::uuid
  AND service_duration_hours IS NULL;

NOTIFY pgrst, 'reload schema';
