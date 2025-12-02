/*
  # Dodanie PESEL do kontaktów

  1. Zmiany
    - Dodanie kolumny `pesel` do tabeli `contacts`
    - PESEL dla klientów indywidualnych (11 cyfr)
    - Opcjonalne pole (nullable)

  2. Walidacja
    - Tekst (może zawierać myślniki)
    - Maksymalnie 15 znaków (z myślnikami)
*/

-- Dodaj kolumnę PESEL do contacts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contacts' AND column_name = 'pesel'
  ) THEN
    ALTER TABLE contacts ADD COLUMN pesel text;
    ALTER TABLE contacts ADD CONSTRAINT pesel_length CHECK (length(pesel) <= 15);
  END IF;
END $$;

-- Dodaj komentarz
COMMENT ON COLUMN contacts.pesel IS 'PESEL klienta indywidualnego (11 cyfr, opcjonalnie z myślnikami)';
