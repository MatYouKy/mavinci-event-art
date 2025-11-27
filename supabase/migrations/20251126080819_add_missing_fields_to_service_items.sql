/*
  # Add Missing Fields to Service Items Tables

  1. Changes to `dj_service_items`
    - Add `name` column (alias for title, for compatibility)
    - Add `icon` column (text field for icon name)
    - Add `thumbnail_url` column (for service thumbnail image)
    - Add `image_metadata` column (JSONB for image positioning)

  2. Changes to `technical_stage_service_items`
    - Add `name` column (alias for title, for compatibility)
    - Add `icon` column (text field for icon name)
    - Add `thumbnail_url` column (for service thumbnail image)
    - Add `image_metadata` column (JSONB for image positioning)
    - Add `slug` column (for URL-friendly identifier)

  3. Notes
    - These fields match the structure of `conferences_service_items`
    - Enables RelatedServicesSection to work with all three tables
*/

-- =====================================================
-- DJ SERVICE ITEMS
-- =====================================================

-- Add missing columns to dj_service_items
ALTER TABLE dj_service_items 
ADD COLUMN IF NOT EXISTS name text,
ADD COLUMN IF NOT EXISTS icon text,
ADD COLUMN IF NOT EXISTS thumbnail_url text,
ADD COLUMN IF NOT EXISTS image_metadata jsonb DEFAULT '{}'::jsonb;

-- Copy title to name for existing records
UPDATE dj_service_items SET name = title WHERE name IS NULL;

-- Create trigger to auto-sync title and name
CREATE OR REPLACE FUNCTION sync_dj_service_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.title IS NOT NULL THEN
    NEW.name := NEW.title;
  END IF;
  IF NEW.name IS NOT NULL AND (NEW.title IS NULL OR NEW.title = '') THEN
    NEW.title := NEW.name;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_dj_service_name_trigger ON dj_service_items;
CREATE TRIGGER sync_dj_service_name_trigger
  BEFORE INSERT OR UPDATE ON dj_service_items
  FOR EACH ROW
  EXECUTE FUNCTION sync_dj_service_name();

-- =====================================================
-- TECHNICAL STAGE SERVICE ITEMS
-- =====================================================

-- Add missing columns to technical_stage_service_items
ALTER TABLE technical_stage_service_items 
ADD COLUMN IF NOT EXISTS name text,
ADD COLUMN IF NOT EXISTS icon text,
ADD COLUMN IF NOT EXISTS thumbnail_url text,
ADD COLUMN IF NOT EXISTS image_metadata jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS slug text;

-- Copy title to name for existing records
UPDATE technical_stage_service_items SET name = title WHERE name IS NULL;

-- Create trigger to auto-sync title and name
CREATE OR REPLACE FUNCTION sync_technical_service_name()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.title IS NOT NULL THEN
    NEW.name := NEW.title;
  END IF;
  IF NEW.name IS NOT NULL AND (NEW.title IS NULL OR NEW.title = '') THEN
    NEW.title := NEW.name;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_technical_service_name_trigger ON technical_stage_service_items;
CREATE TRIGGER sync_technical_service_name_trigger
  BEFORE INSERT OR UPDATE ON technical_stage_service_items
  FOR EACH ROW
  EXECUTE FUNCTION sync_technical_service_name();

-- Auto-generate slug for technical_stage_service_items
CREATE OR REPLACE FUNCTION generate_technical_service_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := lower(regexp_replace(COALESCE(NEW.name, NEW.title, ''), '[^a-zA-Z0-9]+', '-', 'g'));
    NEW.slug := regexp_replace(NEW.slug, '^-+|-+$', '', 'g');
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_technical_service_slug ON technical_stage_service_items;
CREATE TRIGGER set_technical_service_slug
  BEFORE INSERT OR UPDATE ON technical_stage_service_items
  FOR EACH ROW
  EXECUTE FUNCTION generate_technical_service_slug();