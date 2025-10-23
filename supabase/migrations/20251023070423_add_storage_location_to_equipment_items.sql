/*
  # Dodaj lokalizację magazynową do sprzętu

  1. Zmiany
    - Dodaj kolumnę `storage_location_id` do `equipment_items`
    - Dodaj foreign key do `storage_locations`
    - Pozwala na określenie gdzie fizycznie znajduje się sprzęt
    
  2. Notatki
    - NULL = lokalizacja nieokreślona
    - Sprzęt może być w jednej lokalizacji, jednostki w innych
*/

-- Dodaj kolumnę storage_location_id do equipment_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'equipment_items' AND column_name = 'storage_location_id'
  ) THEN
    ALTER TABLE equipment_items 
    ADD COLUMN storage_location_id uuid REFERENCES storage_locations(id) ON DELETE SET NULL;
    
    CREATE INDEX IF NOT EXISTS idx_equipment_items_storage_location 
    ON equipment_items(storage_location_id);
  END IF;
END $$;
