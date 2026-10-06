/*
  # Indywidualny cennik każdego sprzedawcy

  Nie ma cenników regionalnych ani dziedziczenia między sprzedawcami.
  Każdy sprzedawca i każda marka mają własną kartę cenową. Jeżeli pozycja
  nie została zmieniona w CRM, jej cena wynosi cenę katalogową MAVINCI + 20%.
  Sprzedawca otrzymuje wyłącznie cenę wynikową oraz jawnie udostępnione
  wymagania handlowe. Nie otrzymuje ceny katalogowej, kosztów ani marży.
*/

CREATE TABLE IF NOT EXISTS public.sales_partner_product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_partner_id uuid NOT NULL REFERENCES public.sales_partner_profiles(id) ON DELETE CASCADE,
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.offer_products(id) ON DELETE CASCADE,
  product_variant_id uuid REFERENCES public.offer_product_variants(id) ON DELETE CASCADE,
  price_net numeric(12,2) CHECK (price_net IS NULL OR price_net >= 0),
  is_available boolean NOT NULL DEFAULT true,
  requires_accommodation boolean NOT NULL DEFAULT false,
  accommodation_note text,
  estimated_logistics_cost numeric(12,2)
    CHECK (estimated_logistics_cost IS NULL OR estimated_logistics_cost >= 0),
  logistics_note text,
  additional_requirements text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_partner_base_product_price
  ON public.sales_partner_product_prices(sales_partner_id, my_company_id, product_id)
  WHERE product_variant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_partner_variant_price
  ON public.sales_partner_product_prices(sales_partner_id, my_company_id, product_id, product_variant_id)
  WHERE product_variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_partner_product_prices_owner
  ON public.sales_partner_product_prices(sales_partner_id, my_company_id);

DROP TRIGGER IF EXISTS trg_sales_partner_product_prices_updated_at
  ON public.sales_partner_product_prices;
CREATE TRIGGER trg_sales_partner_product_prices_updated_at
BEFORE UPDATE ON public.sales_partner_product_prices
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.validate_sales_partner_product_price_variant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.product_variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.offer_product_variants variant
    WHERE variant.id = NEW.product_variant_id
      AND variant.product_id = NEW.product_id
  ) THEN
    RAISE EXCEPTION 'Wariant nie należy do wybranego produktu';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_sales_partner_product_price_variant
  ON public.sales_partner_product_prices;
CREATE TRIGGER trg_validate_sales_partner_product_price_variant
BEFORE INSERT OR UPDATE OF product_id, product_variant_id
ON public.sales_partner_product_prices
FOR EACH ROW EXECUTE FUNCTION public.validate_sales_partner_product_price_variant();

