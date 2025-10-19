/*
  # Funkcja porównywania poziomów umiejętności

  1. Funkcje pomocnicze
    - `proficiency_to_number()` - konwertuje poziom tekstowy na liczbę
    - Ułatwia porównywanie poziomów umiejętności

  2. Poziomy
    - basic = 1
    - intermediate = 2
    - advanced = 3
    - expert = 4

  3. Zastosowanie
    - Umożliwia porównywanie: WHERE proficiency_to_number(level) >= proficiency_to_number('intermediate')
*/

-- Funkcja konwertująca poziom umiejętności na liczbę
CREATE OR REPLACE FUNCTION proficiency_to_number(level text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE level
    WHEN 'basic' THEN 1
    WHEN 'intermediate' THEN 2
    WHEN 'advanced' THEN 3
    WHEN 'expert' THEN 4
    ELSE 0
  END;
END;
$$;

-- Dodaj indeks funkcyjny dla lepszej wydajności
CREATE INDEX IF NOT EXISTS idx_employee_skills_proficiency_number
  ON employee_skills (proficiency_to_number(proficiency_level));

CREATE INDEX IF NOT EXISTS idx_equipment_skill_requirements_proficiency_number
  ON equipment_skill_requirements (proficiency_to_number(minimum_proficiency));
