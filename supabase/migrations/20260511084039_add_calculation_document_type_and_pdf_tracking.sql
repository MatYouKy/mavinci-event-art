/*
  # Add calculation document type + PDF tracking

  1. Changes
    - Extend `event_files.document_type` CHECK constraint to include `'calculation'`
    - Add `generated_pdf_path` and `generated_pdf_at` columns to `event_calculations`
      so the UI can track the last-generated PDF (mirrors the agenda/offer/contract pattern)
  2. Security
    - Constraints and columns only; no RLS changes
*/

ALTER TABLE event_files DROP CONSTRAINT IF EXISTS event_files_document_type_check;

ALTER TABLE event_files
  ADD CONSTRAINT event_files_document_type_check
  CHECK (
    document_type IS NULL OR document_type = ANY (
      ARRAY['offer'::text, 'contract'::text, 'invoice'::text, 'agenda'::text,
            'equipment_checklist'::text, 'calculation'::text, 'other'::text]
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_calculations' AND column_name = 'generated_pdf_path'
  ) THEN
    ALTER TABLE event_calculations ADD COLUMN generated_pdf_path text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_calculations' AND column_name = 'generated_pdf_at'
  ) THEN
    ALTER TABLE event_calculations ADD COLUMN generated_pdf_at timestamptz;
  END IF;
END $$;
