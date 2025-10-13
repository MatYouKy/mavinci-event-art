/*
  # Dodanie szacowanej daty naprawy/dostępności

  ## Zmiany
  - Dodanie pola `estimated_repair_date` do tabeli `equipment_units`
  - Pole przechowuje szacowaną datę kiedy jednostka będzie ponownie dostępna
  - Używane dla jednostek w statusie 'damaged' lub 'in_service'

  ## Notatki
  - Pomaga planować dostępność sprzętu
  - Wyświetlane przy jednostkach niedostępnych
*/

ALTER TABLE equipment_units
ADD COLUMN IF NOT EXISTS estimated_repair_date date;

COMMENT ON COLUMN equipment_units.estimated_repair_date IS 'Szacowana data naprawy/dostępności dla jednostek uszkodzonych lub w serwisie';