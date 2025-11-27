/*
  # Add rating to conferences_packages

  1. Changes
    - Add `rating` column (1-3 stars) to conferences_packages
    - Update existing packages with ratings based on package_level

  2. Data Migration
    - basic → 1 star
    - standard → 2 stars
    - pro → 3 stars
*/

-- Add rating column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conferences_packages' AND column_name = 'rating'
  ) THEN
    ALTER TABLE conferences_packages
    ADD COLUMN rating integer CHECK (rating >= 1 AND rating <= 3);
  END IF;
END $$;

-- Update existing packages with ratings based on package_level
UPDATE conferences_packages
SET rating = CASE
  WHEN package_level = 'basic' THEN 1
  WHEN package_level = 'standard' THEN 2
  WHEN package_level = 'pro' THEN 3
  ELSE 2
END
WHERE rating IS NULL;
