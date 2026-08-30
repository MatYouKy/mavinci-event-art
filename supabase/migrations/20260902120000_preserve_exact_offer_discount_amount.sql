-- Rabat całej oferty jest zapisywany jako dokładna kwota. Procent pozostaje
-- informacją prezentacyjną i nie może ponownie zmieniać wpisanej ceny końcowej.
CREATE OR REPLACE FUNCTION public.calculate_offer_totals(offer_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_subtotal numeric(12, 2) := 0;
  v_total_cost numeric(12, 2) := 0;
  v_saved_discount_amount numeric(12, 2) := 0;
  v_saved_discount_percent numeric(7, 4) := 0;
  v_discount_amount numeric(12, 2) := 0;
  v_discount_percent numeric(7, 4) := 0;
  v_tax_percent numeric(5, 2) := 23;
  v_tax_amount numeric(12, 2) := 0;
  v_total_amount numeric(12, 2) := 0;
BEGIN
  SELECT
    COALESCE(discount_amount, 0),
    COALESCE(discount_percent, 0),
    COALESCE(tax_percent, 23)
  INTO
    v_saved_discount_amount,
    v_saved_discount_percent,
    v_tax_percent
  FROM public.offers
  WHERE id = offer_uuid;

  SELECT
    COALESCE(SUM(COALESCE(total, 0)), 0),
    COALESCE(SUM(COALESCE(unit_cost, 0) * COALESCE(quantity, 0)), 0)
  INTO v_subtotal, v_total_cost
  FROM public.offer_items
  WHERE offer_id = offer_uuid;

  IF v_saved_discount_amount > 0 THEN
    v_discount_amount := LEAST(v_subtotal, v_saved_discount_amount);
  ELSE
    v_discount_amount := LEAST(
      v_subtotal,
      ROUND(v_subtotal * v_saved_discount_percent / 100, 2)
    );
  END IF;

  v_discount_percent := CASE
    WHEN v_subtotal > 0 THEN v_discount_amount / v_subtotal * 100
    ELSE 0
  END;
  v_tax_amount := ROUND((v_subtotal - v_discount_amount) * v_tax_percent / 100, 2);
  v_total_amount := ROUND(v_subtotal - v_discount_amount + v_tax_amount, 2);

  UPDATE public.offers
  SET
    subtotal = v_subtotal,
    discount_percent = v_discount_percent,
    discount_amount = v_discount_amount,
    tax_amount = v_tax_amount,
    total_amount = v_total_amount,
    total_cost = v_total_cost,
    margin_amount = v_total_amount - v_total_cost,
    margin_percent = CASE
      WHEN v_total_amount > 0
        THEN (v_total_amount - v_total_cost) / v_total_amount * 100
      ELSE 0
    END
  WHERE id = offer_uuid;
END;
$$;
