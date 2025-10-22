/*
  # Create equipment images system

  1. New Tables
    - `equipment_images` - Replaces equipment_gallery with vehicle_images-like structure
      - `id` (uuid, primary key)
      - `equipment_id` (uuid, foreign key to equipment_items)
      - `image_url` (text, required)
      - `title` (text, optional)
      - `is_primary` (boolean, default false) - Only one image can be primary
      - `sort_order` (integer, default 0)
      - `uploaded_by` (uuid, foreign key to employees)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Changes
    - Creates new equipment_images table with is_primary support
    - Adds trigger to ensure only one primary image per equipment
    - Syncs equipment_items.thumbnail_url with primary image
    - Migrates data from equipment_gallery to equipment_images
    - Drops old equipment_gallery table

  3. Security
    - RLS policies matching vehicle_images permissions
    - fleet_manage and admin can manage images
    - All authenticated users can view images
*/

-- Create equipment_images table
CREATE TABLE IF NOT EXISTS equipment_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  title text,
  is_primary boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  uploaded_by uuid REFERENCES employees(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipment_images_equipment_id ON equipment_images(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_images_is_primary ON equipment_images(equipment_id, is_primary);
CREATE INDEX IF NOT EXISTS idx_equipment_images_sort_order ON equipment_images(equipment_id, sort_order);

-- Enable RLS
ALTER TABLE equipment_images ENABLE ROW LEVEL SECURITY;

-- Odczyt: wszyscy zalogowani
CREATE POLICY "All authenticated users can view equipment images"
  ON equipment_images FOR SELECT
  TO authenticated
  USING (true);

-- Wstawianie: equipment_manage, admin
CREATE POLICY "Equipment managers can insert equipment images"
  ON equipment_images FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'equipment_manage' = ANY(permissions))
    )
  );

-- Aktualizacja: equipment_manage, admin
CREATE POLICY "Equipment managers can update equipment images"
  ON equipment_images FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'equipment_manage' = ANY(permissions))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'equipment_manage' = ANY(permissions))
    )
  );

-- Usuwanie: equipment_manage, admin
CREATE POLICY "Equipment managers can delete equipment images"
  ON equipment_images FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'equipment_manage' = ANY(permissions))
    )
  );

-- Service role ma pełen dostęp
CREATE POLICY "Service role has full access to equipment images"
  ON equipment_images FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Trigger: tylko jedno zdjęcie może być primary na raz + sync thumbnail_url
CREATE OR REPLACE FUNCTION ensure_single_primary_equipment_image()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    IF NEW.is_primary = true THEN
      -- Ustaw wszystkie inne zdjęcia tego sprzętu jako nie-primary
      UPDATE equipment_images
      SET is_primary = false
      WHERE equipment_id = NEW.equipment_id
        AND id != NEW.id
        AND is_primary = true;

      -- Zaktualizuj thumbnail_url w tabeli equipment_items
      UPDATE equipment_items
      SET thumbnail_url = NEW.image_url,
          updated_at = now()
      WHERE id = NEW.equipment_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Jeśli usuwamy primary image, wyczyść thumbnail_url
    IF OLD.is_primary = true THEN
      UPDATE equipment_items
      SET thumbnail_url = NULL,
          updated_at = now()
      WHERE id = OLD.equipment_id;
    END IF;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER trigger_ensure_single_primary_equipment_image
  BEFORE INSERT OR UPDATE OF is_primary ON equipment_images
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_primary_equipment_image();

CREATE TRIGGER trigger_sync_equipment_thumbnail_on_delete
  AFTER DELETE ON equipment_images
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_primary_equipment_image();

-- Migrate data from equipment_gallery to equipment_images
INSERT INTO equipment_images (equipment_id, image_url, title, is_primary, sort_order, created_at)
SELECT
  equipment_id,
  image_url,
  caption as title,
  (order_index = 0) as is_primary, -- First image is primary
  order_index as sort_order,
  created_at
FROM equipment_gallery
ON CONFLICT DO NOTHING;

-- Update equipment_items thumbnail_url from primary images
UPDATE equipment_items ei
SET thumbnail_url = eimg.image_url,
    updated_at = now()
FROM equipment_images eimg
WHERE eimg.equipment_id = ei.id
  AND eimg.is_primary = true
  AND (ei.thumbnail_url IS NULL OR ei.thumbnail_url != eimg.image_url);

-- Drop old equipment_gallery table
DROP TABLE IF EXISTS equipment_gallery CASCADE;

-- Create storage bucket for equipment images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'equipment-images',
  'equipment-images',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'Public access to equipment images'
  ) THEN
    CREATE POLICY "Public access to equipment images"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'equipment-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'Equipment managers can upload equipment images'
  ) THEN
    CREATE POLICY "Equipment managers can upload equipment images"
      ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'equipment-images' AND
        auth.role() = 'authenticated' AND
        EXISTS (
          SELECT 1 FROM employees
          WHERE id = auth.uid()
          AND ('admin' = ANY(permissions) OR 'equipment_manage' = ANY(permissions))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'Equipment managers can delete equipment images'
  ) THEN
    CREATE POLICY "Equipment managers can delete equipment images"
      ON storage.objects FOR DELETE
      USING (
        bucket_id = 'equipment-images' AND
        auth.role() = 'authenticated' AND
        EXISTS (
          SELECT 1 FROM employees
          WHERE id = auth.uid()
          AND ('admin' = ANY(permissions) OR 'equipment_manage' = ANY(permissions))
        )
      );
  END IF;
END $$;
