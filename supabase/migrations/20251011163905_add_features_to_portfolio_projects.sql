/*
  # Dodaj kolumnę features do tabeli portfolio_projects

  1. Zmiany
    - Dodaj kolumnę `features` typu JSONB do przechowywania cech/features projektu
    - Każdy feature to obiekt z ikoną, tytułem i opisem
    - Domyślnie pusta tablica
  
  2. Format danych
    ```json
    [
      {
        "icon_name": "Star",
        "title": "Wysoka jakość",
        "description": "Profesjonalne wykonanie",
        "order_index": 0
      }
    ]
    ```
*/

-- Dodaj kolumnę features do portfolio_projects
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_projects' AND column_name = 'features'
  ) THEN
    ALTER TABLE portfolio_projects 
    ADD COLUMN features JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;

COMMENT ON COLUMN portfolio_projects.features IS 'Tablica cech/features projektu z ikonami (format: [{icon_name, title, description, order_index}])';