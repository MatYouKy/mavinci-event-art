/*
  # System wymaganych umiejętności dla produktów ofertowych

  1. Funkcje RPC
    - `get_product_required_skills` - pobiera wymagane umiejętności ze sprzętu przypisanego do produktu
    - `suggest_employees_for_event` - sugeruje pracowników na podstawie wymagań sprzętu w evencie

  2. Cel
    - Automatyczne wykrywanie wymaganych umiejętności ze sprzętu
    - Sugerowanie odpowiednich pracowników do assignmentu
*/

-- Funkcja pobierająca wymagane umiejętności dla produktu na podstawie przypisanego sprzętu
CREATE OR REPLACE FUNCTION get_product_required_skills(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Pobierz wszystkie wymagane umiejętności ze sprzętu przypisanego do produktu
  WITH product_equipment AS (
    SELECT DISTINCT equipment_item_id
    FROM offer_product_equipment
    WHERE product_id = p_product_id
      AND equipment_item_id IS NOT NULL
  ),
  required_skills AS (
    SELECT DISTINCT
      s.id as skill_id,
      s.name as skill_name,
      s.description as skill_description,
      sc.name as category_name,
      sc.color as category_color,
      esr.minimum_proficiency,
      esr.is_required,
      ei.name as equipment_name,
      COUNT(*) OVER (PARTITION BY s.id) as equipment_count
    FROM product_equipment pe
    JOIN equipment_skill_requirements esr ON pe.equipment_item_id = esr.equipment_item_id
    JOIN skills s ON esr.skill_id = s.id
    LEFT JOIN skill_categories sc ON s.category_id = sc.id
    LEFT JOIN equipment_items ei ON pe.equipment_item_id = ei.id
    WHERE esr.is_required = true
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'skill_id', skill_id,
      'skill_name', skill_name,
      'skill_description', skill_description,
      'category_name', category_name,
      'category_color', category_color,
      'minimum_proficiency', minimum_proficiency,
      'equipment_count', equipment_count,
      'equipment_names', (
        SELECT jsonb_agg(DISTINCT ei2.name)
        FROM product_equipment pe2
        JOIN equipment_skill_requirements esr2 ON pe2.equipment_item_id = esr2.equipment_item_id
        JOIN equipment_items ei2 ON pe2.equipment_item_id = ei2.id
        WHERE esr2.skill_id = rs.skill_id
          AND pe2.equipment_item_id IN (SELECT equipment_item_id FROM product_equipment)
      )
    )
    ORDER BY equipment_count DESC, skill_name
  ) INTO v_result
  FROM required_skills rs;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- Funkcja sugerująca pracowników dla eventu na podstawie wymaganych umiejętności sprzętu
CREATE OR REPLACE FUNCTION suggest_employees_for_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Pobierz wymagane umiejętności z eventu i zasugeruj pracowników
  WITH event_equipment AS (
    SELECT DISTINCT equipment_id
    FROM event_equipment
    WHERE event_id = p_event_id
      AND equipment_id IS NOT NULL
  ),
  required_skills AS (
    SELECT DISTINCT
      s.id as skill_id,
      s.name as skill_name,
      esr.minimum_proficiency
    FROM event_equipment ee
    JOIN equipment_skill_requirements esr ON ee.equipment_id = esr.equipment_item_id
    JOIN skills s ON esr.skill_id = s.id
    WHERE esr.is_required = true
  ),
  suggested_employees AS (
    SELECT DISTINCT
      e.id as employee_id,
      e.name || ' ' || e.surname as employee_name,
      e.email,
      e.avatar_url,
      jsonb_agg(DISTINCT jsonb_build_object(
        'skill_name', rs.skill_name,
        'proficiency', es.proficiency_level,
        'years_experience', es.years_of_experience,
        'required_proficiency', rs.minimum_proficiency,
        'meets_requirement', CASE
          WHEN rs.minimum_proficiency = 'basic' THEN es.proficiency_level IN ('basic', 'intermediate', 'advanced', 'expert')
          WHEN rs.minimum_proficiency = 'intermediate' THEN es.proficiency_level IN ('intermediate', 'advanced', 'expert')
          WHEN rs.minimum_proficiency = 'advanced' THEN es.proficiency_level IN ('advanced', 'expert')
          WHEN rs.minimum_proficiency = 'expert' THEN es.proficiency_level = 'expert'
          ELSE false
        END
      )) as skills,
      COUNT(DISTINCT rs.skill_id) as matching_skills_count,
      (SELECT COUNT(DISTINCT skill_id) FROM required_skills) as total_required_skills
    FROM required_skills rs
    JOIN employee_skills es ON rs.skill_id = es.skill_id
    JOIN employees e ON es.employee_id = e.id
    WHERE e.is_active = true
      AND CASE
        WHEN rs.minimum_proficiency = 'basic' THEN es.proficiency_level IN ('basic', 'intermediate', 'advanced', 'expert')
        WHEN rs.minimum_proficiency = 'intermediate' THEN es.proficiency_level IN ('intermediate', 'advanced', 'expert')
        WHEN rs.minimum_proficiency = 'advanced' THEN es.proficiency_level IN ('advanced', 'expert')
        WHEN rs.minimum_proficiency = 'expert' THEN es.proficiency_level = 'expert'
        ELSE true
      END
    GROUP BY e.id, e.name, e.surname, e.email, e.avatar_url
  )
  SELECT jsonb_build_object(
    'required_skills', (
      SELECT jsonb_agg(jsonb_build_object(
        'skill_id', skill_id,
        'skill_name', skill_name,
        'minimum_proficiency', minimum_proficiency
      ))
      FROM required_skills
    ),
    'suggested_employees', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'employee_id', employee_id,
          'employee_name', employee_name,
          'email', email,
          'avatar_url', avatar_url,
          'skills', skills,
          'matching_skills_count', matching_skills_count,
          'total_required_skills', total_required_skills,
          'match_percentage', ROUND((matching_skills_count::numeric / NULLIF(total_required_skills, 0)) * 100, 0)
        )
        ORDER BY matching_skills_count DESC, employee_name
      )
      FROM suggested_employees
    )
  ) INTO v_result;

  RETURN COALESCE(v_result, jsonb_build_object('required_skills', '[]'::jsonb, 'suggested_employees', '[]'::jsonb));
END;
$$;

COMMENT ON FUNCTION get_product_required_skills(uuid) IS
'Pobiera wymagane umiejętności ze sprzętu przypisanego do produktu ofertowego';

COMMENT ON FUNCTION suggest_employees_for_event(uuid) IS
'Sugeruje pracowników dla eventu na podstawie wymaganych umiejętności sprzętu';
