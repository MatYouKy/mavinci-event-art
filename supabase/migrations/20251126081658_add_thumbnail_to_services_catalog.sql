/*
  # Add Thumbnail Fields to services_catalog

  1. Changes
    - Add `thumbnail_url` column (for service card thumbnails)
    - Add `image_metadata` column (for image positioning)
    - Copy `hero_image_url` to `thumbnail_url` for existing records
    
  2. Notes
    - This allows services_catalog to work with RelatedServicesSection
    - Existing services will use hero_image as thumbnail initially
*/

-- Add missing columns
ALTER TABLE services_catalog 
ADD COLUMN IF NOT EXISTS thumbnail_url text,
ADD COLUMN IF NOT EXISTS image_metadata jsonb DEFAULT '{}'::jsonb;

-- Copy hero_image_url to thumbnail_url for existing records
UPDATE services_catalog 
SET thumbnail_url = hero_image_url 
WHERE thumbnail_url IS NULL AND hero_image_url IS NOT NULL;