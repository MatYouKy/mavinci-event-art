/*
  # Dodanie kosztów personelu do produktów oferty

  1. Zmiany w offer_products
    - Dodanie kolumny `staff_cost_net` - koszt personelu netto
    - Dodanie kolumny `staff_cost_gross` - koszt personelu brutto
    - Dodanie kolumny `staff_cost` - koszt personelu (deprecated, dla kompatybilności)
  
  2. Funkcja do obliczania kosztów personelu
    - Automatyczne obliczanie na podstawie `offer_product_staff`
  
  3. Uwagi
    - Koszty personelu są uwzględniane w total_cost produktu
    - Synchronizacja z event.estimated_costs uwzględnia te koszty
*/

-- Dodaj kolumny kosztów personelu do offer_products
ALTER TABLE offer_products
ADD COLUMN IF NOT EXISTS staff_cost numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS staff_cost_net numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS staff_cost_gross numeric DEFAULT 0;

COMMENT ON COLUMN offer_products.staff_cost IS 'Koszt personelu (deprecated, użyj staff_cost_net)';
COMMENT ON COLUMN offer_products.staff_cost_net IS 'Koszt personelu netto';
COMMENT ON COLUMN offer_products.staff_cost_gross IS 'Koszt personelu brutto';

-- Funkcja do obliczania kosztów personelu dla produktu
CREATE OR REPLACE FUNCTION calculate_product_staff_costs(p_product_id uuid)
RETURNS TABLE (
  staff_cost_net numeric,
  staff_cost_gross numeric
) AS $$
DECLARE
  v_staff_cost_net numeric := 0;
  v_staff_cost_gross numeric := 0;
  v_vat_rate numeric := 23; -- domyślna stawka VAT
BEGIN
  -- Pobierz stawkę VAT z produktu
  SELECT COALESCE(op.vat_rate, 23) INTO v_vat_rate
  FROM offer_products op
  WHERE op.id = p_product_id;
  
  -- Oblicz koszty personelu
  SELECT 
    COALESCE(SUM(
      CASE 
        WHEN ops.payment_type = 'cash' THEN 
          -- Gotówka: bez VAT
          ops.quantity * ops.hourly_rate * ops.estimated_hours
        WHEN ops.payment_type = 'invoice_no_vat' THEN 
          -- Faktura bez VAT
          ops.quantity * ops.hourly_rate * ops.estimated_hours
        ELSE 
          -- Faktura z VAT: koszt netto
          ops.quantity * ops.hourly_rate * ops.estimated_hours
      END
    ), 0) INTO v_staff_cost_net
  FROM offer_product_staff ops
  WHERE ops.product_id = p_product_id;
  
  -- Oblicz brutto (dla faktur z VAT dodaj VAT, dla reszty = netto)
  SELECT 
    COALESCE(SUM(
      CASE 
        WHEN ops.payment_type = 'cash' THEN 
          ops.quantity * ops.hourly_rate * ops.estimated_hours
        WHEN ops.payment_type = 'invoice_no_vat' THEN 
          ops.quantity * ops.hourly_rate * ops.estimated_hours
        ELSE 
          -- Faktura z VAT: dodaj VAT
          ops.quantity * ops.hourly_rate * ops.estimated_hours * (1 + v_vat_rate / 100)
      END
    ), 0) INTO v_staff_cost_gross
  FROM offer_product_staff ops
  WHERE ops.product_id = p_product_id;
  
  RETURN QUERY SELECT v_staff_cost_net, v_staff_cost_gross;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION calculate_product_staff_costs(uuid) TO authenticated;
COMMENT ON FUNCTION calculate_product_staff_costs IS 'Oblicza koszty personelu dla produktu na podstawie offer_product_staff';
