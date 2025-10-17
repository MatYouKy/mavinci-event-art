/*
  # System galerii zdjęć pojazdów

  1. Nowe tabele
    - `vehicle_images`
      - `id` (uuid, primary key)
      - `vehicle_id` (uuid, foreign key → vehicles)
      - `image_url` (text) - URL do zdjęcia w storage
      - `title` (text) - tytuł/nazwa zdjęcia
      - `description` (text) - opis zdjęcia
      - `is_primary` (boolean) - czy to główne zdjęcie pojazdu
      - `sort_order` (integer) - kolejność wyświetlania
      - `uploaded_by` (uuid, foreign key → employees)
      - `created_at` (timestamptz)

  2. Storage
    - Utworzenie bucketu `vehicle-images`
    - Publiczny dostęp do odczytu
    - RLS policies dla uploadu i usuwania

  3. Security
    - Enable RLS na `vehicle_images`
    - Policies dla fleet_manage i fleet_view
    - Storage policies dla bezpiecznego uploadu
*/

-- Tworzenie tabeli vehicle_images
CREATE TABLE IF NOT EXISTS vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  title text,
  description text,
  is_primary boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  uploaded_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Indeksy dla wydajności
CREATE INDEX IF NOT EXISTS idx_vehicle_images_vehicle_id ON vehicle_images(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_sort_order ON vehicle_images(vehicle_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_is_primary ON vehicle_images(vehicle_id, is_primary);

-- Enable RLS
ALTER TABLE vehicle_images ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Czytanie: fleet_view, fleet_manage, admin, lub przypisani kierowcy
CREATE POLICY "Fleet users can view vehicle images"
  ON vehicle_images FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) 
           OR 'fleet_manage' = ANY(permissions) 
           OR 'fleet_view' = ANY(permissions))
    )
    OR EXISTS (
      SELECT 1 FROM vehicle_assignments
      WHERE vehicle_assignments.vehicle_id = vehicle_images.vehicle_id
      AND vehicle_assignments.employee_id = auth.uid()
      AND vehicle_assignments.status = 'active'
    )
  );

-- Dodawanie: fleet_manage, admin
CREATE POLICY "Fleet managers can add vehicle images"
  ON vehicle_images FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions))
    )
  );

-- Aktualizacja: fleet_manage, admin
CREATE POLICY "Fleet managers can update vehicle images"
  ON vehicle_images FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions))
    )
  );

-- Usuwanie: fleet_manage, admin
CREATE POLICY "Fleet managers can delete vehicle images"
  ON vehicle_images FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions))
    )
  );

-- Service role ma pełen dostęp
CREATE POLICY "Service role has full access to vehicle images"
  ON vehicle_images FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Trigger: tylko jedno zdjęcie może być primary na raz
CREATE OR REPLACE FUNCTION ensure_single_primary_vehicle_image()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_primary = true THEN
    -- Ustaw wszystkie inne zdjęcia tego pojazdu jako nie-primary
    UPDATE vehicle_images
    SET is_primary = false
    WHERE vehicle_id = NEW.vehicle_id
      AND id != NEW.id
      AND is_primary = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_ensure_single_primary_vehicle_image ON vehicle_images;
CREATE TRIGGER trigger_ensure_single_primary_vehicle_image
  BEFORE INSERT OR UPDATE OF is_primary ON vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_primary_vehicle_image();

-- Storage bucket (będzie utworzony przez dashboard lub kod)
-- Bucket: vehicle-images
-- Public: true (do odczytu)
-- Allowed MIME types: image/*
-- Max file size: 10MB

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-images',
  'vehicle-images',
  true,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DO $$
BEGIN
  -- Policy dla odczytu (publiczny dostęp)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Public access to vehicle images'
  ) THEN
    CREATE POLICY "Public access to vehicle images"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'vehicle-images');
  END IF;

  -- Policy dla uploadu (fleet_manage, admin)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Fleet managers can upload vehicle images'
  ) THEN
    CREATE POLICY "Fleet managers can upload vehicle images"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'vehicle-images'
        AND (storage.foldername(name))[1] IN (
          SELECT id::text FROM vehicles
        )
        AND EXISTS (
          SELECT 1 FROM employees
          WHERE id = auth.uid()
          AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions))
        )
      );
  END IF;

  -- Policy dla aktualizacji (fleet_manage, admin)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Fleet managers can update vehicle images'
  ) THEN
    CREATE POLICY "Fleet managers can update vehicle images"
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'vehicle-images'
        AND EXISTS (
          SELECT 1 FROM employees
          WHERE id = auth.uid()
          AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions))
        )
      );
  END IF;

  -- Policy dla usuwania (fleet_manage, admin)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Fleet managers can delete vehicle images'
  ) THEN
    CREATE POLICY "Fleet managers can delete vehicle images"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'vehicle-images'
        AND EXISTS (
          SELECT 1 FROM employees
          WHERE id = auth.uid()
          AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions))
        )
      );
  END IF;
END $$;
