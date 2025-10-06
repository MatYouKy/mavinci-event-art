/*
  # Dodanie obsługi logo do szablonów umów
  
  1. Nowe kolumny w contract_templates:
    - `header_logo_url` (text) - URL do małego logo w nagłówku
    - `header_logo_height` (integer) - wysokość logo w nagłówku (px)
    - `center_logo_url` (text) - URL do centralnego logo na pierwszej stronie
    - `center_logo_height` (integer) - wysokość centralnego logo (px)
    - `show_header_logo` (boolean) - czy pokazywać logo w nagłówku
    - `show_center_logo` (boolean) - czy pokazywać logo centralne
  
  2. Zmiany:
    - Dodanie kolumn do istniejącej tabeli
*/

-- Dodaj kolumny dla logo w nagłówku
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contract_templates' 
    AND column_name = 'header_logo_url'
  ) THEN
    ALTER TABLE contract_templates ADD COLUMN header_logo_url text;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contract_templates' 
    AND column_name = 'header_logo_height'
  ) THEN
    ALTER TABLE contract_templates ADD COLUMN header_logo_height integer DEFAULT 50;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contract_templates' 
    AND column_name = 'center_logo_url'
  ) THEN
    ALTER TABLE contract_templates ADD COLUMN center_logo_url text;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contract_templates' 
    AND column_name = 'center_logo_height'
  ) THEN
    ALTER TABLE contract_templates ADD COLUMN center_logo_height integer DEFAULT 100;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contract_templates' 
    AND column_name = 'show_header_logo'
  ) THEN
    ALTER TABLE contract_templates ADD COLUMN show_header_logo boolean DEFAULT false;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contract_templates' 
    AND column_name = 'show_center_logo'
  ) THEN
    ALTER TABLE contract_templates ADD COLUMN show_center_logo boolean DEFAULT false;
  END IF;
END $$;

-- Dodaj też kolumny do contracts dla wygenerowanych umów
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contracts' 
    AND column_name = 'header_logo_url'
  ) THEN
    ALTER TABLE contracts ADD COLUMN header_logo_url text;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contracts' 
    AND column_name = 'header_logo_height'
  ) THEN
    ALTER TABLE contracts ADD COLUMN header_logo_height integer;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contracts' 
    AND column_name = 'center_logo_url'
  ) THEN
    ALTER TABLE contracts ADD COLUMN center_logo_url text;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contracts' 
    AND column_name = 'center_logo_height'
  ) THEN
    ALTER TABLE contracts ADD COLUMN center_logo_height integer;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contracts' 
    AND column_name = 'show_header_logo'
  ) THEN
    ALTER TABLE contracts ADD COLUMN show_header_logo boolean DEFAULT false;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contracts' 
    AND column_name = 'show_center_logo'
  ) THEN
    ALTER TABLE contracts ADD COLUMN show_center_logo boolean DEFAULT false;
  END IF;
END $$;