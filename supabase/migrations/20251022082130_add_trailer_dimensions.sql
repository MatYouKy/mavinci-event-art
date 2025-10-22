/*
  # Dodanie wymiarów dla przyczep
  
  1. Zmiany
    - Dodanie kolumn dla wymiarów załadunkowych przyczep:
      - `cargo_length_cm` - długość części załadunkowej (cm)
      - `cargo_width_cm` - szerokość części załadunkowej (cm)
      - `cargo_height_cm` - wysokość części załadunkowej (cm)
    - Dodanie kolumn dla wymiarów całkowitych:
      - `total_length_cm` - całkowita długość (cm)
      - `total_width_cm` - całkowita szerokość (cm)
      - `total_height_cm` - całkowita wysokość (cm)
    
  2. Uwagi
    - Kolumny length_cm, width_cm, height_cm nadal istnieją dla kompatybilności wstecznej
    - Nowe kolumny cargo_* są dla części załadunkowej przyczep
    - Nowe kolumny total_* są dla bezwzględnych wymiarów całkowitych
*/

ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS cargo_length_cm INTEGER,
ADD COLUMN IF NOT EXISTS cargo_width_cm INTEGER,
ADD COLUMN IF NOT EXISTS cargo_height_cm INTEGER,
ADD COLUMN IF NOT EXISTS total_length_cm INTEGER,
ADD COLUMN IF NOT EXISTS total_width_cm INTEGER,
ADD COLUMN IF NOT EXISTS total_height_cm INTEGER;