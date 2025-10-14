/*
  # Dodanie kolumny preferred_view_mode do tabeli employees

  ## Opis zmian
  Użytkownicy będą mogli zapisywać swoje preferencje dotyczące widoku sprzętu/wtyków.
  To pozwoli na zachowanie wybranego trybu widoku (compact, list, grid) między sesjami.

  ## Zmiany
  1. Dodanie kolumny `preferred_view_mode` do tabeli `employees`
     - Typ: text
     - Dozwolone wartości: 'compact', 'list', 'grid'
     - Domyślna wartość: 'list'
     - Opcjonalna (nullable)

  ## Notatki
  - Kolumna jest opcjonalna - jeśli nie ustawiona, używana jest wartość domyślna 'list'
  - Każdy użytkownik może mieć własne preferencje
  - Check constraint zapewnia tylko poprawne wartości
*/

-- Dodaj kolumnę preferred_view_mode do employees
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'preferred_view_mode'
  ) THEN
    ALTER TABLE employees 
    ADD COLUMN preferred_view_mode text DEFAULT 'list' CHECK (preferred_view_mode IN ('compact', 'list', 'grid'));
  END IF;
END $$;

COMMENT ON COLUMN employees.preferred_view_mode IS 'Preferowany tryb wyświetlania list (compact, list, grid). Domyślnie: list';
