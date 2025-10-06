/*
  # Naprawa relacji w tabeli offers
  
  1. Dodanie foreign key dla client_id
  2. Zapewnienie poprawnych relacji
*/

-- Dodaj foreign key dla client_id jeśli nie istnieje
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints 
    WHERE constraint_name = 'offers_client_id_fkey' 
    AND table_name = 'offers'
  ) THEN
    ALTER TABLE offers 
    ADD CONSTRAINT offers_client_id_fkey 
    FOREIGN KEY (client_id) 
    REFERENCES clients(id) 
    ON DELETE SET NULL;
  END IF;
END $$;