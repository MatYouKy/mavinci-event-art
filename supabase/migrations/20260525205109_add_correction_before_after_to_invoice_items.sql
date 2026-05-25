/*
  # Add before/after correction fields to invoice_items

  1. Modified Tables
    - `invoice_items`
      - `before_quantity` (numeric) - Original quantity from corrected invoice
      - `before_price_net` (numeric) - Original unit price from corrected invoice
      - `before_value_net` (numeric) - Original net value from corrected invoice
      - `before_vat_amount` (numeric) - Original VAT amount from corrected invoice
      - `before_value_gross` (numeric) - Original gross value from corrected invoice
      - `after_quantity` (numeric) - New quantity after correction
      - `after_price_net` (numeric) - New unit price after correction
      - `after_value_net` (numeric) - New net value after correction
      - `after_vat_amount` (numeric) - New VAT amount after correction
      - `after_value_gross` (numeric) - New gross value after correction

  2. Important Notes
    - These columns are nullable - only populated for corrective invoice items
    - For corrective invoices, the main value columns (value_net, vat_amount, value_gross)
      store the DIFFERENCE (after - before), which is the actual correction amount
    - Regular invoices continue to use existing columns only
    - This replaces the old approach of negating prices to create corrections
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_items' AND column_name = 'before_quantity'
  ) THEN
    ALTER TABLE invoice_items ADD COLUMN before_quantity numeric(12, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_items' AND column_name = 'before_price_net'
  ) THEN
    ALTER TABLE invoice_items ADD COLUMN before_price_net numeric(12, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_items' AND column_name = 'before_value_net'
  ) THEN
    ALTER TABLE invoice_items ADD COLUMN before_value_net numeric(12, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_items' AND column_name = 'before_vat_amount'
  ) THEN
    ALTER TABLE invoice_items ADD COLUMN before_vat_amount numeric(12, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_items' AND column_name = 'before_value_gross'
  ) THEN
    ALTER TABLE invoice_items ADD COLUMN before_value_gross numeric(12, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_items' AND column_name = 'after_quantity'
  ) THEN
    ALTER TABLE invoice_items ADD COLUMN after_quantity numeric(12, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_items' AND column_name = 'after_price_net'
  ) THEN
    ALTER TABLE invoice_items ADD COLUMN after_price_net numeric(12, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_items' AND column_name = 'after_value_net'
  ) THEN
    ALTER TABLE invoice_items ADD COLUMN after_value_net numeric(12, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_items' AND column_name = 'after_vat_amount'
  ) THEN
    ALTER TABLE invoice_items ADD COLUMN after_vat_amount numeric(12, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_items' AND column_name = 'after_value_gross'
  ) THEN
    ALTER TABLE invoice_items ADD COLUMN after_value_gross numeric(12, 2);
  END IF;
END $$;
