/*
  # Sync vehicle primary image with vehicle_images table

  1. Changes
    - Updates trigger to sync primary_image_url in vehicles table when is_primary changes in vehicle_images
    - Ensures vehicles.primary_image_url always reflects the current primary image

  2. How it works
    - When a vehicle_image is set as primary (is_primary = true), update vehicles.primary_image_url
    - When a vehicle_image is deleted and it was primary, clear vehicles.primary_image_url
*/

-- Drop existing trigger and function
DROP TRIGGER IF EXISTS trigger_ensure_single_primary_vehicle_image ON vehicle_images;
DROP FUNCTION IF EXISTS ensure_single_primary_vehicle_image();

-- Create improved function that also syncs vehicles.primary_image_url
CREATE OR REPLACE FUNCTION ensure_single_primary_vehicle_image()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    IF NEW.is_primary = true THEN
      -- Ustaw wszystkie inne zdjęcia tego pojazdu jako nie-primary
      UPDATE vehicle_images
      SET is_primary = false
      WHERE vehicle_id = NEW.vehicle_id
        AND id != NEW.id
        AND is_primary = true;

      -- Zaktualizuj primary_image_url w tabeli vehicles
      UPDATE vehicles
      SET primary_image_url = NEW.image_url,
          updated_at = now()
      WHERE id = NEW.vehicle_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Jeśli usuwamy primary image, wyczyść primary_image_url w vehicles
    IF OLD.is_primary = true THEN
      UPDATE vehicles
      SET primary_image_url = NULL,
          updated_at = now()
      WHERE id = OLD.vehicle_id;
    END IF;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for INSERT and UPDATE
CREATE TRIGGER trigger_ensure_single_primary_vehicle_image
  BEFORE INSERT OR UPDATE OF is_primary ON vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_primary_vehicle_image();

-- Create trigger for DELETE
CREATE TRIGGER trigger_sync_vehicle_primary_image_on_delete
  AFTER DELETE ON vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_primary_vehicle_image();

-- Update existing vehicles to have correct primary_image_url
UPDATE vehicles v
SET primary_image_url = vi.image_url,
    updated_at = now()
FROM vehicle_images vi
WHERE vi.vehicle_id = v.id
  AND vi.is_primary = true
  AND (v.primary_image_url IS NULL OR v.primary_image_url != vi.image_url);
