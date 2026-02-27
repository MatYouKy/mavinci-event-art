/*
  # System Notyfikacji dla Nieobecności Pracowników

  1. Nowe Funkcje
    - notify_absence_request - wysyła notyfikację do adminów o nowej nieobecności
    - approve_absence - zatwierdza nieobecność
    - reject_absence - odrzuca nieobecność
  
  2. Triggery
    - Automatyczna notyfikacja przy dodaniu nieobecności ze statusem 'pending'
    - Aktualizacja powiadomień przy zmianie statusu
  
  3. Security
    - Admini mogą zatwierdzać/odrzucać nieobecności
    - Pracownicy mogą dodawać swoje nieobecności
*/

-- Funkcja wysyłająca notyfikację o nowej nieobecności
CREATE OR REPLACE FUNCTION notify_absence_request()
RETURNS TRIGGER AS $$
DECLARE
  v_employee_name text;
  v_absence_type_pl text;
  v_notification_id uuid;
  v_admin_id uuid;
BEGIN
  -- Tylko dla nowych nieobecności ze statusem pending
  IF (TG_OP = 'INSERT' AND NEW.status = 'pending') OR 
     (TG_OP = 'UPDATE' AND OLD.status != 'pending' AND NEW.status = 'pending') THEN
    
    -- Pobierz imię i nazwisko pracownika
    SELECT (name || ' ' || surname) INTO v_employee_name
    FROM employees
    WHERE id = NEW.employee_id;
    
    -- Przetłumacz typ nieobecności
    v_absence_type_pl := CASE NEW.absence_type
      WHEN 'vacation' THEN 'urlop wypoczynkowy'
      WHEN 'sick_leave' THEN 'zwolnienie lekarskie'
      WHEN 'unpaid_leave' THEN 'urlop bezpłatny'
      WHEN 'training' THEN 'szkolenie'
      WHEN 'remote_work' THEN 'praca zdalna'
      ELSE 'nieobecność'
    END;
    
    -- Utwórz główną notyfikację
    INSERT INTO notifications (
      category,
      subject,
      message,
      entity_type,
      entity_id,
      action_url,
      created_at
    )
    VALUES (
      'absence_request',
      'Nowa prośba o ' || v_absence_type_pl,
      v_employee_name || ' zgłosił prośbę o ' || v_absence_type_pl || ' w terminie ' || 
        TO_CHAR(NEW.start_date, 'DD.MM.YYYY') || ' - ' || TO_CHAR(NEW.end_date, 'DD.MM.YYYY') || 
        '. Kliknij aby zatwierdzić lub odrzucić.',
      'absence',
      NEW.id,
      '/crm/employees/' || NEW.employee_id::text || '?tab=timeline',
      NOW()
    )
    RETURNING id INTO v_notification_id;
    
    -- Wyślij notyfikację do wszystkich adminów i osób z uprawnieniem employees_manage
    FOR v_admin_id IN (
      SELECT id 
      FROM employees 
      WHERE is_admin = true 
         OR 'employees_manage' = ANY(permissions)
    )
    LOOP
      INSERT INTO notification_recipients (
        notification_id,
        employee_id,
        is_read,
        created_at
      )
      VALUES (
        v_notification_id,
        v_admin_id,
        false,
        NOW()
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger dla nowych nieobecności
DROP TRIGGER IF EXISTS trigger_notify_absence_request ON employee_absences;
CREATE TRIGGER trigger_notify_absence_request
  AFTER INSERT OR UPDATE OF status ON employee_absences
  FOR EACH ROW
  EXECUTE FUNCTION notify_absence_request();

-- Funkcja do zatwierdzania nieobecności
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
    AND (is_admin = true OR 'employees_manage' = ANY(permissions))
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
    approval_notes = p_notes,
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
    subject,
    message,
    entity_type,
    entity_id,
    action_url,
    created_at
  )
  VALUES (
    'absence_approved',
    'Zatwierdzono ' || v_absence_type_pl,
    v_approver_name || ' zatwierdził Twoją prośbę o ' || v_absence_type_pl || 
      ' w terminie ' || TO_CHAR(v_start_date, 'DD.MM.YYYY') || ' - ' || 
      TO_CHAR(v_end_date, 'DD.MM.YYYY') || '.',
    'absence',
    p_absence_id,
    '/crm/employees/' || v_employee_id::text || '?tab=timeline',
    NOW()
  )
  RETURNING id INTO v_notification_id;
  
  -- Dodaj odbiorcę - pracownika
  INSERT INTO notification_recipients (
    notification_id,
    employee_id,
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

-- Funkcja do odrzucania nieobecności
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
    AND (is_admin = true OR 'employees_manage' = ANY(permissions))
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
    approval_notes = p_reason,
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
    subject,
    message,
    entity_type,
    entity_id,
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
    p_absence_id,
    '/crm/employees/' || v_employee_id::text || '?tab=timeline',
    NOW()
  )
  RETURNING id INTO v_notification_id;
  
  -- Dodaj odbiorcę - pracownika
  INSERT INTO notification_recipients (
    notification_id,
    employee_id,
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

-- Dodaj nowe kategorie notyfikacji jeśli nie istnieją
DO $$
BEGIN
  -- Sprawdź czy typ notification_category istnieje jako enum
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_category') THEN
    -- Dodaj nowe wartości jeśli jeszcze nie istnieją
    BEGIN
      ALTER TYPE notification_category ADD VALUE IF NOT EXISTS 'absence_request';
      ALTER TYPE notification_category ADD VALUE IF NOT EXISTS 'absence_approved';
      ALTER TYPE notification_category ADD VALUE IF NOT EXISTS 'absence_rejected';
    EXCEPTION WHEN OTHERS THEN
      -- Ignoruj błędy jeśli wartości już istnieją
      NULL;
    END;
  END IF;
END $$;
