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
     - connector_in: string (wtyk wejściowy, np. "XLR", "Jack 6.3mm")
     - connector_out: string (wtyk wyjściowy)

  ## Przykład danych
  {
    "length_meters": 10,
    "connector_in": "XLR Male",
    "connector_out": "XLR Female"
  }

  ## Notatki
  - To pole jest opcjonalne i używane tylko dla przewodów
  - JSONB pozwala na elastyczność bez tworzenia osobnych tabel
  - W przyszłości można łatwo dodać inne pola specyficzne dla różnych kategorii
*/

-- Dodaj kolumnę cable_specs do equipment_items
ALTER TABLE equipment_items
ADD COLUMN IF NOT EXISTS cable_specs jsonb;

COMMENT ON COLUMN equipment_items.cable_specs IS 'Specyfikacja techniczna dla przewodów (długość, wtyki). Format: {"length_meters": 10, "connector_in": "XLR Male", "connector_out": "XLR Female"}';

-- Utwórz indeks GIN dla szybszego wyszukiwania w JSONB
CREATE INDEX IF NOT EXISTS idx_equipment_items_cable_specs ON equipment_items USING gin (cable_specs);
