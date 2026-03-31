/*
  # Add offer_id to event_files and cascade delete

  1. Changes
    - Add `offer_id` column to event_files (nullable)
    - Add foreign key with CASCADE DELETE
    - Create trigger to auto-delete offer files when offer is deleted
    - Migrate existing offer files to link them with offers

  2. Notes
    - Offer files will be automatically deleted when offer is deleted
    - Existing files will be matched by offer_number in name
*/

-- Add offer_id column
ALTER TABLE event_files 
ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES offers(id) ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_event_files_offer_id ON event_files(offer_id);

-- Migrate existing offer files to link them with offers
-- Match by offer_number in the filename
UPDATE event_files ef
SET offer_id = o.id
FROM offers o
WHERE ef.document_type = 'offer'
  AND ef.offer_id IS NULL
  AND ef.name LIKE 'oferta-' || o.offer_number || '-%';

COMMENT ON COLUMN event_files.offer_id IS 'Powiązanie z ofertą - pliki ofert będą automatycznie usunięte wraz z ofertą (CASCADE DELETE)';