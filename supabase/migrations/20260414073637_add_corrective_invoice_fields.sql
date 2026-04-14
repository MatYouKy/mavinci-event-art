/*
  # Add corrective invoice fields for FA(3) compliance

  1. Modified Tables
    - `invoices`
      - `correction_reason` (text) - Przyczyna korekty (required for corrective invoices, maps to PrzyczynaKorekty in FA(3))
      - `correction_scope` (text) - Whether correction covers full or partial invoice
      - `corrected_invoice_ksef_number` (text) - KSeF reference number of the corrected invoice (NrKSeFFaKorygowanej)
      - `corrected_invoice_number` (text) - Original invoice number being corrected (NrFaKorygowanej)
      - `corrected_invoice_issue_date` (date) - Issue date of the corrected invoice (DataWystFaKorygowanej)
      - `corrected_invoice_was_in_ksef` (boolean) - Whether corrected invoice was in KSeF 2.0 (determines NrKSeF vs NrKSeFN)

  2. Notes
    - These fields support FA(3) corrective invoice XML generation (DaneFaKorygowanej section)
    - RodzajFaktury values: KOR (correction to VAT), KOR_ZAL (correction to advance), KOR_ROZ (correction to settlement)
    - The `related_invoice_id` field already exists and will be used to link corrective to original invoice
    - `invoice_type` already supports 'corrective' value
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'correction_reason'
  ) THEN
    ALTER TABLE invoices ADD COLUMN correction_reason text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'correction_scope'
  ) THEN
    ALTER TABLE invoices ADD COLUMN correction_scope text DEFAULT 'full' CHECK (correction_scope IN ('full', 'partial'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'corrected_invoice_ksef_number'
  ) THEN
    ALTER TABLE invoices ADD COLUMN corrected_invoice_ksef_number text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'corrected_invoice_number'
  ) THEN
    ALTER TABLE invoices ADD COLUMN corrected_invoice_number text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'corrected_invoice_issue_date'
  ) THEN
    ALTER TABLE invoices ADD COLUMN corrected_invoice_issue_date date;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'corrected_invoice_was_in_ksef'
  ) THEN
    ALTER TABLE invoices ADD COLUMN corrected_invoice_was_in_ksef boolean DEFAULT false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_related_invoice_id ON invoices(related_invoice_id);
