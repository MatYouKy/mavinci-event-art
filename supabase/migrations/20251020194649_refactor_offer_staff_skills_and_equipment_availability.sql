/*
  # Refaktoryzacja umiejętności pracowników w ofertach + dostępność sprzętu

  1. Nowa tabela `offer_product_staff_skills`
    - Relacja many-to-many między offer_product_staff a skills
    - Zamienia tekstową tablicę na relację do tabeli skills
    - Dodaje wymagany poziom zaawansowania
    
  2. Funkcja sprawdzania dostępności sprzętu
    - Liczy dostępne jednostki (status = 'available')
    - Zwraca maksymalną ilość do przypisania
    
  3. Bezpieczeństwo
    - RLS dla nowej tabeli
    - Funkcja dostępna dla authenticated users
*/

-- Tabela relacji między wymaganiami kadrowymi oferty a umiejętnościami
CREATE TABLE IF NOT EXISTS offer_product_staff_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_requirement_id uuid NOT NULL REFERENCES offer_product_staff(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  minimum_proficiency text CHECK (minimum_proficiency IN ('basic', 'intermediate', 'advanced', 'expert')) DEFAULT 'basic',
  is_required boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(staff_requirement_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_offer_product_staff_skills_staff ON offer_product_staff_skills(staff_requirement_id);
CREATE INDEX IF NOT EXISTS idx_offer_product_staff_skills_skill ON offer_product_staff_skills(skill_id);

ALTER TABLE offer_product_staff_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view offer staff skills"
  ON offer_product_staff_skills FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage offer staff skills"
  ON offer_product_staff_skills FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Funkcja do sprawdzania dostępności sprzętu (pomijając jednostki w naprawie/uszkodzone)
CREATE OR REPLACE FUNCTION get_available_equipment_quantity(p_equipment_id uuid)
RETURNS integer AS $$
DECLARE
  v_available_count integer;
BEGIN
  SELECT COUNT(*)
  INTO v_available_count
  FROM equipment_units
  WHERE equipment_id = p_equipment_id
  AND status = 'available';
  
  RETURN COALESCE(v_available_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funkcja do sprawdzania dostępności z datami (dla przyszłych rezerwacji)
CREATE OR REPLACE FUNCTION get_available_equipment_quantity_for_dates(
  p_equipment_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS integer AS $$
DECLARE
  v_total_units integer;
  v_reserved_units integer;
  v_available_count integer;
BEGIN
  -- Policz wszystkie dostępne jednostki (nie uszkodzone, nie w serwisie)
  SELECT COUNT(*)
  INTO v_total_units
  FROM equipment_units
  WHERE equipment_id = p_equipment_id
  AND status IN ('available', 'in_use', 'reserved');
  
  -- Policz ile jest zarezerwowanych w tym okresie
  SELECT COUNT(DISTINCT eu.id)
  INTO v_reserved_units
  FROM equipment_units eu
  JOIN event_equipment ee ON ee.equipment_item_id = eu.equipment_id
  JOIN events e ON e.id = ee.event_id
  WHERE eu.equipment_id = p_equipment_id
  AND eu.status IN ('reserved', 'in_use')
  AND (
    (e.event_date_start <= p_end_date AND e.event_date_end >= p_start_date)
  );
  
  v_available_count := v_total_units - COALESCE(v_reserved_units, 0);
  
  RETURN GREATEST(v_available_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funkcja do znalezienia pracowników spełniających wymagania umiejętności
CREATE OR REPLACE FUNCTION find_employees_with_skills(
  p_staff_requirement_id uuid
)
RETURNS TABLE (
  employee_id uuid,
  employee_name text,
  matched_skills jsonb,
  all_requirements_met boolean
) AS $$
BEGIN
  RETURN QUERY
  WITH required AS (
    SELECT 
      s.id as skill_id,
      s.name as skill_name,
      opss.minimum_proficiency,
      opss.is_required
    FROM offer_product_staff_skills opss
    JOIN skills s ON opss.skill_id = s.id
    WHERE opss.staff_requirement_id = p_staff_requirement_id
  ),
  employee_matches AS (
    SELECT 
      e.id as emp_id,
      e.name || ' ' || e.surname as emp_name,
      jsonb_agg(
        jsonb_build_object(
          'skill_name', r.skill_name,
          'required_level', r.minimum_proficiency,
          'employee_level', es.proficiency_level,
          'meets_requirement', CASE
            WHEN r.minimum_proficiency = 'basic' THEN es.proficiency_level IN ('basic', 'intermediate', 'advanced', 'expert')
            WHEN r.minimum_proficiency = 'intermediate' THEN es.proficiency_level IN ('intermediate', 'advanced', 'expert')
            WHEN r.minimum_proficiency = 'advanced' THEN es.proficiency_level IN ('advanced', 'expert')
            WHEN r.minimum_proficiency = 'expert' THEN es.proficiency_level = 'expert'
            ELSE false
          END
        )
      ) as skills_match,
      COUNT(*) FILTER (WHERE r.is_required) as total_required,
      COUNT(*) FILTER (
        WHERE r.is_required AND
        CASE
          WHEN r.minimum_proficiency = 'basic' THEN es.proficiency_level IN ('basic', 'intermediate', 'advanced', 'expert')
          WHEN r.minimum_proficiency = 'intermediate' THEN es.proficiency_level IN ('intermediate', 'advanced', 'expert')
          WHEN r.minimum_proficiency = 'advanced' THEN es.proficiency_level IN ('advanced', 'expert')
          WHEN r.minimum_proficiency = 'expert' THEN es.proficiency_level = 'expert'
          ELSE false
        END
      ) as met_required
    FROM employees e
    JOIN employee_skills es ON es.employee_id = e.id
    JOIN required r ON r.skill_id = es.skill_id
    WHERE e.is_active = true
    GROUP BY e.id, emp_name
  )
  SELECT 
    em.emp_id,
    em.emp_name,
    em.skills_match,
    em.met_required >= em.total_required as all_met
  FROM employee_matches em
  ORDER BY all_met DESC, met_required DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE offer_product_staff_skills IS 'Wymagane umiejętności dla ról pracowniczych w produktach ofertowych';
COMMENT ON FUNCTION get_available_equipment_quantity IS 'Zwraca liczbę dostępnych jednostek sprzętu (status=available)';
COMMENT ON FUNCTION get_available_equipment_quantity_for_dates IS 'Zwraca liczbę dostępnych jednostek w określonym przedziale czasowym';
COMMENT ON FUNCTION find_employees_with_skills IS 'Znajduje pracowników spełniających wymagania umiejętności dla danej roli';
