-- Dostęp do produktu/wariantu wymaga zapisanego is_available = true.
-- Brak wpisu oznacza brak dostępu, również dla nowych sprzedawców i produktów.
-- Zachowujemy istniejące wpisy, ceny, uprawnienia oraz zabezpieczenia RPC.
BEGIN;

ALTER TABLE public.sales_partner_product_prices
  ALTER COLUMN is_available SET DEFAULT false;

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
    COALESCE(individual.is_available, false),
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
      product.offer_image_path,
      product.pdf_thumbnail_url,
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
      COALESCE(variant.offer_image_path, product.offer_image_path),
      product.pdf_thumbnail_url,
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
    'offer_image_path', catalog.offer_image_path,
    'pdf_thumbnail_url', catalog.pdf_thumbnail_url,
    'unit', catalog.unit,
    'category_id', catalog.category_id,
    'category_name', category.name,
    'direct_price_net', catalog.direct_price,
    'default_price_net', round(catalog.direct_price * 1.20, 2),
    'price_net', individual.price_net,
    'effective_price_net', round(COALESCE(individual.price_net, catalog.direct_price * 1.20), 2),
    'is_available', COALESCE(individual.is_available, false),
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
    'access_policy', 'explicit_grant',
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
      is_available = COALESCE((v_item ->> 'is_available')::boolean, false),
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
        COALESCE((v_item ->> 'is_available')::boolean, false),
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


NOTIFY pgrst, 'reload schema';
COMMIT;
