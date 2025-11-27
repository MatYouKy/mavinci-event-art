/*
  # Dodanie brakujących kolumn do service_hero_images

  ## Opis
  Dodajemy kolumny wymagane przez EditableHeroWithMetadata:
  - label_text - tekst etykiety nad tytułem
  - label_icon - ID ikony z custom_icons
  - white_words_count - ilość białych słów w tytule (reszta jest złota)

  ## Zmiany
  1. Dodanie nowych kolumn
  2. Aktualizacja istniejących rekordów z domyślnymi wartościami
*/

-- Dodanie kolumn jeśli nie istnieją
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'service_hero_images' AND column_name = 'label_text'
  ) THEN
    ALTER TABLE service_hero_images ADD COLUMN label_text text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'service_hero_images' AND column_name = 'label_icon'
  ) THEN
    ALTER TABLE service_hero_images ADD COLUMN label_icon text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'service_hero_images' AND column_name = 'white_words_count'
  ) THEN
    ALTER TABLE service_hero_images ADD COLUMN white_words_count integer DEFAULT 2;
  END IF;
END $$;

-- Komentarze
COMMENT ON COLUMN service_hero_images.label_text IS 'Tekst etykiety nad tytułem hero sekcji';
COMMENT ON COLUMN service_hero_images.label_icon IS 'ID ikony z tabeli custom_icons';
COMMENT ON COLUMN service_hero_images.white_words_count IS 'Ilość białych słów w tytule (reszta jest złota)';
