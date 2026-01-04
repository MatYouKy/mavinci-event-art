/*
  # Wyłącz stary trigger auto_assign powodujący dublowanie

  1. Problem
    - Mamy DWA triggery dodające sprzęty z oferty:
      a) trigger_auto_assign_equipment_from_offer_product (stary, listopad 2025)
      b) trg_sync_offer_equipment_items (nowy, grudzień 2025)
    - Oba działają na INSERT w offer_items → powodują dublowanie sprzętów

  2. Rozwiązanie
    - Wyłącz STARY trigger (trigger_auto_assign_equipment_from_offer_product)
    - Pozostaw NOWY system (trg_sync_offer_equipment_items + sync_offer_equipment_to_event)
    - Nowy system jest bardziej kompletny:
      * Obsługuje substytucje
      * Obsługuje zestawy (kits)
      * Używa get_offer_equipment_final
      * Ma lepszą synchronizację

  3. Notatki
    - Funkcja auto_assign_equipment_from_offer_product pozostaje w bazie (może być użyta ręcznie)
    - Wyłączony zostaje tylko TRIGGER
    - Nowy system sync_offer_equipment_to_event przejmuje całą funkcjonalność
*/

-- Wyłącz stary trigger
DROP TRIGGER IF EXISTS trigger_auto_assign_equipment_from_offer_product ON offer_items;

-- Komentarz dla jasności
COMMENT ON FUNCTION auto_assign_equipment_from_offer_product() IS 
'[DEPRECATED] Funkcja zastąpiona przez sync_offer_equipment_to_event. Trigger został wyłączony aby uniknąć dublowania sprzętów.';

-- Sprawdź że nowy system działa
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = 'trg_sync_offer_equipment_items'
      AND event_object_table = 'offer_items'
  ) THEN
    RAISE EXCEPTION 'Brak aktywnego triggera trg_sync_offer_equipment_items! Nie można wyłączyć starego triggera.';
  END IF;
  
  RAISE NOTICE 'Stary trigger wyłączony. Aktywny system: trg_sync_offer_equipment_items → sync_offer_equipment_to_event';
END $$;
