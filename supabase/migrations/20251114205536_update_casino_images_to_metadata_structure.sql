/*
  # Aktualizacja struktury zdjęć w systemie kasyna

  1. Zmiany w tabelach:
    - `casino_tables`: zmiana z image_url/image_alt na image/alt + image_metadata
    - `casino_gallery`: zmiana z image_url/alt_text na image/alt + image_metadata
    - Dodanie kolumn dla desktop/mobile responsiveness
  
  2. Nowa struktura:
    - image: string (URL do głównego zdjęcia)
    - alt: string (tekst alternatywny)
    - image_metadata: jsonb (desktop/mobile z pozycjami)
    
  3. Migracja danych:
    - Przekształcenie istniejących image_url → image + metadata
*/

-- Aktualizacja casino_tables
DO $$ 
BEGIN
  -- Dodaj nowe kolumny jeśli nie istnieją
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'casino_tables' AND column_name = 'image'
  ) THEN
    ALTER TABLE casino_tables ADD COLUMN image text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'casino_tables' AND column_name = 'alt'
  ) THEN
    ALTER TABLE casino_tables ADD COLUMN alt text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'casino_tables' AND column_name = 'image_metadata'
  ) THEN
    ALTER TABLE casino_tables ADD COLUMN image_metadata jsonb;
  END IF;
END $$;

-- Migruj dane z image_url do image i utwórz metadata
UPDATE casino_tables
SET 
  image = image_url,
  alt = COALESCE(image_alt, name),
  image_metadata = jsonb_build_object(
    'desktop', jsonb_build_object(
      'src', image_url,
      'position', jsonb_build_object('posX', 0, 'posY', 0, 'scale', 1)
    ),
    'mobile', jsonb_build_object(
      'src', image_url,
      'position', jsonb_build_object('posX', 0, 'posY', 0, 'scale', 1)
    )
  )
WHERE image_url IS NOT NULL AND image IS NULL;

-- Aktualizacja casino_gallery
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'casino_gallery' AND column_name = 'image'
  ) THEN
    ALTER TABLE casino_gallery ADD COLUMN image text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'casino_gallery' AND column_name = 'alt'
  ) THEN
    ALTER TABLE casino_gallery ADD COLUMN alt text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'casino_gallery' AND column_name = 'image_metadata'
  ) THEN
    ALTER TABLE casino_gallery ADD COLUMN image_metadata jsonb;
  END IF;
END $$;

-- Migruj dane z image_url do image i utwórz metadata
UPDATE casino_gallery
SET 
  image = image_url,
  alt = COALESCE(alt_text, 'Zdjęcie z kasyna'),
  image_metadata = jsonb_build_object(
    'desktop', jsonb_build_object(
      'src', image_url,
      'position', jsonb_build_object('posX', 0, 'posY', 0, 'scale', 1)
    ),
    'mobile', jsonb_build_object(
      'src', image_url,
      'position', jsonb_build_object('posX', 0, 'posY', 0, 'scale', 1)
    )
  )
WHERE image_url IS NOT NULL AND image IS NULL;

-- Możemy zachować stare kolumny dla kompatybilności wstecznej lub je usunąć
-- UWAGA: Odkomentuj poniższe linie tylko jeśli jesteś pewien, że stare kolumny nie są używane

-- ALTER TABLE casino_tables DROP COLUMN IF EXISTS image_url;
-- ALTER TABLE casino_tables DROP COLUMN IF EXISTS image_alt;
-- ALTER TABLE casino_gallery DROP COLUMN IF EXISTS image_url;
-- ALTER TABLE casino_gallery DROP COLUMN IF EXISTS alt_text;
