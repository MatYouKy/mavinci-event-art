/*
  # Fix recalculate_offer_totals function - wrong column name

  1. Problem
    - Function uses 'cost_price' but column is named 'unit_cost'
    - This causes "record has no field" error when adding offer items

  2. Solution
    - Update function to use correct column name 'unit_cost'
*/

CREATE OR REPLACE FUNCTION recalculate_offer_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_total_amount numeric;
  v_total_cost numeric;
  v_offer_id uuid;
BEGIN
  -- Determine which offer_id to update
  IF TG_OP = 'DELETE' THEN
    v_offer_id := OLD.offer_id;
  ELSE
    v_offer_id := NEW.offer_id;
  END IF;

  -- Calculate totals from all items in this offer
  SELECT
    COALESCE(SUM(unit_price * quantity), 0),
    COALESCE(SUM(unit_cost * quantity), 0)
  INTO v_total_amount, v_total_cost
  FROM offer_items
  WHERE offer_id = v_offer_id;

  -- Update the offer with new totals
  UPDATE offers
  SET
    total_amount = v_total_amount,
    total_cost = v_total_cost,
    updated_at = now()
  WHERE id = v_offer_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
