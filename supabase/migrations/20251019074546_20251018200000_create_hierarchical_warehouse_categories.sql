/*
  # Hierarchiczne kategorie magazynu

  1. Zmiany
    - Usunięcie starych tabel equipment_categories i equipment_subcategories
    - Utworzenie nowej tabeli warehouse_categories z samoreferencją (parent_id)
    - Migracja danych z equipment_items
    - Dodanie przykładowej hierarchii:
      * MAGAZYN (root)
        * Sprzęt (level 1)
          * Dźwięk (level 2)
            * Mikrofony, Głośniki, Miksery, itp. (level 3)
          * Oświetlenie (level 2)
            * Moving Heads, PAR, Lasery, itp. (level 3)
          * Video (level 2)
            * Projektory, Ekrany, Kamery, itp. (level 3)
        * Materiały (level 1)
        * Akcesoria (level 1)

  2. Bezpieczeństwo
    - Włączenie RLS dla warehouse_categories
    - Publiczny odczyt, admin do zapisu
*/

-- Najpierw usuńmy stare foreign keys z equipment_items
ALTER TABLE equipment_items DROP CONSTRAINT IF EXISTS equipment_items_category_id_fkey;
ALTER TABLE equipment_items DROP CONSTRAINT IF EXISTS equipment_items_subcategory_id_fkey;

-- Usuńmy stare tabele
DROP TABLE IF EXISTS equipment_subcategories CASCADE;
DROP TABLE IF EXISTS equipment_categories CASCADE;

-- Tworzymy nową tabelę hierarchicznych kategorii
CREATE TABLE IF NOT EXISTS warehouse_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES warehouse_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  icon text,
  color text DEFAULT '#d3bb73',
  order_index integer DEFAULT 0,
  level integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indeksy dla wydajności
CREATE INDEX IF NOT EXISTS warehouse_categories_parent_id_idx ON warehouse_categories(parent_id);
CREATE INDEX IF NOT EXISTS warehouse_categories_level_idx ON warehouse_categories(level);
CREATE INDEX IF NOT EXISTS warehouse_categories_active_idx ON warehouse_categories(is_active);

-- Dodajmy kategorie root - MAGAZYN
INSERT INTO warehouse_categories (id, parent_id, name, description, level, order_index, icon)
VALUES
  ('00000000-0000-0000-0000-000000000001', NULL, 'Magazyn', 'Główna kategoria magazynu', 0, 0, 'warehouse');

-- Level 1 - Główne kategorie
INSERT INTO warehouse_categories (id, parent_id, name, description, level, order_index, icon)
VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Sprzęt', 'Sprzęt techniczny', 1, 0, 'package'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Materiały', 'Materiały eksploatacyjne', 1, 1, 'layers'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Akcesoria', 'Akcesoria i dodatki', 1, 2, 'wrench');

-- Level 2 - Podkategorie Sprzętu
INSERT INTO warehouse_categories (id, parent_id, name, description, level, order_index, icon, color)
VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Dźwięk', 'Sprzęt audio', 2, 0, 'volume-2', '#3b82f6'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Oświetlenie', 'Sprzęt oświetleniowy', 2, 1, 'lightbulb', '#f59e0b'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Video', 'Sprzęt video', 2, 2, 'video', '#8b5cf6'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Scena', 'Konstrukcje sceniczne', 2, 3, 'layers', '#ef4444'),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'Efekty specjalne', 'Efekty sceniczne', 2, 4, 'sparkles', '#ec4899');

-- Level 3 - Pod-podkategorie Dźwięku
INSERT INTO warehouse_categories (parent_id, name, level, order_index)
VALUES
  ('20000000-0000-0000-0000-000000000001', 'Mikrofony', 3, 0),
  ('20000000-0000-0000-0000-000000000001', 'Głośniki', 3, 1),
  ('20000000-0000-0000-0000-000000000001', 'Subwoofery', 3, 2),
  ('20000000-0000-0000-0000-000000000001', 'Miksery audio', 3, 3),
  ('20000000-0000-0000-0000-000000000001', 'Procesory audio', 3, 4),
  ('20000000-0000-0000-0000-000000000001', 'Wzmacniacze', 3, 5),
  ('20000000-0000-0000-0000-000000000001', 'Monitory sceniczne', 3, 6);

