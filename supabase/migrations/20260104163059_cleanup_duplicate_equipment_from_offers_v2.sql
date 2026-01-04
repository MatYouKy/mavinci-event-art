/*
  # Usuń duplikaty sprzętów z ofert - v2

  1. Problem
    - W event_equipment są duplikaty sprzętów z oferty
    - Ten sam equipment_id + offer_id występuje 2 razy
    - Powstały gdy działały dwa triggery jednocześnie

  2. Rozwiązanie
    - Zidentyfikuj duplikaty (ten sam event_id, equipment_id/kit_id/cable_id, offer_id)
    - Zachowaj tylko jeden wpis (najnowszy)
    - Usuń pozostałe duplikaty
    - Dodaj unique partial index (tylko dla offer_id IS NOT NULL)

  3. Notatki
    - Nie dodajemy CONSTRAINT (problem z NULL values)
    - Używamy PARTIAL UNIQUE INDEX tylko dla wierszy z offer_id
*/

-- Usuń duplikaty dla equipment_items
WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY event_id, equipment_id, offer_id 
      ORDER BY created_at DESC, id DESC
    ) as rn
  FROM event_equipment
  WHERE equipment_id IS NOT NULL
    AND offer_id IS NOT NULL
    AND auto_added = true
)
DELETE FROM event_equipment
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Usuń duplikaty dla kitów
WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY event_id, kit_id, offer_id 
      ORDER BY created_at DESC, id DESC
    ) as rn
  FROM event_equipment
  WHERE kit_id IS NOT NULL
    AND offer_id IS NOT NULL
    AND auto_added = true
)
DELETE FROM event_equipment
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Usuń duplikaty dla kabli
WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY event_id, cable_id, offer_id 
      ORDER BY created_at DESC, id DESC
    ) as rn
  FROM event_equipment
  WHERE cable_id IS NOT NULL
    AND offer_id IS NOT NULL
    AND auto_added = true
)
DELETE FROM event_equipment
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Dodaj partial unique index dla equipment_id (tylko gdzie offer_id IS NOT NULL)
DROP INDEX IF EXISTS idx_event_equipment_unique_equipment_offer;
CREATE UNIQUE INDEX idx_event_equipment_unique_equipment_offer 
ON event_equipment (event_id, equipment_id, offer_id)
WHERE equipment_id IS NOT NULL AND offer_id IS NOT NULL;

-- Dodaj partial unique index dla kit_id
DROP INDEX IF EXISTS idx_event_equipment_unique_kit_offer;
CREATE UNIQUE INDEX idx_event_equipment_unique_kit_offer 
ON event_equipment (event_id, kit_id, offer_id)
WHERE kit_id IS NOT NULL AND offer_id IS NOT NULL;

-- Dodaj partial unique index dla cable_id
DROP INDEX IF EXISTS idx_event_equipment_unique_cable_offer;
CREATE UNIQUE INDEX idx_event_equipment_unique_cable_offer 
ON event_equipment (event_id, cable_id, offer_id)
WHERE cable_id IS NOT NULL AND offer_id IS NOT NULL;

-- Sprawdź wyniki
DO $$
DECLARE
  v_remaining_dupes int;
BEGIN
  -- Sprawdź czy są jeszcze duplikaty
  SELECT COUNT(*) INTO v_remaining_dupes
  FROM (
    SELECT event_id, equipment_id, kit_id, cable_id, offer_id, COUNT(*) as cnt
    FROM event_equipment
    WHERE offer_id IS NOT NULL AND auto_added = true
    GROUP BY event_id, equipment_id, kit_id, cable_id, offer_id
    HAVING COUNT(*) > 1
  ) sub;
  
  IF v_remaining_dupes > 0 THEN
    RAISE WARNING 'Pozostało % grup duplikatów!', v_remaining_dupes;
  ELSE
    RAISE NOTICE 'Wszystkie duplikaty usunięte. Utworzono indeksy unikalne.';
  END IF;
END $$;
