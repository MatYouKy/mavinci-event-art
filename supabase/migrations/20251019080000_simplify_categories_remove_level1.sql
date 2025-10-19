/*
  # Uproszczenie struktury kategorii magazynu

  1. Zmiany
    - Usunięcie Level 0 (MAGAZYN) i Level 1 (Sprzęt, Materiały, Akcesoria)
    - Przeniesienie Level 2 kategorii na Level 1 (główne kategorie)
    - Przeniesienie Level 3 podkategorii na Level 2 (podkategorie)
    - Dodanie nowej kategorii "Dekoracje"
    - Nowa struktura:
      * Level 1 (główne): Dźwięk, Oświetlenie, Video, Scena, Efekty specjalne, Dekoracje
      * Level 2 (podkategorie): Mikrofony, Głośniki, Moving Heads, etc.

  2. Bezpieczeństwo
    - Zachowanie istniejących polityk RLS
*/

-- Najpierw zaktualizujmy parent_id dla kategorii Level 2 (będą głównymi)
UPDATE warehouse_categories
SET parent_id = NULL, level = 1
WHERE level = 2;

-- Zaktualizujmy level dla kategorii Level 3 (będą podkategoriami)
UPDATE warehouse_categories
SET level = 2
WHERE level = 3;

-- Zaktualizujmy parent_id dla podkategorii - muszą wskazywać na nowe główne kategorie
-- (to już jest OK, bo Level 3 wskazywały na Level 2)

-- Usuńmy stare kategorie Level 0 i Level 1
DELETE FROM warehouse_categories WHERE level = 0;
DELETE FROM warehouse_categories WHERE level > 2; -- na wszelki wypadek

-- Dodajmy nową kategorię "Dekoracje"
INSERT INTO warehouse_categories (parent_id, name, description, level, order_index, icon, color)
VALUES
  (NULL, 'Dekoracje', 'Elementy dekoracyjne i scenografia', 1, 5, 'sparkles', '#10b981');

-- Dodajmy przykładowe podkategorie dla Dekoracji
INSERT INTO warehouse_categories (parent_id, name, level, order_index)
SELECT
  id,
  subcategory,
  2,
  idx - 1
FROM warehouse_categories
CROSS JOIN LATERAL (
  VALUES
    ('Tkaniny i materiały'),
    ('Meble sceniczne'),
    ('Rośliny i kwiaty'),
    ('Rekwizyty')
) AS subs(subcategory)
CROSS JOIN LATERAL generate_series(1, 4) AS idx
WHERE name = 'Dekoracje' AND level = 1
LIMIT 4;

-- Sprawdźmy czy wszystko jest OK
-- Powinniśmy mieć:
-- Level 1: Główne kategorie (Dźwięk, Oświetlenie, Video, Scena, Efekty specjalne, Dekoracje)
-- Level 2: Podkategorie (Mikrofony, Głośniki, Moving Heads, etc.)

-- Dodajmy constraint aby zapewnić max 2 poziomy
ALTER TABLE warehouse_categories DROP CONSTRAINT IF EXISTS warehouse_categories_level_check;
ALTER TABLE warehouse_categories ADD CONSTRAINT warehouse_categories_level_check
  CHECK (level >= 1 AND level <= 2);
