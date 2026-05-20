/*
  # Add depreciation rate to equipment items

  1. Modified Tables
    - `equipment_items`
      - `depreciation_rate` (numeric) - Annual depreciation rate as percentage (default 10%)

  2. Notes
    - Default value is 10 (meaning 10% per year)
    - Current value will be calculated in the frontend based on:
      purchase_price * (1 - depreciation_rate/100) ^ years_since_purchase
    - The existing `current_value` column remains for manual override if needed
*/

ALTER TABLE equipment_items
ADD COLUMN IF NOT EXISTS depreciation_rate numeric DEFAULT 10;

COMMENT ON COLUMN equipment_items.depreciation_rate IS 'Roczna stawka amortyzacji w procentach (domyślnie 10%)';
