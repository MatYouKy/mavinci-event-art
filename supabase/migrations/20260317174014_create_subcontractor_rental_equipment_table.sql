/*
  # Dedykowana tabela wynajmu sprzętu od podwykonawców

  1. Nowa tabela
    - subcontractor_rental_equipment: Sprzęt do wynajmu od podwykonawców
    - Zawiera tylko informacje potrzebne do wynajmu (nazwa, cena, wymagane umiejętności, zdjęcia)
    - NIE zawiera informacji o serwisie, zakupach, jednostkach jak w equipment_items

  2. Struktura
    - Podstawowe info (nazwa, opis, kategoria)
    - Ceny (daily_rental_price, weekly_rental_price, monthly_rental_price)
    - Dostępność (quantity_available)
    - Wymagane umiejętności (required_skills)
    - Multimedia (thumbnail_url, images)

  3. Powiązania
    - subcontractor_id -> subcontractors(id)

  4. Bezpieczeństwo
    - RLS włączony
    - Admin i contacts:view mogą przeglądać
    - Admin i contacts:manage mogą edytować
*/

-- Usuń starą tabelę sprzętu (jeśli istnieje)
DROP TABLE IF EXISTS subcontractor_equipment_catalog CASCADE;

-- Utwórz nową dedykowaną tabelę dla wynajmu sprzętu
CREATE TABLE IF NOT EXISTS subcontractor_rental_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontractor_id uuid NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  
  -- Podstawowe informacje
  name text NOT NULL,
  description text,
  category text,
  
  -- Ceny wynajmu
  daily_rental_price numeric(10,2),
  weekly_rental_price numeric(10,2),
  monthly_rental_price numeric(10,2),
  
  -- Dostępność
  quantity_available integer DEFAULT 1,
  
  -- Wymagane umiejętności
  required_skills text[] DEFAULT '{}',
  
  -- Multimedia
  thumbnail_url text,
  images jsonb DEFAULT '[]',
  
  -- Metadata
  specifications jsonb DEFAULT '{}',
  notes text,
  
  -- Status
  is_active boolean DEFAULT true,
  
  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_rental_equipment_subcontractor ON subcontractor_rental_equipment(subcontractor_id, is_active);
CREATE INDEX IF NOT EXISTS idx_rental_equipment_category ON subcontractor_rental_equipment(category);
CREATE INDEX IF NOT EXISTS idx_rental_equipment_active ON subcontractor_rental_equipment(is_active);

-- RLS
ALTER TABLE subcontractor_rental_equipment ENABLE ROW LEVEL SECURITY;

-- Polityki SELECT
CREATE POLICY "Admin and contacts:view can read rental_equipment"
  ON subcontractor_rental_equipment FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:view' = ANY(employees.permissions)
      )
    )
  );

-- Polityki INSERT
CREATE POLICY "Admin and contacts:manage can insert rental_equipment"
  ON subcontractor_rental_equipment FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:manage' = ANY(employees.permissions)
      )
    )
  );

-- Polityki UPDATE
CREATE POLICY "Admin and contacts:manage can update rental_equipment"
  ON subcontractor_rental_equipment FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:manage' = ANY(employees.permissions)
      )
    )
  );

-- Polityki DELETE
CREATE POLICY "Admin and contacts:manage can delete rental_equipment"
  ON subcontractor_rental_equipment FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.access_level = 'admin'
        OR employees.role = 'admin'
        OR 'contacts:manage' = ANY(employees.permissions)
      )
    )
  );