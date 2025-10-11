/*
  # Dodanie szczegółowego opisu do projektów portfolio
  
  1. Zmiany
    - Dodanie kolumny `detailed_description` do tabeli `portfolio_projects`
    - Pole typu TEXT dla długich, SEO-friendly opisów
    - Domyślnie NULL (opcjonalne)
  
  2. Zastosowanie
    - Krótki opis (`description`) - pozostaje w hero, chwytliwy
    - Szczegółowy opis (`detailed_description`) - sekcja nad galerią, SEO-focused z długim ogonem słów kluczowych
*/

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'portfolio_projects' 
    AND column_name = 'detailed_description'
  ) THEN
    ALTER TABLE portfolio_projects 
    ADD COLUMN detailed_description TEXT DEFAULT NULL;
  END IF;
END $$;

COMMENT ON COLUMN portfolio_projects.detailed_description IS 'Szczegółowy, SEO-friendly opis wydarzenia z długim ogonem słów kluczowych';
