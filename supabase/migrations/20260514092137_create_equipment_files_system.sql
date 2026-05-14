/*
  # Create equipment files system

  1. New Tables
    - `equipment_files` - stores files attached to equipment items
      - `id` (uuid, primary key)
      - `equipment_id` (uuid, FK to equipment_items, cascade)
      - `file_name` (text) - original filename
      - `file_path` (text) - path in storage bucket
      - `file_url` (text) - public URL
      - `file_size` (bigint)
      - `mime_type` (text)
      - `uploaded_by` (uuid, FK to auth.users)
      - `created_at`, `updated_at` (timestamptz)

  2. Storage
    - Bucket `equipment-files` (50MB limit, public)

  3. Security
    - RLS enabled with separate SELECT/INSERT/UPDATE/DELETE policies for authenticated users
    - Storage policies allow authenticated upload/update/delete and public read
*/

CREATE TABLE IF NOT EXISTS equipment_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_url text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipment_files_equipment_id ON equipment_files(equipment_id);

ALTER TABLE equipment_files ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'equipment_files' AND policyname = 'Authenticated users can view equipment files') THEN
    CREATE POLICY "Authenticated users can view equipment files"
      ON equipment_files FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'equipment_files' AND policyname = 'Authenticated users can insert equipment files') THEN
    CREATE POLICY "Authenticated users can insert equipment files"
      ON equipment_files FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'equipment_files' AND policyname = 'Authenticated users can update equipment files') THEN
    CREATE POLICY "Authenticated users can update equipment files"
      ON equipment_files FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'equipment_files' AND policyname = 'Authenticated users can delete equipment files') THEN
    CREATE POLICY "Authenticated users can delete equipment files"
      ON equipment_files FOR DELETE TO authenticated USING (true);
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('equipment-files', 'equipment-files', true, 52428800)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 52428800;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public can read equipment files') THEN
    CREATE POLICY "Public can read equipment files"
      ON storage.objects FOR SELECT TO public USING (bucket_id = 'equipment-files');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Authenticated can upload equipment files') THEN
    CREATE POLICY "Authenticated can upload equipment files"
      ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'equipment-files');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Authenticated can update equipment files') THEN
    CREATE POLICY "Authenticated can update equipment files"
      ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'equipment-files') WITH CHECK (bucket_id = 'equipment-files');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Authenticated can delete equipment files') THEN
    CREATE POLICY "Authenticated can delete equipment files"
      ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'equipment-files');
  END IF;
END $$;
