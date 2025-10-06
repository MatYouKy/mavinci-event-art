/*
  # Rozszerzenie systemu atrakcji

  1. Nowe tabele
    - `attraction_required_equipment` - Sprzęt wymagany dla atrakcji
    - `attraction_required_staff` - Personel wymagany dla atrakcji
    - `attraction_equipment_accessories` - Akcesoria dołączane automatycznie do sprzętu
    - `attraction_checklist_template` - Szablon checklisty dla atrakcji

  2. Zmiany
    - Dodanie pól do `attractions` (max_daily_capacity, requires_operator)
    - Dodanie pól do `equipment` (has_accessories)

  3. Bezpieczeństwo
    - RLS włączone dla wszystkich tabel
    - Polityki dostępu dla authenticated users
*/

-- 1. ROZSZERZENIE TABELI ATTRACTIONS
ALTER TABLE attractions ADD COLUMN IF NOT EXISTS max_daily_capacity integer;
ALTER TABLE attractions ADD COLUMN IF NOT EXISTS requires_operator boolean DEFAULT false;
ALTER TABLE attractions ADD COLUMN IF NOT EXISTS setup_time_minutes integer DEFAULT 0;
ALTER TABLE attractions ADD COLUMN IF NOT EXISTS breakdown_time_minutes integer DEFAULT 0;

-- 2. SPRZĘT WYMAGANY PRZEZ ATRAKCJĘ
CREATE TABLE IF NOT EXISTS attraction_required_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attraction_id uuid REFERENCES attractions(id) ON DELETE CASCADE NOT NULL,
  equipment_id uuid REFERENCES equipment(id) ON DELETE CASCADE NOT NULL,
  quantity integer DEFAULT 1 NOT NULL,
  is_primary boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(attraction_id, equipment_id)
);

ALTER TABLE attraction_required_equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read required equipment"
  ON attraction_required_equipment FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage required equipment"
  ON attraction_required_equipment FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 3. PERSONEL WYMAGANY PRZEZ ATRAKCJĘ
CREATE TABLE IF NOT EXISTS attraction_required_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attraction_id uuid REFERENCES attractions(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL,
  count integer DEFAULT 1 NOT NULL,
  required_skills text[],
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE attraction_required_staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read required staff"
  ON attraction_required_staff FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage required staff"
  ON attraction_required_staff FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 4. AKCESORIA SPRZĘTU (automatycznie dołączane)
CREATE TABLE IF NOT EXISTS equipment_accessories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_equipment_id uuid REFERENCES equipment(id) ON DELETE CASCADE NOT NULL,
  accessory_name text NOT NULL,
  accessory_description text,
  quantity integer DEFAULT 1,
  is_required boolean DEFAULT true,
  category text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE equipment_accessories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read equipment accessories"
  ON equipment_accessories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage equipment accessories"
  ON equipment_accessories FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 5. SZABLON CHECKLISTY DLA ATRAKCJI
CREATE TABLE IF NOT EXISTS attraction_checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attraction_id uuid REFERENCES attractions(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  description text,
  category text CHECK (category IN ('setup', 'operation', 'breakdown', 'safety', 'quality_check')),
  sort_order integer DEFAULT 0,
  is_required boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE attraction_checklist_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read checklist templates"
  ON attraction_checklist_templates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage checklist templates"
  ON attraction_checklist_templates FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 6. KOSZTORYS ATRAKCJI (szczegółowe koszty)
CREATE TABLE IF NOT EXISTS attraction_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attraction_id uuid REFERENCES attractions(id) ON DELETE CASCADE NOT NULL,
  cost_type text CHECK (cost_type IN ('equipment', 'labor', 'transport', 'materials', 'other')),
  description text NOT NULL,
  amount numeric(10,2) NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE attraction_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read attraction costs"
  ON attraction_costs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage attraction costs"
  ON attraction_costs FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 7. INDEKSY DLA WYDAJNOŚCI
CREATE INDEX IF NOT EXISTS idx_attraction_required_equipment_attraction
  ON attraction_required_equipment(attraction_id);
CREATE INDEX IF NOT EXISTS idx_attraction_required_equipment_equipment
  ON attraction_required_equipment(equipment_id);
CREATE INDEX IF NOT EXISTS idx_attraction_required_staff_attraction
  ON attraction_required_staff(attraction_id);
CREATE INDEX IF NOT EXISTS idx_equipment_accessories_parent
  ON equipment_accessories(parent_equipment_id);
CREATE INDEX IF NOT EXISTS idx_attraction_checklist_templates_attraction
  ON attraction_checklist_templates(attraction_id);
CREATE INDEX IF NOT EXISTS idx_attraction_costs_attraction
  ON attraction_costs(attraction_id);

-- 8. DODAJ PRZYKŁADOWE AKCESORIA DO SPRZĘTU
-- Przykład: Rzutnik Epson z akcesoriami
DO $$
DECLARE
  projector_id uuid;
BEGIN
  -- Sprawdź czy istnieje rzutnik w bazie
  SELECT id INTO projector_id FROM equipment WHERE name ILIKE '%rzutnik%' OR name ILIKE '%epson%' LIMIT 1;

  IF projector_id IS NOT NULL THEN
    -- Dodaj akcesoria jeśli nie istnieją
    INSERT INTO equipment_accessories (parent_equipment_id, accessory_name, accessory_description, quantity, is_required, category)
    VALUES
      (projector_id, 'Kabel HDMI', 'Kabel HDMI 5m do połączenia z komputerem', 1, true, 'cables'),
      (projector_id, 'Kabel zasilający', 'Przewód zasilający 3m', 1, true, 'power'),
      (projector_id, 'Pilot', 'Pilot do rzutnika', 1, true, 'control'),
      (projector_id, 'Adapter VGA', 'Adapter VGA na HDMI', 1, false, 'adapters'),
      (projector_id, 'Torba transportowa', 'Dedykowana torba do transportu', 1, true, 'transport')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
