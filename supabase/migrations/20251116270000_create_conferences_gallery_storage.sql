/*
  # Create storage for conferences gallery

  1. Storage
    - Create bucket `conferences-gallery` for conference photos
    - Set public access for reading
    - Allow anyone to upload/update/delete (for edit mode)

  2. Security
    - Public read access
    - Public write access (permissive for edit mode)
    - No authentication required
*/

-- Create bucket if not exists
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'conferences-gallery',
  'conferences-gallery',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Public read access for conferences gallery" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload conferences gallery images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update conferences gallery images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete conferences gallery images" ON storage.objects;

-- Allow public read access
CREATE POLICY "Public read access for conferences gallery"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'conferences-gallery');

-- Allow anyone to upload
CREATE POLICY "Anyone can upload conferences gallery images"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'conferences-gallery');

-- Allow anyone to update
CREATE POLICY "Anyone can update conferences gallery images"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'conferences-gallery')
WITH CHECK (bucket_id = 'conferences-gallery');

-- Allow anyone to delete
CREATE POLICY "Anyone can delete conferences gallery images"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'conferences-gallery');
