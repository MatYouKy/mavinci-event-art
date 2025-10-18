/*
  # System umiejętności pracowników i wymagań sprzętu

  1. Nowe tabele
    - `skill_categories` - kategorie umiejętności (audio, video, lighting, software)
    - `skills` - konkretne umiejętności (MagicQ, Resolume, itp.)
    - `employee_skills` - umiejętności przypisane do pracowników
    - `equipment_skill_requirements` - wymagane umiejętności dla sprzętu
    
  2. Zabezpieczenia
    - RLS dla wszystkich tabel
*/

-- Kategorie umiejętności
CREATE TABLE IF NOT EXISTS skill_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  icon text,
  color text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE skill_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view skill categories"
  ON skill_categories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage skill categories"
  ON skill_categories FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Konkretne umiejętności
CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  category_id uuid REFERENCES skill_categories(id) ON DELETE SET NULL,
  icon text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view skills"
  ON skills FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage skills"
  ON skills FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Umiejętności pracowników z poziomem zaawansowania
CREATE TABLE IF NOT EXISTS employee_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  proficiency_level text CHECK (proficiency_level IN ('basic', 'intermediate', 'advanced', 'expert')),
  years_of_experience numeric(4,1),
  notes text,
  verified_by uuid REFERENCES employees(id),
  verified_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, skill_id)
);

ALTER TABLE employee_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view employee skills"
  ON employee_skills FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage employee skills"
  ON employee_skills FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Wymagane umiejętności dla sprzętu
CREATE TABLE IF NOT EXISTS equipment_skill_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_item_id uuid NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  minimum_proficiency text CHECK (minimum_proficiency IN ('basic', 'intermediate', 'advanced', 'expert')),
  is_required boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(equipment_item_id, skill_id)
);

ALTER TABLE equipment_skill_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view equipment skill requirements"
  ON equipment_skill_requirements FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage equipment skill requirements"
  ON equipment_skill_requirements FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_employee_skills_employee ON employee_skills(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_skills_skill ON employee_skills(skill_id);
CREATE INDEX IF NOT EXISTS idx_equipment_skill_requirements_equipment ON equipment_skill_requirements(equipment_item_id);
CREATE INDEX IF NOT EXISTS idx_equipment_skill_requirements_skill ON equipment_skill_requirements(skill_id);
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category_id);

