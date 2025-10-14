/*
  # Zmiana permissions z JSONB na TEXT[] array

  ## Zmiany
  - Zmiana typu kolumny permissions na TEXT[]
  - Migracja danych: konwersja {key: true} na ['key']
*/

-- Funkcja pomocnicza
CREATE OR REPLACE FUNCTION jsonb_object_to_text_array(obj JSONB)
RETURNS TEXT[] AS $$
  SELECT ARRAY(
    SELECT key::TEXT 
    FROM jsonb_each(obj) 
    WHERE value::TEXT = 'true'
  );
$$ LANGUAGE SQL IMMUTABLE;

-- Usuń domyślną wartość
ALTER TABLE employees ALTER COLUMN permissions DROP DEFAULT;

-- Zmiana typu
ALTER TABLE employees 
  ALTER COLUMN permissions TYPE TEXT[] 
  USING CASE 
    WHEN permissions IS NULL THEN ARRAY[]::TEXT[]
    WHEN jsonb_typeof(permissions) = 'object' THEN jsonb_object_to_text_array(permissions)
    ELSE ARRAY[]::TEXT[]
  END;

-- Nowa domyślna wartość
ALTER TABLE employees ALTER COLUMN permissions SET DEFAULT ARRAY[]::TEXT[];

-- Cleanup
DROP FUNCTION IF EXISTS jsonb_object_to_text_array(JSONB);