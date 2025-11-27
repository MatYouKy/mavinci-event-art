/*
  # Auto-generate slug and thumbnail for service items

  1. New Functions
    - `slugify(text)` - Converts Polish text to URL-friendly slug
    - `generate_slug_from_name()` - Trigger function to auto-generate slug
    - `sync_thumbnail_from_hero()` - Trigger function to copy hero_image to thumbnail

  2. Changes
    - Add triggers to auto-generate slug on INSERT/UPDATE
    - Add triggers to sync thumbnail_url from hero_image_url

  3. Notes
    - Slug is generated from name with Polish character mapping
    - Thumbnail automatically copies from hero_image if empty
*/

-- Create slugify function with Polish characters support
CREATE OR REPLACE FUNCTION slugify(text text)
RETURNS text AS $$
DECLARE
  result text;
BEGIN
  result := text;
  
  -- Replace Polish characters
  result := replace(result, 'ą', 'a');
  result := replace(result, 'ć', 'c');
  result := replace(result, 'ę', 'e');
  result := replace(result, 'ł', 'l');
  result := replace(result, 'ń', 'n');
  result := replace(result, 'ó', 'o');
  result := replace(result, 'ś', 's');
  result := replace(result, 'ź', 'z');
  result := replace(result, 'ż', 'z');
  result := replace(result, 'Ą', 'a');
  result := replace(result, 'Ć', 'c');
  result := replace(result, 'Ę', 'e');
  result := replace(result, 'Ł', 'l');
  result := replace(result, 'Ń', 'n');
  result := replace(result, 'Ó', 'o');
  result := replace(result, 'Ś', 's');
  result := replace(result, 'Ź', 'z');
  result := replace(result, 'Ż', 'z');
  
  -- Convert to lowercase and clean
  result := lower(trim(result));
  
  -- Replace spaces and special chars with hyphens
  result := regexp_replace(result, '[^a-z0-9]+', '-', 'g');
  
  -- Remove leading/trailing hyphens
  result := regexp_replace(result, '^-+|-+$', '', 'g');
  
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to auto-generate slug from name
CREATE OR REPLACE FUNCTION generate_slug_from_name()
RETURNS TRIGGER AS $$
BEGIN
  -- Only generate slug if it's empty or if name changed
  IF NEW.slug IS NULL OR NEW.slug = '' OR (TG_OP = 'UPDATE' AND NEW.name != OLD.name) THEN
    NEW.slug := slugify(NEW.name);
    
    -- Ensure slug is unique by appending number if needed
    DECLARE
      base_slug text := NEW.slug;
      counter integer := 1;
    BEGIN
      WHILE EXISTS (
        SELECT 1 FROM conferences_service_items 
        WHERE slug = NEW.slug AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      ) LOOP
        NEW.slug := base_slug || '-' || counter;
        counter := counter + 1;
      END LOOP;
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to sync thumbnail from hero image
CREATE OR REPLACE FUNCTION sync_thumbnail_from_hero()
RETURNS TRIGGER AS $$
BEGIN
  -- If thumbnail is empty but hero_image exists, copy it
  IF (NEW.thumbnail_url IS NULL OR NEW.thumbnail_url = '') AND NEW.hero_image_url IS NOT NULL AND NEW.hero_image_url != '' THEN
    NEW.thumbnail_url := NEW.hero_image_url;
  END IF;
  
  -- If hero_image changed and thumbnail was same as old hero, update thumbnail too
  IF TG_OP = 'UPDATE' AND NEW.hero_image_url != OLD.hero_image_url THEN
    IF OLD.thumbnail_url = OLD.hero_image_url OR OLD.thumbnail_url IS NULL OR OLD.thumbnail_url = '' THEN
      NEW.thumbnail_url := NEW.hero_image_url;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS generate_slug_trigger ON conferences_service_items;
DROP TRIGGER IF EXISTS sync_thumbnail_trigger ON conferences_service_items;

-- Create trigger for slug generation
CREATE TRIGGER generate_slug_trigger
  BEFORE INSERT OR UPDATE ON conferences_service_items
  FOR EACH ROW
  EXECUTE FUNCTION generate_slug_from_name();

-- Create trigger for thumbnail sync
CREATE TRIGGER sync_thumbnail_trigger
  BEFORE INSERT OR UPDATE ON conferences_service_items
  FOR EACH ROW
  EXECUTE FUNCTION sync_thumbnail_from_hero();

-- Update existing records to generate slugs and thumbnails
UPDATE conferences_service_items
SET slug = slugify(name), updated_at = now()
WHERE slug IS NULL OR slug = '';

UPDATE conferences_service_items
SET thumbnail_url = hero_image_url
WHERE (thumbnail_url IS NULL OR thumbnail_url = '') AND hero_image_url IS NOT NULL;
