/*
  # Dodanie miniaturek do wtyków

  ## Zmiany

  1. Dodanie kolumny `thumbnail_url` do tabeli `connector_types`
     - Pozwala przechowywać zdjęcia wtyków
     - Użytkownik może kliknąć wtyk aby zobaczyć opis i zdjęcie

  2. Storage policies
     - Bucket `connector-thumbnails` dla zdjęć wtyków
     - Zalogowani mogą wgrywać zdjęcia
     - Wszyscy mogą pobierać
*/

-- Dodanie kolumny thumbnail_url
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'connector_types' AND column_name = 'thumbnail_url'
  ) THEN
    ALTER TABLE connector_types ADD COLUMN thumbnail_url text;
  END IF;
END $$;

-- Utworzenie bucketu dla miniaturek wtyków (jeśli nie istnieje)
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('connector-thumbnails', 'connector-thumbnails', true)
  ON CONFLICT (id) DO NOTHING;
END $$;

-- Polityki storage dla miniaturek wtyków
DO $$
BEGIN
  -- Wszyscy mogą pobierać
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
    AND policyname = 'Public read access for connector thumbnails'
  ) THEN
    CREATE POLICY "Public read access for connector thumbnails"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'connector-thumbnails');
  END IF;

  -- Zalogowani mogą wgrywać
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
    AND policyname = 'Authenticated users can upload connector thumbnails'
  ) THEN
    CREATE POLICY "Authenticated users can upload connector thumbnails"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'connector-thumbnails');
  END IF;

  -- Zalogowani mogą aktualizować
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
    AND policyname = 'Authenticated users can update connector thumbnails'
  ) THEN
    CREATE POLICY "Authenticated users can update connector thumbnails"
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (bucket_id = 'connector-thumbnails');
  END IF;

  -- Zalogowani mogą usuwać
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
    AND policyname = 'Authenticated users can delete connector thumbnails'
  ) THEN
    CREATE POLICY "Authenticated users can delete connector thumbnails"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (bucket_id = 'connector-thumbnails');
  END IF;
END $$;
