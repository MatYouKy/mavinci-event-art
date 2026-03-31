/*
  # Remove storage delete trigger

  1. Changes
    - Remove trigger and function that attempted to delete storage files
    - Storage deletion is now handled from frontend before database deletion

  2. Notes
    - Frontend deletes files from storage first
    - Then CASCADE DELETE removes database records
*/

-- Drop trigger and function
DROP TRIGGER IF EXISTS trigger_delete_offer_storage_files ON offers;
DROP FUNCTION IF EXISTS delete_offer_storage_files();