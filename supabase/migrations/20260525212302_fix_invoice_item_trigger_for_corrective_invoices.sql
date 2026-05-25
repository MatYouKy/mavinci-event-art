/*
  # Fix invoice item calculation trigger for corrective invoices

  1. Changes
    - Updated `calculate_invoice_item_values()` function
    - When `before_quantity` is NOT NULL (corrective invoice item),
      computes value_net/vat_amount/value_gross as the DELTA:
      delta = (after_quantity * after_price_net) - (before_quantity * before_price_net)
    - Also auto-populates after_value_net, after_vat_amount, after_value_gross
      and before_value_net, before_vat_amount, before_value_gross
    - For regular items (before_quantity IS NULL), behavior unchanged:
      value_net = quantity * price_net

  2. Important Notes
    - This ensures invoice totals (sum of value_net) represent the correction amount (delta)
    - The "Do zapłaty" on corrective invoices will now correctly show the difference
    - quantity/price_net on corrective items store the "after" values for reference
*/

CREATE OR REPLACE FUNCTION calculate_invoice_item_values()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.before_quantity IS NOT NULL AND NEW.before_price_net IS NOT NULL THEN
    -- Corrective invoice item: compute delta (after - before)
    DECLARE
      v_before_net numeric(12,2);
      v_before_vat numeric(12,2);
      v_before_gross numeric(12,2);
      v_after_net numeric(12,2);
      v_after_vat numeric(12,2);
      v_after_gross numeric(12,2);
    BEGIN
      v_before_net := NEW.before_quantity * NEW.before_price_net;
      v_before_vat := ROUND(v_before_net * NEW.vat_rate / 100.0, 2);
      v_before_gross := v_before_net + v_before_vat;

      v_after_net := COALESCE(NEW.after_quantity, NEW.before_quantity) * COALESCE(NEW.after_price_net, NEW.before_price_net);
      v_after_vat := ROUND(v_after_net * NEW.vat_rate / 100.0, 2);
      v_after_gross := v_after_net + v_after_vat;

      -- Store before/after computed values
      NEW.before_value_net := v_before_net;
      NEW.before_vat_amount := v_before_vat;
      NEW.before_value_gross := v_before_gross;
      NEW.after_value_net := v_after_net;
      NEW.after_vat_amount := v_after_vat;
      NEW.after_value_gross := v_after_gross;

      -- Main columns store the DELTA (correction amount)
      NEW.value_net := v_after_net - v_before_net;
      NEW.vat_amount := v_after_vat - v_before_vat;
      NEW.value_gross := v_after_gross - v_before_gross;

      -- quantity/price_net store "after" values for reference
      NEW.quantity := COALESCE(NEW.after_quantity, NEW.before_quantity);
      NEW.price_net := COALESCE(NEW.after_price_net, NEW.before_price_net);
    END;
  ELSE
    -- Regular invoice item
    NEW.value_net := NEW.quantity * NEW.price_net;
    NEW.vat_amount := ROUND(NEW.value_net * NEW.vat_rate / 100.0, 2);
    NEW.value_gross := NEW.value_net + NEW.vat_amount;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger to fire on all relevant columns including before/after
DROP TRIGGER IF EXISTS trigger_calculate_invoice_item_values ON invoice_items;
CREATE TRIGGER trigger_calculate_invoice_item_values
BEFORE INSERT OR UPDATE OF quantity, price_net, vat_rate, before_quantity, before_price_net, after_quantity, after_price_net ON invoice_items
FOR EACH ROW
EXECUTE FUNCTION calculate_invoice_item_values();
