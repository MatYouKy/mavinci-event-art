/*
  # Dodanie pól specyficznych dla kategorii Przewody

  ## Opis zmian
  Dla sprzętu z kategorii "Przewody" potrzebne są dodatkowe pola:
  - Długość kabla (w metrach)
  - Wtyk wejściowy (connector_in)
  - Wtyk wyjściowy (connector_out)

  ## Zmiany
  1. Dodanie kolumny `cable_specs` (JSONB) do tabeli `equipment_items`
  2. Kolumna może zawierać:
     - length_meters: number (długość w metrach)
     - connector_in_id: uuid (ID wtyka wejściowego)
     - connector_out_id: uuid (ID wtyka wyjściowego)

  ## Przykład danych
  {
    "length_meters": 10,
    "connector_in_id": "uuid",
    "connector_out_id": "uuid"
  }

  ## Notatki
  - To pole jest opcjonalne i używane tylko dla przewodów
  - JSONB pozwala na elastyczność bez tworzenia osobnych tabel
  - W przyszłości można łatwo dodać inne pola specyficzne dla różnych kategorii
*/

-- Dodaj kolumnę cable_specs do equipment_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'equipment_items' AND column_name = 'cable_specs'
  ) THEN
    ALTER TABLE equipment_items ADD COLUMN cable_specs jsonb;
  END IF;
END $$;

COMMENT ON COLUMN equipment_items.cable_specs IS 'Specyfikacja techniczna dla przewodów (długość, wtyki). Format: {"length_meters": 10, "connector_in_id": "uuid", "connector_out_id": "uuid"}';

-- Utwórz indeks GIN dla szybszego wyszukiwania w JSONB
CREATE INDEX IF NOT EXISTS idx_equipment_items_cable_specs ON equipment_items USING gin (cable_specs);
