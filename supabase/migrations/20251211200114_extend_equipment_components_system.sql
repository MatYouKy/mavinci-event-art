/*
  # Rozszerzenie systemu komponentów sprzętu

  1. Zmiany w equipment_components
    - Dodaj `thumbnail_url` (text) - zdjęcie komponentu integralnego
    - Dodaj `technical_specs` (jsonb) - parametry techniczne komponentu
    - Dodaj `is_integral` (boolean) - czy komponent jest integralny (tylko dla tego sprzętu) czy z magazynu

  2. Nowa tabela: equipment_compatible_items
    - Przechowuje "skład opcjonalny (pasujący)" - produkty z magazynu które pasują do danego sprzętu
    - Pomaga pracownikom w doborze akcesoriów (np. nogi do podestu, wysłona, błędy)
    - `equipment_id` - główny sprzęt
    - `compatible_equipment_id` - sprzęt który pasuje jako akcesorium
    - `compatibility_type` - typ kompatybilności (required, recommended, optional)
    - `notes` - notatki o kompatybilności

  3. Bezpieczeństwo
    - RLS policies dla obu tabel
    - Tylko użytkownicy z uprawnieniem equipment_manage mogą edytować

  4. Opis zmian
    - Komponenty integralne to elementy które są częścią sprzętu (np. zasilacz w nagłośnieniu)
    - Mają własne zdjęcia i specyfikacje, ale nie są osobnymi produktami w magazynie
    - Kompatybilne produkty to akcesoria które można dobierać (np. nogi do podestu)
*/

-- Dodaj nowe kolumny do equipment_components
ALTER TABLE equipment_components
ADD COLUMN IF NOT EXISTS thumbnail_url text,
ADD COLUMN IF NOT EXISTS technical_specs jsonb,
ADD COLUMN IF NOT EXISTS is_integral boolean DEFAULT false;

COMMENT ON COLUMN equipment_components.thumbnail_url IS 'Zdjęcie komponentu integralnego (dla komponentów bez component_equipment_id)';
COMMENT ON COLUMN equipment_components.technical_specs IS 'Parametry techniczne komponentu integralnego (np. {power: "500W", voltage: "230V"})';
COMMENT ON COLUMN equipment_components.is_integral IS 'True = komponent integralny (tylko dla tego sprzętu), False = z magazynu (component_equipment_id)';

-- Stwórz tabelę dla kompatybilnych produktów
CREATE TABLE IF NOT EXISTS equipment_compatible_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  compatible_equipment_id uuid NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  compatibility_type text NOT NULL CHECK (compatibility_type IN ('required', 'recommended', 'optional')),
  notes text,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(equipment_id, compatible_equipment_id)
);

CREATE INDEX IF NOT EXISTS idx_equipment_compatible_items_equipment_id 
ON equipment_compatible_items(equipment_id);

CREATE INDEX IF NOT EXISTS idx_equipment_compatible_items_compatible_equipment_id 
ON equipment_compatible_items(compatible_equipment_id);

COMMENT ON TABLE equipment_compatible_items IS 'Produkty z magazynu które pasują jako akcesoria do danego sprzętu';
COMMENT ON COLUMN equipment_compatible_items.compatibility_type IS 'required = wymagane, recommended = zalecane, optional = opcjonalne';

-- RLS dla equipment_components (already exists, just make sure it has proper policies)
ALTER TABLE equipment_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access for equipment_view" ON equipment_components;
CREATE POLICY "Allow read access for equipment_view" 
ON equipment_components FOR SELECT 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM employees
    WHERE employees.id = auth.uid()
    AND ('equipment_view' = ANY(employees.permissions) OR 'admin' = ANY(employees.permissions))
  )
);

DROP POLICY IF EXISTS "Allow all for equipment_manage" ON equipment_components;
CREATE POLICY "Allow all for equipment_manage" 
ON equipment_components FOR ALL 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM employees
    WHERE employees.id = auth.uid()
    AND ('equipment_manage' = ANY(employees.permissions) OR 'admin' = ANY(employees.permissions))
  )
);

-- RLS dla equipment_compatible_items
ALTER TABLE equipment_compatible_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access for equipment_view" 
ON equipment_compatible_items FOR SELECT 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM employees
    WHERE employees.id = auth.uid()
    AND ('equipment_view' = ANY(employees.permissions) OR 'admin' = ANY(employees.permissions))
  )
);

CREATE POLICY "Allow all for equipment_manage" 
ON equipment_compatible_items FOR ALL 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM employees
    WHERE employees.id = auth.uid()
    AND ('equipment_manage' = ANY(employees.permissions) OR 'admin' = ANY(employees.permissions))
  )
);
