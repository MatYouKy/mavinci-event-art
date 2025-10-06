/*
  # Add attachments support to events table

  1. Changes
    - Add `attachments` column to `events` table as JSONB array
    - This will store file metadata: name, url, size, type
    
  2. Notes
    - Attachments are stored as JSON array of objects
    - Each attachment object contains: { name, url, size, type, uploaded_at }
    - Actual files should be stored in Supabase Storage
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'attachments'
  ) THEN
    ALTER TABLE events ADD COLUMN attachments JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;
