/*
  # System Techniki Scenicznej - pełna oferta edytowalna

  1. Nowe tabele
    - `technical_stage_features` - cechy/zalety (ikony + tekst)
    - `technical_stage_services` - kategorie usług
    - `technical_stage_service_items` - szczegółowe usługi
    - `technical_stage_equipment` - sprzęt/realizacje
    - `technical_stage_gallery` - galeria zdjęć
    - `technical_stage_packages` - popularne pakiety

  2. Security
    - Enable RLS na wszystkich tabelach
    - Public read dla visible=true
    - Admin/website_edit write access
*/

-- Technical Stage Features (cechy/zalety)
CREATE TABLE IF NOT EXISTS technical_stage_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  icon_id uuid REFERENCES custom_icons(id) ON DELETE SET NULL,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE technical_stage_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view visible technical stage features"
  ON technical_stage_features FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins manage technical stage features"
  ON technical_stage_features FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage technical stage features"
  ON technical_stage_features FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- Technical Stage Services Categories
CREATE TABLE IF NOT EXISTS technical_stage_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  icon_id uuid REFERENCES custom_icons(id) ON DELETE SET NULL,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE technical_stage_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view visible technical stage services"
  ON technical_stage_services FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins manage technical stage services"
  ON technical_stage_services FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage technical stage services"
  ON technical_stage_services FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- Technical Stage Service Items (detailed services)
CREATE TABLE IF NOT EXISTS technical_stage_service_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid REFERENCES technical_stage_services(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL,
  icon_id uuid REFERENCES custom_icons(id) ON DELETE SET NULL,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE technical_stage_service_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view visible technical stage service items"
  ON technical_stage_service_items FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins manage technical stage service items"
  ON technical_stage_service_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage technical stage service items"
  ON technical_stage_service_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- Technical Stage Equipment/Cases
CREATE TABLE IF NOT EXISTS technical_stage_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  image_url text,
  technical_specs jsonb,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE technical_stage_equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view visible technical stage equipment"
  ON technical_stage_equipment FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins manage technical stage equipment"
  ON technical_stage_equipment FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage technical stage equipment"
  ON technical_stage_equipment FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- Technical Stage Gallery
CREATE TABLE IF NOT EXISTS technical_stage_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text NOT NULL,
  title text,
  description text,
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE technical_stage_gallery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view visible technical stage gallery"
  ON technical_stage_gallery FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins manage technical stage gallery"
  ON technical_stage_gallery FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage technical stage gallery"
  ON technical_stage_gallery FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- Technical Stage Popular Packages
CREATE TABLE IF NOT EXISTS technical_stage_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  image_url text,
  icon_id uuid REFERENCES custom_icons(id) ON DELETE SET NULL,
  price_from decimal(10,2),
  order_index integer NOT NULL DEFAULT 0,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE technical_stage_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view visible technical stage packages"
  ON technical_stage_packages FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins manage technical stage packages"
  ON technical_stage_packages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'admin' = ANY(employees.permissions)));

CREATE POLICY "Website editors manage technical stage packages"
  ON technical_stage_packages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE employees.id = auth.uid() AND 'website_edit' = ANY(employees.permissions)));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tech_features_order ON technical_stage_features(order_index);
CREATE INDEX IF NOT EXISTS idx_tech_services_order ON technical_stage_services(order_index);
CREATE INDEX IF NOT EXISTS idx_tech_items_service ON technical_stage_service_items(service_id);
CREATE INDEX IF NOT EXISTS idx_tech_equipment_order ON technical_stage_equipment(order_index);
CREATE INDEX IF NOT EXISTS idx_tech_gallery_order ON technical_stage_gallery(order_index);
CREATE INDEX IF NOT EXISTS idx_tech_packages_order ON technical_stage_packages(order_index);

-- Updated_at triggers
CREATE OR REPLACE FUNCTION update_technical_stage_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER technical_stage_features_updated_at
  BEFORE UPDATE ON technical_stage_features
  FOR EACH ROW EXECUTE FUNCTION update_technical_stage_updated_at();

CREATE TRIGGER technical_stage_services_updated_at
  BEFORE UPDATE ON technical_stage_services
  FOR EACH ROW EXECUTE FUNCTION update_technical_stage_updated_at();

CREATE TRIGGER technical_stage_service_items_updated_at
  BEFORE UPDATE ON technical_stage_service_items
  FOR EACH ROW EXECUTE FUNCTION update_technical_stage_updated_at();

CREATE TRIGGER technical_stage_equipment_updated_at
  BEFORE UPDATE ON technical_stage_equipment
  FOR EACH ROW EXECUTE FUNCTION update_technical_stage_updated_at();

CREATE TRIGGER technical_stage_gallery_updated_at
  BEFORE UPDATE ON technical_stage_gallery
  FOR EACH ROW EXECUTE FUNCTION update_technical_stage_updated_at();

CREATE TRIGGER technical_stage_packages_updated_at
  BEFORE UPDATE ON technical_stage_packages
  FOR EACH ROW EXECUTE FUNCTION update_technical_stage_updated_at();

-- Sample data for Features
INSERT INTO technical_stage_features (title, description, order_index) VALUES
('Profesjonalne oświetlenie', 'Moving heads, LED PAR, efekty świetlne i systemy sterowania DMX', 1),
('Nagłośnienie premium', 'Line array, subwoofery, monitory sceniczne i mikrofony bezprzewodowe', 2),
('Sceny i konstrukcje', 'Sceny modułowe, podesty, dekoracje i konstrukcje stalowe', 3),
('Efekty specjalne', 'Wytwornice dymu, confetti, lasery i pirotechnika sceniczna', 4);

-- Sample data for Services
INSERT INTO technical_stage_services (title, description, order_index) VALUES
('Oświetlenie', 'Kompleksowe rozwiązania oświetleniowe dla każdego eventu', 1),
('Nagłośnienie', 'Profesjonalne systemy audio i realizacja dźwięku', 2),
('Sceny', 'Budowa scen, podestów i konstrukcji scenicznych', 3);

-- Sample data for Gallery
INSERT INTO technical_stage_gallery (image_url, title, order_index) VALUES
('https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&w=800&q=80', 'Oświetlenie koncertu', 1),
('https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?auto=format&fit=crop&w=800&q=80', 'Scena premium', 2),
('https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?auto=format&fit=crop&w=800&q=80', 'System nagłośnienia', 3);

-- Sample data for Packages
INSERT INTO technical_stage_packages (title, description, order_index) VALUES
('Pakiet Basic', 'Podstawowe oświetlenie i nagłośnienie dla małych eventów', 1),
('Pakiet Premium', 'Pełna obsługa techniczna z efektami specjalnymi', 2),
('Pakiet Exclusive', 'Top sprzęt i realizacja na najwyższym poziomie', 3);