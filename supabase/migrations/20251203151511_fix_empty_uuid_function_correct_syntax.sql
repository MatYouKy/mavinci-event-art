/*
  # Napraw funkcję fix_empty_uuid - poprawna składnia porównania UUID

  1. Problem
    - Funkcja fix_empty_uuid() próbuje porównać UUID z '' używając = 
    - To powoduje błąd "invalid input syntax for type uuid: ''"
    - UUID nie może być bezpośrednio porównywane z pustym stringiem
  
  2. Rozwiązanie
    - Użyj ::text do konwersji UUID na text przed porównaniem
    - Albo użyj NULLIF który automatycznie obsługuje taką konwersję
*/

CREATE OR REPLACE FUNCTION fix_empty_uuid()
RETURNS TRIGGER AS $$
BEGIN
  -- Konwertuj UUID na text przed porównaniem z pustym stringiem
  IF NEW.event_id IS NOT NULL AND NEW.event_id::text = '' THEN
    NEW.event_id = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fix_empty_uuid() IS 
'Zamienia puste stringi UUID na NULL - używa konwersji ::text przed porównaniem';