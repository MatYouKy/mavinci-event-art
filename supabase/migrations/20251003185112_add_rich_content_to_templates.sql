/*
  # Rozszerzenie szablonów o rich content i formatowanie
  
  1. Nowe kolumny w contract_templates:
    - `content_html` (text) - treść w formacie HTML z formatowaniem
    - `logo_position` (jsonb) - pozycja logo (x, y, type: header/center/custom)
    - `page_settings` (jsonb) - ustawienia strony (margins, padding)
  
  2. Rozszerzenie placeholders:
    - Każdy placeholder może mieć style (bold, italic, color, fontSize, fontFamily)
  
  3. Dodanie kolumn do contracts dla zachowania formatowania
*/

-- Dodaj kolumny dla rich content w szablonach
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contract_templates' 
    AND column_name = 'content_html'
  ) THEN
    ALTER TABLE contract_templates ADD COLUMN content_html text;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contract_templates' 
    AND column_name = 'logo_position'
  ) THEN
    ALTER TABLE contract_templates ADD COLUMN logo_position jsonb DEFAULT '{
      "header": {"x": 0, "y": 0, "enabled": false},
      "center": {"x": 0, "y": 0, "enabled": false},
      "custom": []
    }'::jsonb;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contract_templates' 
    AND column_name = 'page_settings'
  ) THEN
    ALTER TABLE contract_templates ADD COLUMN page_settings jsonb DEFAULT '{
      "marginTop": 50,
      "marginBottom": 50,
      "marginLeft": 50,
      "marginRight": 50,
      "fontSize": 12,
      "fontFamily": "Arial"
    }'::jsonb;
  END IF;
END $$;

-- Dodaj kolumny do contracts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contracts' 
    AND column_name = 'content_html'
  ) THEN
    ALTER TABLE contracts ADD COLUMN content_html text;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contracts' 
    AND column_name = 'logo_position'
  ) THEN
    ALTER TABLE contracts ADD COLUMN logo_position jsonb;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contracts' 
    AND column_name = 'page_settings'
  ) THEN
    ALTER TABLE contracts ADD COLUMN page_settings jsonb;
  END IF;
END $$;

-- Aktualizuj istniejące szablony, aby content był w content_html jeśli brakuje
UPDATE contract_templates 
SET content_html = content 
WHERE content_html IS NULL AND content IS NOT NULL;