-- Level 3 - Pod-podkategorie Oświetlenia
INSERT INTO warehouse_categories (parent_id, name, level, order_index)
VALUES
  ('20000000-0000-0000-0000-000000000002', 'Moving Heads', 3, 0),
  ('20000000-0000-0000-0000-000000000002', 'PAR LED', 3, 1),
  ('20000000-0000-0000-0000-000000000002', 'Lasery', 3, 2),
  ('20000000-0000-0000-0000-000000000002', 'Stroboskopy', 3, 3),
  ('20000000-0000-0000-0000-000000000002', 'Reflektory profilowe', 3, 4),
  ('20000000-0000-0000-0000-000000000002', 'Konsole świetlne', 3, 5),
  ('20000000-0000-0000-0000-000000000002', 'Splinery DMX', 3, 6);

-- Level 3 - Pod-podkategorie Video
INSERT INTO warehouse_categories (parent_id, name, level, order_index)
VALUES
  ('20000000-0000-0000-0000-000000000003', 'Projektory', 3, 0),
  ('20000000-0000-0000-0000-000000000003', 'Ekrany projekcyjne', 3, 1),
  ('20000000-0000-0000-0000-000000000003', 'Kamery', 3, 2),
  ('20000000-0000-0000-0000-000000000003', 'Miksery video', 3, 3),
  ('20000000-0000-0000-0000-000000000003', 'Procesory video', 3, 4),
  ('20000000-0000-0000-0000-000000000003', 'Ścianki LED', 3, 5);

-- Level 3 - Pod-podkategorie Sceny
INSERT INTO warehouse_categories (parent_id, name, level, order_index)
VALUES
  ('20000000-0000-0000-0000-000000000004', 'Podesty sceniczne', 3, 0),
  ('20000000-0000-0000-0000-000000000004', 'Konstrukcje aluminiowe', 3, 1),
  ('20000000-0000-0000-0000-000000000004', 'Dachy sceniczne', 3, 2);

-- Level 3 - Pod-podkategorie Efektów specjalnych
INSERT INTO warehouse_categories (parent_id, name, level, order_index)
VALUES
  ('20000000-0000-0000-0000-000000000005', 'Wytwornice dymu', 3, 0),
  ('20000000-0000-0000-0000-000000000005', 'Wytwornice mgły', 3, 1),
  ('20000000-0000-0000-0000-000000000005', 'Confetti blasters', 3, 2),
  ('20000000-0000-0000-0000-000000000005', 'Maszyny bąbelkowe', 3, 3);

-- Aktualizujemy equipment_items - usuwamy stare kolumny i dodajemy nową
ALTER TABLE equipment_items DROP COLUMN IF EXISTS category_id;
ALTER TABLE equipment_items DROP COLUMN IF EXISTS subcategory_id;
ALTER TABLE equipment_items ADD COLUMN IF NOT EXISTS warehouse_category_id uuid REFERENCES warehouse_categories(id) ON DELETE SET NULL;

-- Indeks dla nowej kolumny
CREATE INDEX IF NOT EXISTS equipment_items_warehouse_category_id_idx ON equipment_items(warehouse_category_id);

-- RLS dla warehouse_categories
ALTER TABLE warehouse_categories ENABLE ROW LEVEL SECURITY;

-- Każdy może czytać aktywne kategorie
CREATE POLICY "Anyone can read active warehouse categories"
  ON warehouse_categories
  FOR SELECT
  USING (is_active = true);

-- Tylko użytkownicy z uprawnieniami 'equipment_manage' mogą zarządzać kategoriami
CREATE POLICY "Employees with equipment_manage can manage warehouse categories"
  ON warehouse_categories
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment_manage' = ANY(employees.permissions)
    )
  );

-- Funkcja pomocnicza do pobierania pełnej ścieżki kategorii
CREATE OR REPLACE FUNCTION get_category_path(category_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  path text := '';
  current_id uuid := category_id;
  current_name text;
  current_parent_id uuid;
BEGIN
  WHILE current_id IS NOT NULL LOOP
    SELECT name, parent_id INTO current_name, current_parent_id
    FROM warehouse_categories
    WHERE id = current_id;

    IF path = '' THEN
      path := current_name;
    ELSE
      path := current_name || ' > ' || path;
    END IF;

    current_id := current_parent_id;
  END LOOP;

  RETURN path;
END;
$$;
