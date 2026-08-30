/*
  # Optional offer product variants

  A catalog product may expose up to three client-facing variants. The chosen
  variant is stored on the offer item, while price/name/description remain
  snapshots on offer_items for stable calculations and historical offers.
*/

CREATE TABLE IF NOT EXISTS public.offer_product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.offer_products(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  short_description text,
  description text,
  benefits text[] NOT NULL DEFAULT '{}',
  price_net numeric(10, 2) NOT NULL DEFAULT 0 CHECK (price_net >= 0),
  price_gross numeric(10, 2) NOT NULL DEFAULT 0 CHECK (price_gross >= 0),
  is_recommended boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  display_order smallint NOT NULL DEFAULT 0 CHECK (display_order BETWEEN 0 AND 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, name)
);

CREATE INDEX IF NOT EXISTS idx_offer_product_variants_product
  ON public.offer_product_variants(product_id, display_order);

ALTER TABLE public.offer_items
  ADD COLUMN IF NOT EXISTS product_variant_id uuid
    REFERENCES public.offer_product_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_offer_items_product_variant
  ON public.offer_items(product_variant_id);

CREATE OR REPLACE FUNCTION public.enforce_offer_product_variant_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  variant_count integer;
BEGIN
  SELECT count(*)
    INTO variant_count
  FROM public.offer_product_variants
  WHERE product_id = NEW.product_id
    AND id <> NEW.id;

  IF variant_count >= 3 THEN
    RAISE EXCEPTION 'Produkt może mieć maksymalnie 3 warianty';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_offer_product_variant_limit
  ON public.offer_product_variants;
CREATE TRIGGER trg_enforce_offer_product_variant_limit
  BEFORE INSERT OR UPDATE OF product_id
  ON public.offer_product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_offer_product_variant_limit();

DROP TRIGGER IF EXISTS trg_offer_product_variants_updated_at
  ON public.offer_product_variants;
CREATE TRIGGER trg_offer_product_variants_updated_at
  BEFORE UPDATE ON public.offer_product_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.offer_product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view product variants"
  ON public.offer_product_variants FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Managers can manage product variants"
  ON public.offer_product_variants FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees
      WHERE employees.id = auth.uid()
        AND (employees.role = 'admin' OR 'offers_manage' = ANY(employees.permissions))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees
      WHERE employees.id = auth.uid()
        AND (employees.role = 'admin' OR 'offers_manage' = ANY(employees.permissions))
    )
  );

COMMENT ON TABLE public.offer_product_variants IS
  'Opcjonalne warianty produktu widoczne razem na jednej stronie oferty PDF (maksymalnie 3).';
COMMENT ON COLUMN public.offer_items.product_variant_id IS
  'Wariant wybrany do kalkulacji; unit_price i opis w offer_items pozostają snapshotem.';
