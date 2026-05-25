/*
  # Create employee-assets storage bucket

  1. Storage
    - Create `employee-assets` bucket for storing employee-related files (notification sounds, etc.)
    - Public access enabled for playback of notification sounds
  2. Security
    - Authenticated users can upload to their own folder
    - Authenticated users can update/delete their own files
    - Public read access for stored assets (needed for audio playback)
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-assets', 'employee-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload own assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'employee-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Authenticated users can update own assets"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'employee-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'employee-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Authenticated users can delete own assets"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'employee-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Public read access for employee assets"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'employee-assets');
