/*
  # Dodanie indywidualnych uprawnień do zakładek eventów dla pracowników

  1. Zmiany
    - Dodanie kolumny `event_tabs` do tabeli `employees`
    - Kolumna przechowuje indywidualne uprawnienia pracownika do zakładek
    - Jeśli NULL, używane są uprawnienia z access_level
    
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

-- Dodaj kolumnę event_tabs do employees
ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS event_tabs text[] DEFAULT NULL;

-- Dodaj komentarz do kolumny
COMMENT ON COLUMN employees.event_tabs IS 'Indywidualne uprawnienia pracownika do zakładek eventów. Jeśli NULL, używane są uprawnienia z access_level';