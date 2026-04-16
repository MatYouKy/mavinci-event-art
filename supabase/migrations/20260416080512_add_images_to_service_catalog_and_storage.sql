/*
  # Add images support to subcontractor service catalog

  1. Modified Tables
    - `subcontractor_service_catalog`
      - Added `images` (jsonb, default '[]') - array of {url, title?, isPrimary?}

  2. Storage
    - Created `service-catalog-images` public bucket (10MB max, image types only)
    - Public SELECT policy for reading images
    - Authenticated INSERT/DELETE policies

  3. Notes
    - Images stored as jsonb array matching the rental equipment pattern
    - thumbnail_url column already exists and will be auto-set from primary image
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subcontractor_service_catalog' AND column_name = 'images'
  ) THEN
    ALTER TABLE subcontractor_service_catalog ADD COLUMN images jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'service-catalog-images',
  'service-catalog-images',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Public read service catalog images' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Public read service catalog images"
      ON storage.objects FOR SELECT
      TO public
      USING (bucket_id = 'service-catalog-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated upload service catalog images' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Authenticated upload service catalog images"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'service-catalog-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated delete service catalog images' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "Authenticated delete service catalog images"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (bucket_id = 'service-catalog-images');
  END IF;
END $$;
