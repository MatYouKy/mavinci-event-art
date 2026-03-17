/*
  # Rozbudowa systemu podwykonawców

  1. Nowe tabele
    - subcontractor_services: Typy usług świadczonych przez podwykonawców
    - subcontractor_service_catalog: Katalog produktów/usług podwykonawcy
    - subcontractor_equipment_catalog: Katalog sprzętu do wynajęcia
    - subcontractor_transport_catalog: Katalog transportu (do rozbudowy)

  2. Typy usług
    - transport: Usługi transportowe
    - services: Usługi eventowe (jak w offer_products)
    - rental: Wynajem sprzętu

  3. Uwagi
    - Podwykonawcy mają swoje osoby kontaktowe (contact_persons)
    - Mogą świadczyć jeden lub więcej typów usług jednocześnie
    - Każdy typ usługi ma własny katalog produktów
*/

-- Dodaj typy usług podwykonawców
CREATE TABLE IF NOT EXISTS subcontractor_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontractor_id uuid NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  service_type text NOT NULL CHECK (service_type IN ('transport', 'services', 'rental')),
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(subcontractor_id, service_type)
);

-- Katalog usług eventowych (podobnie jak offer_products)
CREATE TABLE IF NOT EXISTS subcontractor_service_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontractor_id uuid NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text,
  unit_price numeric(10,2),
  unit text DEFAULT 'szt',
  thumbnail_url text,
  is_active boolean DEFAULT true,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Katalog sprzętu do wynajęcia (podobnie jak equipment_items)
CREATE TABLE IF NOT EXISTS subcontractor_equipment_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontractor_id uuid NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text,
  daily_rental_price numeric(10,2),
  quantity_available integer DEFAULT 1,
  thumbnail_url text,
  specifications jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Katalog transportu (do rozbudowy w przyszłości)
CREATE TABLE IF NOT EXISTS subcontractor_transport_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontractor_id uuid NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  vehicle_type text NOT NULL,
  description text,
  capacity_kg numeric(10,2),
  capacity_m3 numeric(10,2),
  price_per_km numeric(10,2),
  daily_rate numeric(10,2),
  is_active boolean DEFAULT true,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_subcontractor_services_type ON subcontractor_services(subcontractor_id, service_type, is_active);
CREATE INDEX IF NOT EXISTS idx_subcontractor_service_catalog_active ON subcontractor_service_catalog(subcontractor_id, is_active);
CREATE INDEX IF NOT EXISTS idx_subcontractor_equipment_catalog_active ON subcontractor_equipment_catalog(subcontractor_id, is_active);
CREATE INDEX IF NOT EXISTS idx_subcontractor_transport_catalog_active ON subcontractor_transport_catalog(subcontractor_id, is_active);

-- Powiązanie subcontractor_tasks z katalogami
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subcontractor_tasks' AND column_name = 'service_catalog_id'
  ) THEN
    ALTER TABLE subcontractor_tasks ADD COLUMN service_catalog_id uuid REFERENCES subcontractor_service_catalog(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subcontractor_tasks' AND column_name = 'equipment_catalog_id'
  ) THEN
    ALTER TABLE subcontractor_tasks ADD COLUMN equipment_catalog_id uuid REFERENCES subcontractor_equipment_catalog(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subcontractor_tasks' AND column_name = 'transport_catalog_id'
  ) THEN
    ALTER TABLE subcontractor_tasks ADD COLUMN transport_catalog_id uuid REFERENCES subcontractor_transport_catalog(id) ON DELETE SET NULL;
  END IF;
END $$;

-- RLS Policies
ALTER TABLE subcontractor_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_service_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_equipment_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_transport_catalog ENABLE ROW LEVEL SECURITY;

-- Polityki dla subcontractor_services
CREATE POLICY "Allow read subcontractor_services for authenticated users"
  ON subcontractor_services FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow insert subcontractor_services for users with subcontractors_manage"
  ON subcontractor_services FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'subcontractors_manage' = ANY(permissions)
    )
  );

CREATE POLICY "Allow update subcontractor_services for users with subcontractors_manage"
  ON subcontractor_services FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'subcontractors_manage' = ANY(permissions)
    )
  );

CREATE POLICY "Allow delete subcontractor_services for users with subcontractors_manage"
  ON subcontractor_services FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'subcontractors_manage' = ANY(permissions)
    )
  );

-- Polityki dla subcontractor_service_catalog
CREATE POLICY "Allow read subcontractor_service_catalog for authenticated users"
  ON subcontractor_service_catalog FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow manage subcontractor_service_catalog for users with subcontractors_manage"
  ON subcontractor_service_catalog FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'subcontractors_manage' = ANY(permissions)
    )
  );

-- Polityki dla subcontractor_equipment_catalog
CREATE POLICY "Allow read subcontractor_equipment_catalog for authenticated users"
  ON subcontractor_equipment_catalog FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow manage subcontractor_equipment_catalog for users with subcontractors_manage"
  ON subcontractor_equipment_catalog FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'subcontractors_manage' = ANY(permissions)
    )
  );

-- Polityki dla subcontractor_transport_catalog
CREATE POLICY "Allow read subcontractor_transport_catalog for authenticated users"
  ON subcontractor_transport_catalog FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow manage subcontractor_transport_catalog for users with subcontractors_manage"
  ON subcontractor_transport_catalog FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'subcontractors_manage' = ANY(permissions)
    )
  );

-- Widok rozszerzony podwykonawców z informacją o usługach
CREATE OR REPLACE VIEW subcontractors_with_services AS
SELECT 
  s.*,
  ARRAY_AGG(DISTINCT ss.service_type) FILTER (WHERE ss.service_type IS NOT NULL AND ss.is_active = true) as service_types,
  COUNT(DISTINCT ssc.id) FILTER (WHERE ssc.is_active = true) as services_count,
  COUNT(DISTINCT sec.id) FILTER (WHERE sec.is_active = true) as equipment_count,
  COUNT(DISTINCT stc.id) FILTER (WHERE stc.is_active = true) as transport_count
FROM subcontractors s
LEFT JOIN subcontractor_services ss ON ss.subcontractor_id = s.id
LEFT JOIN subcontractor_service_catalog ssc ON ssc.subcontractor_id = s.id
LEFT JOIN subcontractor_equipment_catalog sec ON sec.subcontractor_id = s.id
LEFT JOIN subcontractor_transport_catalog stc ON stc.subcontractor_id = s.id
GROUP BY s.id;

COMMENT ON TABLE subcontractor_services IS 'Typy usług świadczonych przez podwykonawców (transport, services, rental)';
COMMENT ON TABLE subcontractor_service_catalog IS 'Katalog usług eventowych oferowanych przez podwykonawcę';
COMMENT ON TABLE subcontractor_equipment_catalog IS 'Katalog sprzętu dostępnego do wynajęcia od podwykonawcy';
COMMENT ON TABLE subcontractor_transport_catalog IS 'Katalog usług transportowych podwykonawcy';
COMMENT ON VIEW subcontractors_with_services IS 'Widok podwykonawców z informacją o typach usług i liczbie produktów w katalogach';