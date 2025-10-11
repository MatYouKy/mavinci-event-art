/*
  # Dodanie brakujących kolumn image i alt do portfolio_projects
  
  1. Zmiany
    - Dodanie kolumny `image` (TEXT) - URL głównego zdjęcia projektu
    - Dodanie kolumny `alt` (TEXT) - Tekst alternatywny dla zdjęcia
    - Dodanie kolumny `image_metadata` (JSONB) - Metadane zdjęcia (pozycja, skala itp.)
  
  2. Uwagi
    - Kolumny są opcjonalne (NULL allowed)
    - Starsze projekty mogą używać `image_url`, nowsze `image`
    - Aplikacja frontendowa używa pola `image`
*/

DO $$ 
BEGIN
  -- Dodaj kolumnę image jeśli nie istnieje
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'portfolio_projects' 
    AND column_name = 'image'
  ) THEN
    ALTER TABLE portfolio_projects 
    ADD COLUMN image TEXT DEFAULT NULL;
  END IF;

  -- Dodaj kolumnę alt jeśli nie istnieje
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'portfolio_projects' 
    AND column_name = 'alt'
  ) THEN
    ALTER TABLE portfolio_projects 
    ADD COLUMN alt TEXT DEFAULT NULL;
  END IF;

  -- Dodaj kolumnę image_metadata jeśli nie istnieje
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'portfolio_projects' 
    AND column_name = 'image_metadata'
  ) THEN
    ALTER TABLE portfolio_projects 
    ADD COLUMN image_metadata JSONB DEFAULT NULL;
  END IF;
END $$;

COMMENT ON COLUMN portfolio_projects.image IS 'URL głównego zdjęcia projektu (używane przez aplikację)';
COMMENT ON COLUMN portfolio_projects.alt IS 'Tekst alternatywny dla zdjęcia głównego';
COMMENT ON COLUMN portfolio_projects.image_metadata IS 'Metadane zdjęcia: pozycja, skala, object-fit dla desktop i mobile';
