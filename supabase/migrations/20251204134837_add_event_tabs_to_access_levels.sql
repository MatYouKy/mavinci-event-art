/*
  # Dodanie uprawnień do zakładek eventów w poziomach dostępu

  1. Zmiany
    - Dodanie kolumny `event_tabs` do tabeli `access_levels`
    - Kolumna przechowuje listę dozwolonych zakładek dla danego poziomu dostępu
    
  2. Dostępne zakładki
    - overview: Przegląd
    - offer: Oferta
    - finances: Finanse
    - contract: Umowa
    - equipment: Sprzęt
    - team: Zespół
    - logistics: Logistyka
    - subcontractors: Podwykonawcy
    - files: Pliki
    - tasks: Zadania
    - history: Historia
*/

-- Dodaj kolumnę event_tabs do access_levels
ALTER TABLE access_levels 
ADD COLUMN IF NOT EXISTS event_tabs text[] DEFAULT ARRAY['overview']::text[];

-- Ustaw domyślne wartości dla istniejących poziomów dostępu
UPDATE access_levels 
SET event_tabs = ARRAY['overview', 'equipment', 'team', 'logistics', 'files', 'tasks', 'history']::text[]
WHERE event_tabs = ARRAY['overview']::text[];

-- Dodaj komentarz do kolumny
COMMENT ON COLUMN access_levels.event_tabs IS 'Lista dozwolonych zakładek w widoku eventu dla tego poziomu dostępu';