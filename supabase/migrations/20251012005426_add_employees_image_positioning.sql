/*
  # Add image positioning metadata to employees

  1. Changes
    - Change `avatar_metadata` from text to jsonb
    - Add `background_metadata` jsonb column for background image positioning
    - Add default values for better UX

  2. Notes
    - Safe migration preserving existing data
    - Metadata format: {"object_fit": "cover", "object_position": "center"}
*/

-- Change avatar_metadata to jsonb if it's text
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'avatar_metadata' AND data_type = 'text'
  ) THEN
    ALTER TABLE employees ALTER COLUMN avatar_metadata TYPE jsonb USING 
      CASE 
        WHEN avatar_metadata IS NULL OR avatar_metadata = '' THEN '{"object_fit": "cover", "object_position": "center"}'::jsonb
        ELSE avatar_metadata::jsonb
      END;
  END IF;
END $$;

-- Add background_metadata column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'background_metadata'
  ) THEN
    ALTER TABLE employees ADD COLUMN background_metadata jsonb DEFAULT '{"object_fit": "cover", "object_position": "center"}'::jsonb;
  END IF;
END $$;

-- Set default values for existing records with NULL metadata
UPDATE employees 
SET avatar_metadata = '{"object_fit": "cover", "object_position": "center"}'::jsonb
WHERE avatar_metadata IS NULL;

UPDATE employees 
SET background_metadata = '{"object_fit": "cover", "object_position": "center"}'::jsonb
WHERE background_metadata IS NULL;
