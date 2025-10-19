/*
  # Dodanie niezależnych ustawień zdjęcia dla strony zespołu

  1. Zmiany
    - Dodanie kolumny `team_page_metadata` do tabeli `employees`
    - Osobne ustawienia pozycji dla:
      - `avatar_metadata` - używane w CRM, taskach, avatarach
      - `team_page_metadata` - używane tylko na stronie /zespol
    
  2. Struktura metadanych
    ```json
    {
      "desktop": {
        "position": {
          "posX": 0,
          "posY": 0,
          "scale": 1
        },
        "objectFit": "cover"
      }
    }
    ```
*/

-- Add team_page_metadata column to employees
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' 
    AND column_name = 'team_page_metadata'
  ) THEN
    ALTER TABLE employees 
    ADD COLUMN team_page_metadata jsonb DEFAULT NULL;
  END IF;
END $$;

-- Add comment to explain the column
COMMENT ON COLUMN employees.team_page_metadata IS 'Metadata for team page image positioning (separate from avatar)';
