/*
  # Dodaj obsługę "Zapytań" w taskach

  1. Zmiany
    - Dodaje kolumnę `is_inquiry` (boolean) do tabeli `tasks` - pozwala oznaczyć task jako szybkie zapytanie od potencjalnego klienta
    - Dodaje kolumnę `inquiry_details` (jsonb) - przechowuje szczegóły zapytania: termin, lokalizacja, zakres, budżet, oczekiwania, dane kontaktowe
    - Dodaje indeks dla szybkiego filtrowania zapytań

  2. Bezpieczeństwo
    - Kolumny są opcjonalne (mają wartości domyślne)
    - RLS pozostaje bez zmian - zapytania używają tych samych polityk co taski
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'is_inquiry'
  ) THEN
    ALTER TABLE tasks ADD COLUMN is_inquiry boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'inquiry_details'
  ) THEN
    ALTER TABLE tasks ADD COLUMN inquiry_details jsonb;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_is_inquiry ON tasks(is_inquiry) WHERE is_inquiry = true;
