/*
  # System podkategorii sprzętu

  ## Zmiany
  
  1. Nowa tabela `equipment_subcategories`
     - `id` (uuid, primary key)
     - `category_id` (uuid, foreign key -> equipment_categories)
     - `name` (text)
     - `description` (text, nullable)
     - `order_index` (integer)
     - `is_active` (boolean)
     - `created_at` (timestamptz)
     - `updated_at` (timestamptz)
  
  2. Modyfikacja tabeli `equipment_items`
     - Dodanie kolumny `subcategory_id` (uuid, foreign key -> equipment_subcategories, nullable)
  
  3. Security
     - Włączenie RLS na nowej tabeli
     - Polityki dostępu dla pracowników z uprawnieniami equipment
*/

-- Utworzenie tabeli podkategorii
CREATE TABLE IF NOT EXISTS equipment_subcategories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES equipment_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  order_index integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Dodanie indeksów dla wydajności
CREATE INDEX IF NOT EXISTS idx_equipment_subcategories_category_id ON equipment_subcategories(category_id);
CREATE INDEX IF NOT EXISTS idx_equipment_subcategories_order_index ON equipment_subcategories(order_index);

-- Dodanie kolumny subcategory_id do equipment_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'equipment_items' AND column_name = 'subcategory_id'
  ) THEN
    ALTER TABLE equipment_items ADD COLUMN subcategory_id uuid REFERENCES equipment_subcategories(id) ON DELETE SET NULL;
    CREATE INDEX idx_equipment_items_subcategory_id ON equipment_items(subcategory_id);
  END IF;
END $$;

-- Włączenie RLS
ALTER TABLE equipment_subcategories ENABLE ROW LEVEL SECURITY;

-- Polityki RLS dla odczytu (wszyscy zalogowani)
CREATE POLICY "Zalogowani użytkownicy mogą przeglądać podkategorie"
  ON equipment_subcategories FOR SELECT
  TO authenticated
  USING (true);

-- Polityki RLS dla zarządzania (tylko z uprawnieniem equipment_manage)
CREATE POLICY "Użytkownicy z equipment_manage mogą dodawać podkategorie"
  ON equipment_subcategories FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Użytkownicy z equipment_manage mogą edytować podkategorie"
  ON equipment_subcategories FOR UPDATE
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

CREATE POLICY "Użytkownicy z equipment_manage mogą usuwać podkategorie"
  ON equipment_subcategories FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'equipment_manage' = ANY(employees.permissions)
    )
  );

-- Trigger dla aktualizacji updated_at
CREATE OR REPLACE FUNCTION update_equipment_subcategories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER equipment_subcategories_updated_at
  BEFORE UPDATE ON equipment_subcategories
  FOR EACH ROW
  EXECUTE FUNCTION update_equipment_subcategories_updated_at();