-- Funkcja sprawdzająca dostępność pracowników z wymaganymi umiejętnościami dla wydarzenia
CREATE OR REPLACE FUNCTION check_event_skill_requirements(p_event_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
  v_missing_skills jsonb;
  v_available_employees jsonb;
BEGIN
  -- Znajdź wymagane umiejętności dla sprzętu w wydarzeniu
  WITH required_skills AS (
    SELECT DISTINCT
      s.id as skill_id,
      s.name as skill_name,
      esr.minimum_proficiency,
      ei.name as equipment_name
    FROM event_equipment ee
    JOIN equipment_items ei ON ee.equipment_item_id = ei.id
    JOIN equipment_skill_requirements esr ON ei.id = esr.equipment_item_id
    JOIN skills s ON esr.skill_id = s.id
    WHERE ee.event_id = p_event_id
    AND esr.is_required = true
  ),
  assigned_employees AS (
    SELECT DISTINCT employee_id
    FROM employee_assignments
    WHERE event_id = p_event_id
  ),
  covered_skills AS (
    SELECT DISTINCT rs.skill_id
    FROM required_skills rs
    JOIN employee_skills es ON rs.skill_id = es.skill_id
    JOIN assigned_employees ae ON es.employee_id = ae.employee_id
    WHERE 
      CASE 
        WHEN rs.minimum_proficiency = 'basic' THEN es.proficiency_level IN ('basic', 'intermediate', 'advanced', 'expert')
        WHEN rs.minimum_proficiency = 'intermediate' THEN es.proficiency_level IN ('intermediate', 'advanced', 'expert')
        WHEN rs.minimum_proficiency = 'advanced' THEN es.proficiency_level IN ('advanced', 'expert')
        WHEN rs.minimum_proficiency = 'expert' THEN es.proficiency_level = 'expert'
        ELSE true
      END
  )
  SELECT jsonb_agg(jsonb_build_object(
    'skill_name', rs.skill_name,
    'minimum_proficiency', rs.minimum_proficiency,
    'equipment_name', rs.equipment_name,
    'available_employees', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id,
        'name', e.name || ' ' || e.surname,
        'proficiency', es.proficiency_level,
        'years_experience', es.years_of_experience
      ))
      FROM employee_skills es
      JOIN employees e ON es.employee_id = e.id
      WHERE es.skill_id = rs.skill_id
      AND e.is_active = true
      AND CASE 
        WHEN rs.minimum_proficiency = 'basic' THEN es.proficiency_level IN ('basic', 'intermediate', 'advanced', 'expert')
        WHEN rs.minimum_proficiency = 'intermediate' THEN es.proficiency_level IN ('intermediate', 'advanced', 'expert')
        WHEN rs.minimum_proficiency = 'advanced' THEN es.proficiency_level IN ('advanced', 'expert')
        WHEN rs.minimum_proficiency = 'expert' THEN es.proficiency_level = 'expert'
        ELSE true
      END
    )
  ))
  INTO v_missing_skills
  FROM required_skills rs
  WHERE rs.skill_id NOT IN (SELECT skill_id FROM covered_skills);

  v_result := jsonb_build_object(
    'missing_skills', COALESCE(v_missing_skills, '[]'::jsonb),
    'has_all_required_skills', (v_missing_skills IS NULL)
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Wstaw przykładowe kategorie umiejętności
INSERT INTO skill_categories (name, description, icon, color) VALUES
  ('Oświetlenie', 'Umiejętności związane z oświetleniem scenicznym', 'Lightbulb', '#FFD700'),
  ('Dźwięk', 'Umiejętności z zakresu nagłośnienia i akustyki', 'Volume2', '#4169E1'),
  ('Wideo', 'Umiejętności z zakresu video i projekcji', 'Video', '#DC143C'),
  ('Oprogramowanie', 'Znajomość specjalistycznego oprogramowania', 'Monitor', '#32CD32'),
  ('Scenotechnika', 'Budowa i montaż konstrukcji scenicznych', 'Wrench', '#FF8C00'),
  ('Efekty specjalne', 'Obsługa efektów pirotechnicznych i innych', 'Sparkles', '#9370DB')
ON CONFLICT (name) DO NOTHING;

-- Wstaw przykładowe umiejętności
INSERT INTO skills (name, description, category_id) VALUES
  ('MagicQ (ChamSys)', 'Obsługa konsolet oświetleniowych ChamSys', (SELECT id FROM skill_categories WHERE name = 'Oświetlenie')),
  ('GrandMA2/MA3', 'Obsługa konsolet GrandMA', (SELECT id FROM skill_categories WHERE name = 'Oświetlenie')),
  ('Resolume', 'Obsługa oprogramowania do video mappingu', (SELECT id FROM skill_categories WHERE name = 'Wideo')),
  ('Obsługa mikserów cyfrowych', 'Yamaha, Behringer, Allen & Heath', (SELECT id FROM skill_categories WHERE name = 'Dźwięk')),
  ('Dante', 'Konfiguracja sieci audio Dante', (SELECT id FROM skill_categories WHERE name = 'Dźwięk')),
  ('Projekcja multimedialna', 'Konfiguracja i kalibracja projektorów', (SELECT id FROM skill_categories WHERE name = 'Wideo')),
  ('Montaż konstrukcji aluminiowych', 'Budowa konstrukcji scenicznych', (SELECT id FROM skill_categories WHERE name = 'Scenotechnika')),
  ('QLab', 'Obsługa oprogramowania QLab', (SELECT id FROM skill_categories WHERE name = 'Oprogramowanie')),
  ('Obsługa wytrząsarek CO2', 'Efekty specjalne CO2', (SELECT id FROM skill_categories WHERE name = 'Efekty specjalne')),
  ('Arkaos', 'Obsługa oprogramowania Arkaos do video', (SELECT id FROM skill_categories WHERE name = 'Wideo')),
  ('Konfiguracja DMX/ArtNet', 'Sieci kontroli oświetlenia', (SELECT id FROM skill_categories WHERE name = 'Oświetlenie')),
  ('Mixing audio na żywo', 'Realizacja dźwięku na żywo', (SELECT id FROM skill_categories WHERE name = 'Dźwięk'))
ON CONFLICT (name) DO NOTHING;

-- Triggery updated_at
CREATE TRIGGER update_skill_categories_updated_at BEFORE UPDATE ON skill_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_skills_updated_at BEFORE UPDATE ON skills
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employee_skills_updated_at BEFORE UPDATE ON employee_skills
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_equipment_skill_requirements_updated_at BEFORE UPDATE ON equipment_skill_requirements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