ALTER TABLE public.sales_partner_product_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_partner_product_prices_manage" ON public.sales_partner_product_prices;
CREATE POLICY "sales_partner_product_prices_manage"
  ON public.sales_partner_product_prices FOR ALL TO authenticated
  USING (
    public.current_employee_can_access_company(my_company_id)
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = public.current_employee_id()
        AND (
          employee.role = 'admin'
          OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'contacts_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'offers_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'finances_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  )
  WITH CHECK (
    public.current_employee_can_access_company(my_company_id)
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = public.current_employee_id()
        AND (
          employee.role = 'admin'
          OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'contacts_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'offers_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'finances_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_partner_product_prices TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_seller_product_price(
  p_sales_partner_id uuid,
  p_company_id uuid,
  p_product_id uuid,
  p_product_variant_id uuid DEFAULT NULL
)
RETURNS TABLE (
  price_net numeric,
  is_available boolean,
  requires_accommodation boolean,
  accommodation_note text,
  estimated_logistics_cost numeric,
  logistics_note text,
  additional_requirements text,
  price_source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH catalog_price AS (
    SELECT CASE
      WHEN p_product_variant_id IS NULL THEN product.base_price
      ELSE variant.price_net
    END::numeric AS direct_price
    FROM public.offer_products product
    LEFT JOIN public.offer_product_variants variant
      ON variant.id = p_product_variant_id
     AND variant.product_id = product.id
    WHERE product.id = p_product_id
      AND (p_product_variant_id IS NULL OR variant.id IS NOT NULL)
  ), individual AS (
    SELECT price.*
    FROM public.sales_partner_product_prices price
    WHERE price.sales_partner_id = p_sales_partner_id
      AND price.my_company_id = p_company_id
      AND price.product_id = p_product_id
      AND price.product_variant_id IS NOT DISTINCT FROM p_product_variant_id
    LIMIT 1
  )
  SELECT
    round(COALESCE(individual.price_net, catalog_price.direct_price * 1.20), 2),
    COALESCE(individual.is_available, true),
    COALESCE(individual.requires_accommodation, false),
    individual.accommodation_note,
    individual.estimated_logistics_cost,
    individual.logistics_note,
    individual.additional_requirements,
    CASE WHEN individual.price_net IS NULL THEN 'default_plus_20' ELSE 'individual' END
  FROM catalog_price
  LEFT JOIN individual ON true;
$$;

REVOKE ALL ON FUNCTION public.resolve_seller_product_price(uuid, uuid, uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_sales_partner_price_list(
  p_sales_partner_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_manage boolean;
  v_items jsonb;
BEGIN
  SELECT public.current_employee_can_access_company(p_company_id)
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = public.current_employee_id()
        AND (
          employee.role = 'admin'
          OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'contacts_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'offers_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'finances_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  INTO v_can_manage;

  IF NOT COALESCE(v_can_manage, false) THEN
    RAISE EXCEPTION 'Brak uprawnień do cennika sprzedawcy';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sales_partner_brand_terms term
    WHERE term.sales_partner_id = p_sales_partner_id
      AND term.my_company_id = p_company_id
      AND term.is_active = true
  ) THEN
    RAISE EXCEPTION 'Sprzedawca nie ma aktywnego dostępu do tej marki';
  END IF;

  WITH catalog AS (
    SELECT
      product.id AS product_id,
      NULL::uuid AS product_variant_id,
      product.name AS product_name,
      NULL::text AS variant_name,
      product.base_price::numeric AS direct_price,
      product.unit,
      product.category_id,
      product.display_order AS product_order,
      -1::integer AS variant_order
    FROM public.offer_products product
    WHERE product.is_active = true
      AND product.partner_portal_visible = true

    UNION ALL

    SELECT
      product.id,
      variant.id,
      product.name,
      variant.name,
      variant.price_net::numeric,
      product.unit,
      product.category_id,
      product.display_order,
      variant.display_order
    FROM public.offer_products product
    JOIN public.offer_product_variants variant ON variant.product_id = product.id
    WHERE product.is_active = true
      AND product.partner_portal_visible = true
      AND variant.is_active = true
      AND variant.partner_portal_visible = true
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', catalog.product_id,
    'product_variant_id', catalog.product_variant_id,
    'product_name', catalog.product_name,
    'variant_name', catalog.variant_name,
    'unit', catalog.unit,
    'category_id', catalog.category_id,
    'category_name', category.name,
    'direct_price_net', catalog.direct_price,
    'default_price_net', round(catalog.direct_price * 1.20, 2),
    'price_net', individual.price_net,
    'effective_price_net', round(COALESCE(individual.price_net, catalog.direct_price * 1.20), 2),
    'is_available', COALESCE(individual.is_available, true),
    'requires_accommodation', COALESCE(individual.requires_accommodation, false),
    'accommodation_note', individual.accommodation_note,
    'estimated_logistics_cost', individual.estimated_logistics_cost,
    'logistics_note', individual.logistics_note,
    'additional_requirements', individual.additional_requirements
  ) ORDER BY catalog.product_order, catalog.product_name, catalog.variant_order), '[]'::jsonb)
  INTO v_items
  FROM catalog
  LEFT JOIN public.event_categories category ON category.id = catalog.category_id
  LEFT JOIN public.sales_partner_product_prices individual
    ON individual.sales_partner_id = p_sales_partner_id
   AND individual.my_company_id = p_company_id
   AND individual.product_id = catalog.product_id
   AND individual.product_variant_id IS NOT DISTINCT FROM catalog.product_variant_id;

  RETURN jsonb_build_object(
    'sales_partner_id', p_sales_partner_id,
    'my_company_id', p_company_id,
    'default_markup_percent', 20,
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_sales_partner_price_list(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_partner_price_list(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_sales_partner_price_list(
  p_sales_partner_id uuid,
  p_company_id uuid,
  p_items jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_manage boolean;
  v_item jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_updated integer;
BEGIN
  SELECT public.current_employee_can_access_company(p_company_id)
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = public.current_employee_id()
        AND (
          employee.role = 'admin'
          OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'contacts_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'offers_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'finances_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  INTO v_can_manage;

  IF NOT COALESCE(v_can_manage, false) THEN
    RAISE EXCEPTION 'Brak uprawnień do zapisu cennika sprzedawcy';
  END IF;

  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Pozycje cennika muszą być tablicą';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sales_partner_brand_terms term
    WHERE term.sales_partner_id = p_sales_partner_id
      AND term.my_company_id = p_company_id
      AND term.is_active = true
  ) THEN
    RAISE EXCEPTION 'Sprzedawca nie ma aktywnego dostępu do tej marki';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    v_product_id := NULLIF(v_item ->> 'product_id', '')::uuid;
    v_variant_id := NULLIF(v_item ->> 'product_variant_id', '')::uuid;

    IF v_product_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.offer_products product WHERE product.id = v_product_id
    ) THEN
      RAISE EXCEPTION 'Nieprawidłowy produkt w cenniku';
    END IF;

    IF v_variant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.offer_product_variants variant
      WHERE variant.id = v_variant_id AND variant.product_id = v_product_id
    ) THEN
      RAISE EXCEPTION 'Nieprawidłowy wariant w cenniku';
    END IF;

    UPDATE public.sales_partner_product_prices price
    SET
      price_net = NULLIF(v_item ->> 'price_net', '')::numeric,
      is_available = COALESCE((v_item ->> 'is_available')::boolean, true),
      requires_accommodation = COALESCE((v_item ->> 'requires_accommodation')::boolean, false),
      accommodation_note = NULLIF(btrim(v_item ->> 'accommodation_note'), ''),
      estimated_logistics_cost = NULLIF(v_item ->> 'estimated_logistics_cost', '')::numeric,
      logistics_note = NULLIF(btrim(v_item ->> 'logistics_note'), ''),
      additional_requirements = NULLIF(btrim(v_item ->> 'additional_requirements'), '')
    WHERE price.sales_partner_id = p_sales_partner_id
      AND price.my_company_id = p_company_id
      AND price.product_id = v_product_id
      AND price.product_variant_id IS NOT DISTINCT FROM v_variant_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      INSERT INTO public.sales_partner_product_prices (
        sales_partner_id, my_company_id, product_id, product_variant_id,
        price_net, is_available, requires_accommodation, accommodation_note,
        estimated_logistics_cost, logistics_note, additional_requirements
      ) VALUES (
        p_sales_partner_id,
        p_company_id,
        v_product_id,
        v_variant_id,
        NULLIF(v_item ->> 'price_net', '')::numeric,
        COALESCE((v_item ->> 'is_available')::boolean, true),
        COALESCE((v_item ->> 'requires_accommodation')::boolean, false),
        NULLIF(btrim(v_item ->> 'accommodation_note'), ''),
        NULLIF(v_item ->> 'estimated_logistics_cost', '')::numeric,
        NULLIF(btrim(v_item ->> 'logistics_note'), ''),
        NULLIF(btrim(v_item ->> 'additional_requirements'), '')
      );
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.save_sales_partner_price_list(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_sales_partner_price_list(uuid, uuid, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.get_seller_portal_catalog();
CREATE OR REPLACE FUNCTION public.get_seller_portal_catalog(p_company_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_id uuid := public.current_sales_partner_id();
  v_company_id uuid := p_company_id;
  v_catalog jsonb;
BEGIN
  IF v_partner_id IS NULL THEN RETURN NULL; END IF;

  IF v_company_id IS NULL THEN
    SELECT term.my_company_id INTO v_company_id
    FROM public.sales_partner_brand_terms term
    WHERE term.sales_partner_id = v_partner_id AND term.is_active = true
    ORDER BY term.created_at
    LIMIT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sales_partner_brand_terms term
    WHERE term.sales_partner_id = v_partner_id
      AND term.my_company_id = v_company_id
      AND term.is_active = true
  ) THEN
    RAISE EXCEPTION 'Marka nie jest przypisana do sprzedawcy';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', product.id,
    'name', product.name,
    'description', product.description,
    'offer_short_description', product.offer_short_description,
    'offer_description', product.offer_description,
    'offer_image_path', product.offer_image_path,
    'base_price', CASE WHEN base_rate.is_available THEN base_rate.price_net ELSE NULL END,
    'unit', product.unit,
    'category_id', product.category_id,
    'category', jsonb_build_object('id', category.id, 'name', category.name),
    'pricing_requirements', CASE WHEN base_rate.is_available THEN jsonb_build_object(
      'requires_accommodation', base_rate.requires_accommodation,
      'accommodation_note', base_rate.accommodation_note,
      'logistics_note', base_rate.logistics_note,
      'additional_requirements', base_rate.additional_requirements
    ) ELSE NULL END,
    'variants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', variant.id,
        'name', variant.name,
        'description', variant.description,
        'short_description', variant.short_description,
        'price_net', variant_rate.price_net,
        'offer_image_path', variant.offer_image_path,
        'pricing_requirements', jsonb_build_object(
          'requires_accommodation', variant_rate.requires_accommodation,
          'accommodation_note', variant_rate.accommodation_note,
          'logistics_note', variant_rate.logistics_note,
          'additional_requirements', variant_rate.additional_requirements
        )
      ) ORDER BY variant.display_order)
      FROM public.offer_product_variants variant
      CROSS JOIN LATERAL public.resolve_seller_product_price(
        v_partner_id, v_company_id, product.id, variant.id
      ) variant_rate
      WHERE variant.product_id = product.id
        AND variant.is_active = true
        AND variant.partner_portal_visible = true
        AND variant_rate.is_available = true
    ), '[]'::jsonb)
  ) ORDER BY product.display_order), '[]'::jsonb)
  INTO v_catalog
  FROM public.offer_products product
  LEFT JOIN public.event_categories category ON category.id = product.category_id
  CROSS JOIN LATERAL public.resolve_seller_product_price(
    v_partner_id, v_company_id, product.id, NULL
  ) base_rate
  WHERE product.is_active = true
    AND product.partner_portal_visible = true
    AND (
      base_rate.is_available = true
      OR EXISTS (
        SELECT 1
        FROM public.offer_product_variants variant
        CROSS JOIN LATERAL public.resolve_seller_product_price(
          v_partner_id, v_company_id, product.id, variant.id
        ) variant_rate
        WHERE variant.product_id = product.id
          AND variant.is_active = true
          AND variant.partner_portal_visible = true
          AND variant_rate.is_available = true
      )
    );

  RETURN v_catalog;
END;
$$;

REVOKE ALL ON FUNCTION public.get_seller_portal_catalog(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_seller_portal_catalog(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_seller_portal_product(
  p_product_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_id uuid := public.current_sales_partner_id();
  v_product jsonb;
BEGIN
  IF v_partner_id IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.sales_partner_brand_terms term
    WHERE term.sales_partner_id = v_partner_id
      AND term.my_company_id = p_company_id
      AND term.is_active = true
  ) THEN
    RAISE EXCEPTION 'Marka nie jest przypisana do sprzedawcy';
  END IF;

  SELECT jsonb_build_object(
    'id', product.id,
    'name', product.name,
    'unit', product.unit,
    'category', jsonb_build_object('id', category.id, 'name', category.name),
    'description', product.description,
    'offer_short_description', product.offer_short_description,
    'offer_description', product.offer_description,
    'offer_benefits', COALESCE(product.offer_benefits, '[]'::jsonb),
    'offer_requirements', COALESCE(product.offer_requirements, '[]'::jsonb),
    'offer_additional_requirements', COALESCE(product.offer_additional_requirements, '[]'::jsonb),
    'recommended_contract_clauses', product.recommended_contract_clauses,
    'recommended_contract_clause_category', product.recommended_contract_clause_category,
    'product_page_url', product.product_page_url,
    'offer_image_path', product.offer_image_path,
    'offer_image_alt', product.offer_image_alt,
    'offer_image_position_x', product.offer_image_position_x,
    'offer_image_position_y', product.offer_image_position_y,
    'offer_image_zoom', product.offer_image_zoom,
    'base_price', CASE WHEN base_rate.is_available THEN base_rate.price_net ELSE NULL END,
    'pricing_requirements', CASE WHEN base_rate.is_available THEN jsonb_build_object(
      'requires_accommodation', base_rate.requires_accommodation,
      'accommodation_note', base_rate.accommodation_note,
      'logistics_note', base_rate.logistics_note,
      'additional_requirements', base_rate.additional_requirements
    ) ELSE NULL END,
    'gallery_paths', COALESCE((
      SELECT jsonb_agg(image.path ORDER BY image.display_order)
      FROM (
        SELECT product.offer_image_path AS path, -1 AS display_order
        WHERE product.offer_image_path IS NOT NULL
        UNION ALL
        SELECT variant.offer_image_path, variant.display_order
        FROM public.offer_product_variants variant
        WHERE variant.product_id = product.id
          AND variant.is_active = true
          AND variant.partner_portal_visible = true
          AND variant.offer_image_path IS NOT NULL
      ) image
    ), '[]'::jsonb),
    'variants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', variant.id,
        'name', variant.name,
        'short_description', variant.short_description,
        'description', variant.description,
        'benefits', to_jsonb(variant.benefits),
        'offer_image_path', variant.offer_image_path,
        'offer_image_alt', variant.offer_image_alt,
        'price_net', variant_rate.price_net,
        'recommended_contract_clauses', variant.recommended_contract_clauses,
        'recommended_contract_clause_category', variant.recommended_contract_clause_category,
        'pricing_requirements', jsonb_build_object(
          'requires_accommodation', variant_rate.requires_accommodation,
          'accommodation_note', variant_rate.accommodation_note,
          'logistics_note', variant_rate.logistics_note,
          'additional_requirements', variant_rate.additional_requirements
        )
      ) ORDER BY variant.display_order)
      FROM public.offer_product_variants variant
      CROSS JOIN LATERAL public.resolve_seller_product_price(
        v_partner_id, p_company_id, product.id, variant.id
      ) variant_rate
      WHERE variant.product_id = product.id
        AND variant.is_active = true
        AND variant.partner_portal_visible = true
        AND variant_rate.is_available = true
    ), '[]'::jsonb)
  )
  INTO v_product
  FROM public.offer_products product
  LEFT JOIN public.event_categories category ON category.id = product.category_id
  CROSS JOIN LATERAL public.resolve_seller_product_price(
    v_partner_id, p_company_id, product.id, NULL
  ) base_rate
  WHERE product.id = p_product_id
    AND product.is_active = true
    AND product.partner_portal_visible = true
    AND (
      base_rate.is_available = true
      OR EXISTS (
        SELECT 1
        FROM public.offer_product_variants variant
        CROSS JOIN LATERAL public.resolve_seller_product_price(
          v_partner_id, p_company_id, product.id, variant.id
        ) variant_rate
        WHERE variant.product_id = product.id
          AND variant.is_active = true
          AND variant.partner_portal_visible = true
          AND variant_rate.is_available = true
      )
    );

  RETURN v_product;
