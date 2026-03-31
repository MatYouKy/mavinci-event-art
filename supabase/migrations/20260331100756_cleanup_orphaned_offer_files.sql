/*
  # Cleanup orphaned offer files

  1. Changes
    - Delete offer files where offer_id is NULL and offer was deleted
    - These are old files before offer_id column was added

  2. Notes
    - One-time cleanup for existing orphaned files
    - Future files will be automatically deleted via CASCADE
*/

-- Delete orphaned offer files (where offer no longer exists)
DELETE FROM event_files
WHERE document_type = 'offer'
  AND offer_id IS NULL;

COMMENT ON COLUMN event_files.offer_id IS 'Powiązanie z ofertą - pliki ofert będą automatycznie usunięte wraz z ofertą (CASCADE DELETE). NULL tylko dla starych plików przed dodaniem tej kolumny.';