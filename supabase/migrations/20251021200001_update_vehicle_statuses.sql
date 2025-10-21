/*
  # Aktualizacja statusów pojazdów

  Zmiana statusów z 'active' na 'available' i rozszerzenie dozwolonych wartości
*/

-- Usuń stary constraint
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS valid_status;

-- Mapuj stare statusy na nowe
UPDATE vehicles SET status = 'available' WHERE status = 'active';

-- Dodaj nowy constraint z rozszerzonymi statusami
ALTER TABLE vehicles ADD CONSTRAINT valid_status CHECK (
  status IN (
    'available',      -- Dostępny do użytku
    'in_use',         -- W użytkowaniu
    'in_service',     -- W serwisie
    'under_repair',   -- W naprawie (blokuje dostępność)
    'no_insurance',   -- Brak ważnego ubezpieczenia (blokuje)
    'no_inspection',  -- Brak ważnego przeglądu (blokuje)
    'inactive',       -- Nieaktywny (wycofany z użytku)
    'sold',           -- Sprzedany
    'scrapped'        -- Złomowany
  )
);
