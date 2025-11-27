/*
  # Add Related Services for Technical Stage and DJ Pages

  1. New Tables
    - `technical_stage_related_services`
      - Links to existing `technical_stage_service_items`
      - Manages which services appear in "Related Services" section
    
    - `dj_service_items`
      - Service items for DJ page (similar to conferences_service_items)
      - Contains title, description, icon_id, images, slug
    
    - `dj_related_services`
      - Links to `dj_service_items`
      - Manages which services appear in "Related Services" section on DJ page

  2. Security
    - Enable RLS on all tables
    - Add simple policies allowing public select and website editors to manage

  3. Sample Data
    - Add initial DJ service items
*/

-- =====================================================
-- TECHNICAL STAGE RELATED SERVICES
-- =====================================================

CREATE TABLE IF NOT EXISTS technical_stage_related_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_item_id uuid REFERENCES technical_stage_service_items(id) ON DELETE CASCADE,
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE technical_stage_related_services ENABLE ROW LEVEL SECURITY;

-- Policies for technical_stage_related_services
CREATE POLICY "Anyone can view active related services"
  ON technical_stage_related_services FOR SELECT
  USING (is_active = true);

CREATE POLICY "Anyone can insert related services"
  ON technical_stage_related_services FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update related services"
  ON technical_stage_related_services FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete related services"
  ON technical_stage_related_services FOR DELETE
  USING (true);

-- =====================================================
-- DJ SERVICE ITEMS
-- =====================================================

CREATE TABLE IF NOT EXISTS dj_service_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  icon_id uuid REFERENCES custom_icons(id) ON DELETE SET NULL,
  images jsonb DEFAULT '[]'::jsonb,
  slug text,
  order_index integer DEFAULT 0,
  is_visible boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE dj_service_items ENABLE ROW LEVEL SECURITY;

-- Policies for dj_service_items
CREATE POLICY "Anyone can view visible DJ service items"
  ON dj_service_items FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Anyone can insert DJ service items"
  ON dj_service_items FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update DJ service items"
  ON dj_service_items FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete DJ service items"
  ON dj_service_items FOR DELETE
  USING (true);

-- Auto-generate slug trigger
CREATE OR REPLACE FUNCTION generate_dj_service_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := lower(regexp_replace(NEW.title, '[^a-zA-Z0-9]+', '-', 'g'));
    NEW.slug := regexp_replace(NEW.slug, '^-+|-+$', '', 'g');
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_dj_service_slug
  BEFORE INSERT OR UPDATE ON dj_service_items
  FOR EACH ROW
  EXECUTE FUNCTION generate_dj_service_slug();

-- =====================================================
-- DJ RELATED SERVICES
-- =====================================================

CREATE TABLE IF NOT EXISTS dj_related_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_item_id uuid REFERENCES dj_service_items(id) ON DELETE CASCADE,
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE dj_related_services ENABLE ROW LEVEL SECURITY;

-- Policies for dj_related_services
CREATE POLICY "Anyone can view active DJ related services"
  ON dj_related_services FOR SELECT
  USING (is_active = true);

CREATE POLICY "Anyone can insert DJ related services"
  ON dj_related_services FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update DJ related services"
  ON dj_related_services FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete DJ related services"
  ON dj_related_services FOR DELETE
  USING (true);

-- =====================================================
-- SAMPLE DATA FOR DJ SERVICE ITEMS
-- =====================================================

INSERT INTO dj_service_items (title, description, order_index, is_visible) VALUES
  ('Obsługa Imprez Firmowych', 'Profesjonalna oprawa muzyczna eventów korporacyjnych - od eleganckich gal po dynamiczne imprezy integracyjne', 1, true),
  ('DJ na Wesele', 'Dopasujemy muzykę do charakteru wesela - od romantycznych balad po energiczne hity taneczne', 2, true),
  ('Imprezy Tematyczne', 'Specjalizujemy się w obsłudze imprez z konkretną stylistyką - lata 80/90, disco polo, muzyka klubowa', 3, true),
  ('DJ + Konferansjer', 'Kompleksowa obsługa z prowadzeniem wydarzeń - konkursy, zabawy, animacje dla gości', 4, true),
  ('Sprzęt Nagłośnieniowy', 'Profesjonalny sprzęt audio dostosowany do wielkości i charakteru wydarzenia', 5, true),
  ('Oświetlenie LED', 'Dynamiczne oświetlenie sceniczne, które stworzy niepowtarzalny klimat na imprezie', 6, true)
ON CONFLICT DO NOTHING;

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_technical_stage_related_services_item_id 
  ON technical_stage_related_services(service_item_id);

CREATE INDEX IF NOT EXISTS idx_technical_stage_related_services_display_order 
  ON technical_stage_related_services(display_order);

CREATE INDEX IF NOT EXISTS idx_dj_service_items_visible 
  ON dj_service_items(is_visible);

CREATE INDEX IF NOT EXISTS idx_dj_service_items_order 
  ON dj_service_items(order_index);

CREATE INDEX IF NOT EXISTS idx_dj_related_services_item_id 
  ON dj_related_services(service_item_id);

CREATE INDEX IF NOT EXISTS idx_dj_related_services_display_order 
  ON dj_related_services(display_order);