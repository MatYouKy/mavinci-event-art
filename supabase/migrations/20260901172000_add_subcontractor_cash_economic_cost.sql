/*
  Rzetelny koszt usług podwykonawców.

  Kwota wypłacona bez dokumentu kosztowego nie może być traktowana w raportach
  jak zwykły koszt netto. Dla wypłaty finansowanej z zysku po CIT i podatku od
  dywidendy zapisujemy osobno kwotę dla podwykonawcy i koszt ekonomiczny spółki.
*/

ALTER TABLE public.subcontractor_service_catalog
  ADD COLUMN IF NOT EXISTS settlement_method text NOT NULL DEFAULT 'invoice',
  ADD COLUMN IF NOT EXISTS cash_payout_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS cit_rate numeric(5, 2) NOT NULL DEFAULT 9.00,
  ADD COLUMN IF NOT EXISTS dividend_tax_rate numeric(5, 2) NOT NULL DEFAULT 19.00,
  ADD COLUMN IF NOT EXISTS is_tax_deductible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS economic_cost numeric(12, 2),
  ADD COLUMN IF NOT EXISTS tax_burden_amount numeric(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.subcontractor_service_catalog
  DROP CONSTRAINT IF EXISTS subcontractor_service_catalog_settlement_method_check,
  DROP CONSTRAINT IF EXISTS subcontractor_service_catalog_cash_payout_amount_check,
  DROP CONSTRAINT IF EXISTS subcontractor_service_catalog_cit_rate_check,
  DROP CONSTRAINT IF EXISTS subcontractor_service_catalog_dividend_tax_rate_check,
  DROP CONSTRAINT IF EXISTS subcontractor_service_catalog_economic_cost_check,
  DROP CONSTRAINT IF EXISTS subcontractor_service_catalog_tax_burden_amount_check;

ALTER TABLE public.subcontractor_service_catalog
  ADD CONSTRAINT subcontractor_service_catalog_settlement_method_check
    CHECK (settlement_method IN ('invoice', 'cash_documented', 'cash_non_deductible')),
  ADD CONSTRAINT subcontractor_service_catalog_cash_payout_amount_check
    CHECK (cash_payout_amount IS NULL OR cash_payout_amount >= 0),
  ADD CONSTRAINT subcontractor_service_catalog_cit_rate_check
    CHECK (cit_rate >= 0 AND cit_rate < 100),
  ADD CONSTRAINT subcontractor_service_catalog_dividend_tax_rate_check
    CHECK (dividend_tax_rate >= 0 AND dividend_tax_rate < 100),
  ADD CONSTRAINT subcontractor_service_catalog_economic_cost_check
    CHECK (economic_cost IS NULL OR economic_cost >= 0),
  ADD CONSTRAINT subcontractor_service_catalog_tax_burden_amount_check
    CHECK (tax_burden_amount >= 0);

CREATE OR REPLACE FUNCTION public.calculate_non_deductible_cash_economic_cost(
  p_cash_amount numeric,
  p_cit_rate numeric DEFAULT 9.00,
  p_dividend_tax_rate numeric DEFAULT 19.00
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN COALESCE(p_cash_amount, 0) <= 0 THEN 0::numeric
    WHEN (1 - COALESCE(p_cit_rate, 0) / 100) *
         (1 - COALESCE(p_dividend_tax_rate, 0) / 100) <= 0 THEN COALESCE(p_cash_amount, 0)
    ELSE ROUND(
      COALESCE(p_cash_amount, 0) /
      (
        (1 - COALESCE(p_cit_rate, 0) / 100) *
        (1 - COALESCE(p_dividend_tax_rate, 0) / 100)
      ),
      2
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.set_subcontractor_service_economic_cost()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_amount numeric;
BEGIN
  NEW.settlement_method := COALESCE(NEW.settlement_method, 'invoice');
  NEW.cit_rate := COALESCE(NEW.cit_rate, 9.00);
  NEW.dividend_tax_rate := COALESCE(NEW.dividend_tax_rate, 19.00);

  IF NEW.settlement_method = 'invoice' THEN
    NEW.cash_payout_amount := NULL;
    NEW.is_tax_deductible := true;
    NEW.economic_cost := ROUND(
      GREATEST(
        COALESCE(
          NEW.price_net,
          NEW.unit_price / NULLIF(1 + COALESCE(NEW.vat_rate, 0) / 100, 0),
          0
        ),
        0
      ),
      2
    );
    NEW.tax_burden_amount := 0;
    RETURN NEW;
  END IF;

  v_amount := GREATEST(
    COALESCE(NEW.cash_payout_amount, NEW.unit_price, NEW.price_gross, NEW.price_net, 0),
    0
  );

  NEW.cash_payout_amount := ROUND(v_amount, 2);
  NEW.unit_price := ROUND(v_amount, 2);
  NEW.vat_rate := 0;
  NEW.price_net := ROUND(v_amount, 2);
  NEW.price_gross := ROUND(v_amount, 2);

  IF NEW.settlement_method = 'cash_non_deductible' THEN
    NEW.is_tax_deductible := false;
    NEW.economic_cost := public.calculate_non_deductible_cash_economic_cost(
      v_amount,
      NEW.cit_rate,
      NEW.dividend_tax_rate
    );
    NEW.tax_burden_amount := ROUND(GREATEST(NEW.economic_cost - v_amount, 0), 2);
  ELSE
    NEW.is_tax_deductible := true;
    NEW.economic_cost := ROUND(v_amount, 2);
    NEW.tax_burden_amount := 0;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_subcontractor_service_economic_cost
  ON public.subcontractor_service_catalog;

CREATE TRIGGER trigger_set_subcontractor_service_economic_cost
  BEFORE INSERT OR UPDATE OF
    settlement_method,
    cash_payout_amount,
    cit_rate,
    dividend_tax_rate,
    unit_price,
    vat_rate,
    price_net,
    price_gross
  ON public.subcontractor_service_catalog
  FOR EACH ROW
  EXECUTE FUNCTION public.set_subcontractor_service_economic_cost();

UPDATE public.subcontractor_service_catalog
SET
  settlement_method = COALESCE(settlement_method, 'invoice'),
  economic_cost = COALESCE(
    economic_cost,
    price_net,
    unit_price / NULLIF(1 + COALESCE(vat_rate, 0) / 100, 0),
    0
  ),
  tax_burden_amount = COALESCE(tax_burden_amount, 0),
  is_tax_deductible = COALESCE(is_tax_deductible, true);

ALTER TABLE public.subcontractor_service_catalog
  ALTER COLUMN economic_cost SET DEFAULT 0,
  ALTER COLUMN economic_cost SET NOT NULL;

ALTER TABLE public.offer_products
  ADD COLUMN IF NOT EXISTS subcontractor_settlement_method text,
  ADD COLUMN IF NOT EXISTS subcontractor_economic_cost numeric(12, 2);

ALTER TABLE public.offer_products
  DROP CONSTRAINT IF EXISTS offer_products_subcontractor_settlement_method_check,
  DROP CONSTRAINT IF EXISTS offer_products_subcontractor_economic_cost_check;

ALTER TABLE public.offer_products
  ADD CONSTRAINT offer_products_subcontractor_settlement_method_check
    CHECK (
      subcontractor_settlement_method IS NULL OR
      subcontractor_settlement_method IN ('invoice', 'cash_documented', 'cash_non_deductible')
    ),
  ADD CONSTRAINT offer_products_subcontractor_economic_cost_check
    CHECK (subcontractor_economic_cost IS NULL OR subcontractor_economic_cost >= 0);

CREATE OR REPLACE FUNCTION public.sync_subcontractor_service_product_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.offer_products
  SET
    cost_net = NEW.economic_cost,
    cost_price = NEW.economic_cost,
    cost_gross = CASE
      WHEN NEW.settlement_method IN ('cash_documented', 'cash_non_deductible')
        THEN NEW.economic_cost
      ELSE COALESCE(NEW.price_gross, NEW.economic_cost)
    END,
    subcontractor_settlement_method = NEW.settlement_method,
    subcontractor_economic_cost = NEW.economic_cost
  WHERE subcontractor_service_catalog_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_subcontractor_service_product_cost
  ON public.subcontractor_service_catalog;

CREATE TRIGGER trigger_sync_subcontractor_service_product_cost
  AFTER INSERT OR UPDATE OF
    settlement_method,
    economic_cost,
    price_net,
    price_gross,
    unit_price
  ON public.subcontractor_service_catalog
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_subcontractor_service_product_cost();

UPDATE public.offer_products AS op
SET
  cost_net = ssc.economic_cost,
  cost_price = ssc.economic_cost,
  cost_gross = CASE
    WHEN ssc.settlement_method IN ('cash_documented', 'cash_non_deductible')
      THEN ssc.economic_cost
    ELSE COALESCE(ssc.price_gross, ssc.economic_cost)
  END,
  subcontractor_settlement_method = ssc.settlement_method,
  subcontractor_economic_cost = ssc.economic_cost
FROM public.subcontractor_service_catalog AS ssc
WHERE op.subcontractor_service_catalog_id = ssc.id;

CREATE OR REPLACE FUNCTION public.create_product_from_subcontractor_service(
  p_service_catalog_id uuid,
  p_category_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_service public.subcontractor_service_catalog%ROWTYPE;
  v_subcontractor public.subcontractors%ROWTYPE;
  v_product_id uuid;
BEGIN
  SELECT *
  INTO v_service
  FROM public.subcontractor_service_catalog
  WHERE id = p_service_catalog_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found';
  END IF;

  SELECT *
  INTO v_subcontractor
  FROM public.subcontractors
  WHERE id = v_service.subcontractor_id;

  INSERT INTO public.offer_products (
    category_id,
    name,
    description,
    base_price,
    price_net,
    price_gross,
    cost_price,
    cost_net,
    cost_gross,
    unit,
    is_subcontractor_service,
    subcontractor_service_catalog_id,
    subcontractor_id,
    subcontractor_settlement_method,
    subcontractor_economic_cost,
    tags,
    is_active
  ) VALUES (
    p_category_id,
    v_service.name || ' (' || v_subcontractor.company_name || ')',
    v_service.description,
    COALESCE(v_service.price_net, v_service.unit_price, 0),
    COALESCE(v_service.price_net, v_service.unit_price, 0),
    COALESCE(v_service.price_gross, v_service.unit_price, 0),
    COALESCE(v_service.economic_cost, v_service.price_net, v_service.unit_price, 0),
    COALESCE(v_service.economic_cost, v_service.price_net, v_service.unit_price, 0),
    CASE
      WHEN v_service.settlement_method IN ('cash_documented', 'cash_non_deductible')
        THEN COALESCE(v_service.economic_cost, v_service.unit_price, 0)
      ELSE COALESCE(v_service.price_gross, v_service.economic_cost, v_service.unit_price, 0)
    END,
    COALESCE(v_service.unit, 'szt'),
    true,
    p_service_catalog_id,
    v_service.subcontractor_id,
    v_service.settlement_method,
    v_service.economic_cost,
    ARRAY['podwykonawca', v_subcontractor.company_name],
    v_service.is_active
  )
  RETURNING id INTO v_product_id;

  RETURN v_product_id;
END;
$$;

COMMENT ON COLUMN public.subcontractor_service_catalog.settlement_method IS
  'invoice: faktura/rachunek; cash_documented: gotówka z dokumentem kosztowym; cash_non_deductible: gotówka poza KUP';
COMMENT ON COLUMN public.subcontractor_service_catalog.cash_payout_amount IS
  'Kwota, którą otrzymuje podwykonawca przy rozliczeniu gotówkowym';
COMMENT ON COLUMN public.subcontractor_service_catalog.economic_cost IS
  'Koszt używany w analizie rentowności; dla gotówki poza KUP uwzględnia finansowanie z zysku po CIT i podatku od dywidendy';
COMMENT ON COLUMN public.subcontractor_service_catalog.tax_burden_amount IS
  'Różnica między kosztem ekonomicznym a kwotą wypłaconą podwykonawcy';
COMMENT ON COLUMN public.offer_products.subcontractor_economic_cost IS
  'Koszt ekonomiczny skopiowany z powiązanej usługi podwykonawcy';

