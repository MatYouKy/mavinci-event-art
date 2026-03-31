/*
  # Auto-delete offer files from storage

  1. New Functions
    - `delete_offer_storage_files()` - Trigger function to delete physical files from storage
    - Deletes both:
      - Main offer PDF from 'generated-offers' bucket
      - All event files from 'event-files' bucket

  2. Triggers
    - BEFORE DELETE on offers table
    - Automatically removes physical files before database records are deleted

  3. Notes
    - Uses Supabase Storage API to delete files
    - Handles both generated_pdf_url and event_files.file_path
    - CASCADE DELETE on event_files will handle database cleanup
*/

-- Function to delete offer files from storage
CREATE OR REPLACE FUNCTION delete_offer_storage_files()
RETURNS TRIGGER
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  event_file_record RECORD;
BEGIN
  -- Delete main generated PDF from 'generated-offers' bucket
  IF OLD.generated_pdf_url IS NOT NULL THEN
    PERFORM storage.fdelete(
      'generated-offers',
      OLD.generated_pdf_url
    );
  END IF;

  -- Delete all event files PDFs from 'event-files' bucket
  FOR event_file_record IN 
    SELECT file_path 
    FROM event_files 
    WHERE offer_id = OLD.id 
      AND file_path IS NOT NULL
  LOOP
    PERFORM storage.fdelete(
      'event-files',
      event_file_record.file_path
    );
  END LOOP;

  RETURN OLD;
END;
$$;

-- Create trigger to run before offer deletion
DROP TRIGGER IF EXISTS trigger_delete_offer_storage_files ON offers;
CREATE TRIGGER trigger_delete_offer_storage_files
  BEFORE DELETE ON offers
  FOR EACH ROW
  EXECUTE FUNCTION delete_offer_storage_files();

COMMENT ON FUNCTION delete_offer_storage_files() IS 'Automatycznie usuwa pliki ofert ze storage Supabase przed usunięciem rekordu oferty z bazy danych';