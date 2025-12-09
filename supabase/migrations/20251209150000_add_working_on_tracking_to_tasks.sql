/*
  # Dodanie śledzenia kto aktualnie pracuje nad zadaniem

  1. Zmiany
    - Dodanie kolumny `currently_working_by` do tabeli tasks
    - Kolumna przechowuje ID pracownika który przeniósł zadanie do "w trakcie"
    - Automatyczne czyszczenie gdy zadanie wychodzi z "w trakcie"
    
  2. Bezpieczeństwo
    - Foreign key do tabeli employees
    - Nullable - nie każde zadanie musi być w trakcie
*/

-- Dodaj kolumnę do śledzenia kto aktualnie pracuje nad zadaniem
ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS currently_working_by uuid REFERENCES employees(id) ON DELETE SET NULL;

-- Dodaj komentarz
COMMENT ON COLUMN tasks.currently_working_by IS 'ID pracownika który przeniósł zadanie do "w trakcie" i aktualnie nad nim pracuje';

-- Dodaj indeks dla wydajności
CREATE INDEX IF NOT EXISTS idx_tasks_currently_working_by 
ON tasks(currently_working_by) 
WHERE currently_working_by IS NOT NULL;
