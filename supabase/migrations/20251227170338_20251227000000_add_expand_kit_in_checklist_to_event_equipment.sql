/*
  # Dodaj pole expand_kit_in_checklist do event_equipment

  1. Zmiany
    - Dodanie kolumny `expand_kit_in_checklist` do tabeli `event_equipment`
    - Kontroluje czy zestaw ma być rozwinięty w checkliście sprzętu
    - Jeśli true, wszystkie elementy zestawu są pokazywane jako osobne pozycje
    - Jeśli false, tylko nazwa zestawu jest pokazywana
  
  2. Notatki
    - Domyślnie false - zestawy nie są rozwijane
    - Użytkownik może zdecydować czy chce widzieć szczegóły zestawu w checkliście
*/

ALTER TABLE event_equipment
ADD COLUMN IF NOT EXISTS expand_kit_in_checklist boolean DEFAULT false;

COMMENT ON COLUMN event_equipment.expand_kit_in_checklist IS 'True = rozwiń zestaw w checkliście (pokaż wszystkie elementy), False = pokaż tylko nazwę zestawu';