END;
$$;

REVOKE ALL ON FUNCTION public.get_seller_portal_product(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_seller_portal_product(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_individual_seller_price_to_offer_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer record;
  v_rate record;
BEGIN
  SELECT offer_row.sales_channel, offer_row.sales_partner_id, offer_row.my_company_id,
         offer_row.commercial_model
  INTO v_offer
  FROM public.offers offer_row
  WHERE offer_row.id = NEW.offer_id;

  IF v_offer.sales_channel <> 'seller_portal'
     OR NEW.is_partner_custom
     OR NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_rate
  FROM public.resolve_seller_product_price(
    v_offer.sales_partner_id,
    v_offer.my_company_id,
    NEW.product_id,
    NEW.product_variant_id
  );

  IF NOT FOUND OR NOT COALESCE(v_rate.is_available, false) THEN
    RAISE EXCEPTION 'Produkt nie jest dostępny w cenniku tego sprzedawcy';
  END IF;

  NEW.base_partner_unit_price := v_rate.price_net;
  NEW.unit_cost := v_rate.price_net;
  IF v_offer.commercial_model = 'commission' THEN
    NEW.client_unit_price := v_rate.price_net;
    NEW.unit_price := v_rate.price_net;
  ELSE
    NEW.client_unit_price := GREATEST(COALESCE(NEW.client_unit_price, 0), 0);
    NEW.unit_price := NEW.client_unit_price;
  END IF;
  NEW.partner_margin_amount := (NEW.client_unit_price - v_rate.price_net) * COALESCE(NEW.quantity, 1);
  NEW.requires_internal_approval := COALESCE(NEW.requires_internal_approval, false)
    OR NEW.client_unit_price < v_rate.price_net;
  NEW.partner_source_snapshot := COALESCE(NEW.partner_source_snapshot, '{}'::jsonb) || jsonb_build_object(
    'seller_price_net', v_rate.price_net,
    'seller_price_source', v_rate.price_source,
    'requires_accommodation', v_rate.requires_accommodation,
    'accommodation_note', v_rate.accommodation_note,
    'logistics_note', v_rate.logistics_note,
    'additional_requirements', v_rate.additional_requirements,
    'captured_at', now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_individual_seller_price_to_offer_item ON public.offer_items;
CREATE TRIGGER trg_apply_individual_seller_price_to_offer_item
BEFORE INSERT OR UPDATE OF product_id, product_variant_id, client_unit_price, quantity
ON public.offer_items
FOR EACH ROW EXECUTE FUNCTION public.apply_individual_seller_price_to_offer_item();

CREATE OR REPLACE FUNCTION public.recalculate_individual_seller_offer_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer_id uuid := COALESCE(NEW.offer_id, OLD.offer_id);
  v_offer record;
  v_base numeric := 0;
  v_client numeric := 0;
  v_requires_approval boolean := false;
  v_earnings numeric := 0;
BEGIN
  SELECT sales_channel, commercial_model, partner_commission_rate
  INTO v_offer
  FROM public.offers
  WHERE id = v_offer_id;

  IF v_offer.sales_channel <> 'seller_portal' THEN RETURN NULL; END IF;

  SELECT
    COALESCE(sum(item.base_partner_unit_price * item.quantity), 0),
    COALESCE(sum(item.client_unit_price * item.quantity), 0),
    COALESCE(bool_or(item.requires_internal_approval), false)
  INTO v_base, v_client, v_requires_approval
  FROM public.offer_items item
  WHERE item.offer_id = v_offer_id;

  v_earnings := CASE
    WHEN v_offer.commercial_model = 'commission'
      THEN round(v_client * COALESCE(v_offer.partner_commission_rate, 0) / 100, 2)
    ELSE v_client - v_base
  END;

  UPDATE public.offers SET
    partner_base_net = v_base,
    client_total_net = v_client,
    partner_earnings_amount = v_earnings,
    partner_commission_amount = CASE
      WHEN v_offer.commercial_model = 'commission' THEN v_earnings ELSE 0
    END,
    total_base_price = v_base,
    subtotal = v_client,
    tax_percent = 23,
    tax_amount = round(v_client * 0.23, 2),
    total_amount = round(v_client * 1.23, 2),
    total_final_price = round(v_client * 1.23, 2),
    requires_internal_approval = v_requires_approval,
    partner_approval_status = CASE WHEN v_requires_approval THEN 'required' ELSE 'not_required' END
  WHERE id = v_offer_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalculate_individual_seller_offer_totals ON public.offer_items;
CREATE CONSTRAINT TRIGGER trg_recalculate_individual_seller_offer_totals
AFTER INSERT OR UPDATE OR DELETE ON public.offer_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.recalculate_individual_seller_offer_totals();

COMMENT ON TABLE public.sales_partner_product_prices IS
  'Indywidualne ceny i wymagania produktu dla konkretnego sprzedawcy i marki. Brak ceny oznacza automatycznie cenę katalogową + 20%.';

NOTIFY pgrst, 'reload schema';
