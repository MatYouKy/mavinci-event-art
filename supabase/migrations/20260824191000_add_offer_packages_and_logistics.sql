/*
  # Offer-level packages and optional logistics

  Packages are alternatives, not additive offer lines. Each offer can expose up
  to three packages and highlight one recommended option (normally the middle).
*/

ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS package_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS logistics_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS logistics_price_net numeric(10, 2) NOT NULL DEFAULT 0
    CHECK (logistics_price_net >= 0),
  ADD COLUMN IF NOT EXISTS logistics_description text;

CREATE TABLE IF NOT EXISTS public.offer_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  description text,
  price_net numeric(10, 2) NOT NULL DEFAULT 0 CHECK (price_net >= 0),
  is_recommended boolean NOT NULL DEFAULT false,
  display_order smallint NOT NULL DEFAULT 0 CHECK (display_order BETWEEN 0 AND 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, name)
);

CREATE TABLE IF NOT EXISTS public.offer_package_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.offer_packages(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.offer_products(id) ON DELETE RESTRICT,
  product_variant_id uuid REFERENCES public.offer_product_variants(id) ON DELETE SET NULL,
  quantity numeric(10, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  display_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offer_packages_offer
  ON public.offer_packages(offer_id, display_order);
CREATE INDEX IF NOT EXISTS idx_offer_package_items_package
  ON public.offer_package_items(package_id, display_order);

CREATE OR REPLACE FUNCTION public.enforce_offer_package_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  package_count integer;
BEGIN
  SELECT count(*)
    INTO package_count
  FROM public.offer_packages
  WHERE offer_id = NEW.offer_id
    AND id <> NEW.id;

  IF package_count >= 3 THEN
    RAISE EXCEPTION 'Oferta może mieć maksymalnie 3 pakiety';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_offer_package_limit ON public.offer_packages;
CREATE TRIGGER trg_enforce_offer_package_limit
  BEFORE INSERT OR UPDATE OF offer_id ON public.offer_packages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_offer_package_limit();

DROP TRIGGER IF EXISTS trg_offer_packages_updated_at ON public.offer_packages;
CREATE TRIGGER trg_offer_packages_updated_at
  BEFORE UPDATE ON public.offer_packages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.offer_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_package_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees can view offer packages"
  ON public.offer_packages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.offers offer_row
      JOIN public.employees employee ON employee.id = auth.uid()
      WHERE offer_row.id = offer_packages.offer_id
        AND (
          employee.role = 'admin'
          OR 'offers_manage' = ANY(employee.permissions)
          OR offer_row.created_by = employee.id
        )
    )
  );

CREATE POLICY "Employees can manage offer packages"
  ON public.offer_packages FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.offers offer_row
      JOIN public.employees employee ON employee.id = auth.uid()
      WHERE offer_row.id = offer_packages.offer_id
        AND (
          employee.role = 'admin'
          OR 'offers_manage' = ANY(employee.permissions)
          OR (offer_row.created_by = employee.id AND offer_row.status = 'draft')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.offers offer_row
      JOIN public.employees employee ON employee.id = auth.uid()
      WHERE offer_row.id = offer_packages.offer_id
        AND (
          employee.role = 'admin'
          OR 'offers_manage' = ANY(employee.permissions)
          OR (offer_row.created_by = employee.id AND offer_row.status = 'draft')
        )
    )
  );

CREATE POLICY "Employees can view offer package items"
  ON public.offer_package_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.offer_packages package
      JOIN public.offers offer_row ON offer_row.id = package.offer_id
      JOIN public.employees employee ON employee.id = auth.uid()
      WHERE package.id = offer_package_items.package_id
        AND (
          employee.role = 'admin'
          OR 'offers_manage' = ANY(employee.permissions)
          OR offer_row.created_by = employee.id
        )
    )
  );

CREATE POLICY "Employees can manage offer package items"
  ON public.offer_package_items FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.offer_packages package
      JOIN public.offers offer_row ON offer_row.id = package.offer_id
      JOIN public.employees employee ON employee.id = auth.uid()
      WHERE package.id = offer_package_items.package_id
        AND (
          employee.role = 'admin'
          OR 'offers_manage' = ANY(employee.permissions)
          OR (offer_row.created_by = employee.id AND offer_row.status = 'draft')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.offer_packages package
      JOIN public.offers offer_row ON offer_row.id = package.offer_id
      JOIN public.employees employee ON employee.id = auth.uid()
      WHERE package.id = offer_package_items.package_id
        AND (
          employee.role = 'admin'
          OR 'offers_manage' = ANY(employee.permissions)
          OR (offer_row.created_by = employee.id AND offer_row.status = 'draft')
        )
    )
  );

COMMENT ON COLUMN public.offers.logistics_price_net IS
  'Opcjonalna kwota netto doliczana do każdej alternatywy pakietowej.';
