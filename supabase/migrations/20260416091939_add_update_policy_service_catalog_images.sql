/*
  # Add UPDATE policy for service-catalog-images storage bucket

  1. Security Changes
    - Add missing UPDATE policy for authenticated users on service-catalog-images bucket
    - This fixes 502 errors when uploading images that may trigger an upsert

  2. Notes
    - The bucket already had INSERT, DELETE, and SELECT policies
    - The UPDATE policy was missing, causing potential issues with overwrites
*/

CREATE POLICY "Authenticated update service catalog images"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'service-catalog-images')
  WITH CHECK (bucket_id = 'service-catalog-images');
