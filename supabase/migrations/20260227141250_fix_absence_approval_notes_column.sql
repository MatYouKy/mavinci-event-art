/*
  # Fix Absence Approval - Use notes Column

  1. Changes
    - Use notes instead of approval_notes
    - Add approved_at timestamp
*/

-- Funkcja do zatwierdzania nieobecności (poprawiona notes)
CREATE OR REPLACE FUNCTION approve_absence(
  p_absence_id uuid,
  p_approver_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  v_result json;
  v_employee_id uuid;
  v_employee_name text;
  v_absence_type_pl text;
  v_start_date timestamptz;
  v_end_date timestamptz;
  v_approver_name text;
  v_notification_id uuid;
BEGIN
  -- Sprawdź czy użytkownik ma uprawnienia
  IF NOT EXISTS (
    SELECT 1 FROM employees 
    WHERE id = p_approver_id 
    AND ('employees_manage' = ANY(permissions) OR 'admin' = ANY(permissions))
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Brak uprawnień do zatwierdzania nieobecności'
    );
  END IF;
  
  -- Aktualizuj nieobecność
  UPDATE employee_absences
  SET 
    status = 'approved',
    approved_by = p_approver_id,
    approved_at = NOW(),
    notes = COALESCE(p_notes, notes),
    updated_at = NOW()
  WHERE id = p_absence_id
  RETURNING employee_id, absence_type, start_date, end_date
  INTO v_employee_id, v_absence_type_pl, v_start_date, v_end_date;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Nieobecność nie została znaleziona'
    );
  END IF;
  
  -- Pobierz dane pracownika
  SELECT (name || ' ' || surname) INTO v_employee_name
  FROM employees WHERE id = v_employee_id;
  
  -- Pobierz dane zatwierdzającego
  SELECT (name || ' ' || surname) INTO v_approver_name
  FROM employees WHERE id = p_approver_id;
  
  -- Przetłumacz typ
  v_absence_type_pl := CASE v_absence_type_pl::text
    WHEN 'vacation' THEN 'urlop wypoczynkowy'
    WHEN 'sick_leave' THEN 'zwolnienie lekarskie'
    WHEN 'unpaid_leave' THEN 'urlop bezpłatny'
    WHEN 'training' THEN 'szkolenie'
    WHEN 'remote_work' THEN 'praca zdalna'
    ELSE 'nieobecność'
  END;
  
  -- Wyślij notyfikację do pracownika o zatwierdzeniu
  INSERT INTO notifications (
    category,
    title,
    message,
    related_entity_type,
    related_entity_id,
    action_url,
    created_at
  )
  VALUES (
    'absence_approved',
    'Zatwierdzono ' || v_absence_type_pl,
    v_approver_name || ' zatwierdził Twoją prośbę o ' || v_absence_type_pl || 
      ' w terminie ' || TO_CHAR(v_start_date, 'DD.MM.YYYY') || ' - ' || 
      TO_CHAR(v_end_date, 'DD.MM.YYYY') || '.' ||
      CASE WHEN p_notes IS NOT NULL THEN ' Notatka: ' || p_notes ELSE '' END,
    'absence',
    p_absence_id::text,
    '/crm/employees/' || v_employee_id::text || '?tab=timeline',
    NOW()
  )
  RETURNING id INTO v_notification_id;
  
  -- Dodaj odbiorcę - pracownika
  INSERT INTO notification_recipients (
    notification_id,
    user_id,
    is_read,
    created_at
  )
  VALUES (
    v_notification_id,
    v_employee_id,
    false,
    NOW()
  );
  
  RETURN json_build_object(
    'success', true,
    'message', 'Nieobecność została zatwierdzona'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funkcja do odrzucania nieobecności (poprawiona notes)
CREATE OR REPLACE FUNCTION reject_absence(
  p_absence_id uuid,
  p_rejector_id uuid,
  p_reason text
)
RETURNS json AS $$
DECLARE
  v_result json;
  v_employee_id uuid;
  v_employee_name text;
  v_absence_type_pl text;
  v_start_date timestamptz;
  v_end_date timestamptz;
  v_rejector_name text;
  v_notification_id uuid;
BEGIN
  -- Sprawdź czy użytkownik ma uprawnienia
  IF NOT EXISTS (
    SELECT 1 FROM employees 
    WHERE id = p_rejector_id 
    AND ('employees_manage' = ANY(permissions) OR 'admin' = ANY(permissions))
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Brak uprawnień do odrzucania nieobecności'
    );
  END IF;
  
  -- Aktualizuj nieobecność
  UPDATE employee_absences
  SET 
    status = 'rejected',
    approved_by = p_rejector_id,
    notes = COALESCE(p_reason, notes),
    updated_at = NOW()
  WHERE id = p_absence_id
  RETURNING employee_id, absence_type, start_date, end_date
  INTO v_employee_id, v_absence_type_pl, v_start_date, v_end_date;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Nieobecność nie została znaleziona'
    );
  END IF;
  
  -- Pobierz dane pracownika
  SELECT (name || ' ' || surname) INTO v_employee_name
  FROM employees WHERE id = v_employee_id;
  
  -- Pobierz dane odrzucającego
  SELECT (name || ' ' || surname) INTO v_rejector_name
  FROM employees WHERE id = p_rejector_id;
  
  -- Przetłumacz typ
  v_absence_type_pl := CASE v_absence_type_pl::text
    WHEN 'vacation' THEN 'urlop wypoczynkowy'
    WHEN 'sick_leave' THEN 'zwolnienie lekarskie'
    WHEN 'unpaid_leave' THEN 'urlop bezpłatny'
    WHEN 'training' THEN 'szkolenie'
    WHEN 'remote_work' THEN 'praca zdalna'
    ELSE 'nieobecność'
  END;
  
  -- Wyślij notyfikację do pracownika o odrzuceniu
  INSERT INTO notifications (
    category,
    title,
    message,
    related_entity_type,
    related_entity_id,
    action_url,
    created_at
  )
  VALUES (
    'absence_rejected',
    'Odrzucono ' || v_absence_type_pl,
    v_rejector_name || ' odrzucił Twoją prośbę o ' || v_absence_type_pl || 
      ' w terminie ' || TO_CHAR(v_start_date, 'DD.MM.YYYY') || ' - ' || 
      TO_CHAR(v_end_date, 'DD.MM.YYYY') || 
      CASE WHEN p_reason IS NOT NULL THEN '. Powód: ' || p_reason ELSE '.' END,
    'absence',
    p_absence_id::text,
    '/crm/employees/' || v_employee_id::text || '?tab=timeline',
    NOW()
  )
  RETURNING id INTO v_notification_id;
  
  -- Dodaj odbiorcę - pracownika
  INSERT INTO notification_recipients (
    notification_id,
    user_id,
    is_read,
    created_at
  )
  VALUES (
    v_notification_id,
    v_employee_id,
    false,
    NOW()
  );
  
  RETURN json_build_object(
    'success', true,
    'message', 'Nieobecność została odrzucona'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
