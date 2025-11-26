/*
  # Refactor Related Services to Use services_catalog

  1. Changes
    - Drop `dj_service_items` table (not needed, using services_catalog instead)
    - Recreate `dj_related_services` with foreign key to `services_catalog`
    - Recreate `technical_stage_related_services` with foreign key to `services_catalog`
    
  2. Structure
    - Both tables now reference `services_catalog(id)` instead of custom items
    - Maintains display_order and is_active fields
    
  3. Security
    - Enable RLS with same policies as before
*/

-- =====================================================
-- DROP OLD TABLES
-- =====================================================

DROP TABLE IF EXISTS dj_related_services CASCADE;
DROP TABLE IF EXISTS dj_service_items CASCADE;
DROP TABLE IF EXISTS technical_stage_related_services CASCADE;

DROP FUNCTION IF EXISTS sync_dj_service_name() CASCADE;
DROP FUNCTION IF EXISTS generate_dj_service_slug() CASCADE;
DROP FUNCTION IF EXISTS sync_technical_service_name() CASCADE;
DROP FUNCTION IF EXISTS generate_technical_service_slug() CASCADE;

-- =====================================================
-- DJ RELATED SERVICES (using services_catalog)
-- =====================================================

CREATE TABLE dj_related_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_catalog_id uuid REFERENCES services_catalog(id) ON DELETE CASCADE NOT NULL,
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE dj_related_services ENABLE ROW LEVEL SECURITY;

-- Policies
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
-- TECHNICAL STAGE RELATED SERVICES (using services_catalog)
-- =====================================================

CREATE TABLE technical_stage_related_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_catalog_id uuid REFERENCES services_catalog(id) ON DELETE CASCADE NOT NULL,
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE technical_stage_related_services ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Anyone can view active technical related services"
  ON technical_stage_related_services FOR SELECT
  USING (is_active = true);

CREATE POLICY "Anyone can insert technical related services"
  ON technical_stage_related_services FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update technical related services"
  ON technical_stage_related_services FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete technical related services"
  ON technical_stage_related_services FOR DELETE
  USING (true);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX idx_dj_related_services_catalog_id 
  ON dj_related_services(service_catalog_id);

CREATE INDEX idx_dj_related_services_display_order 
  ON dj_related_services(display_order);

CREATE INDEX idx_technical_stage_related_services_catalog_id 
  ON technical_stage_related_services(service_catalog_id);

CREATE INDEX idx_technical_stage_related_services_display_order 
  ON technical_stage_related_services(display_order);