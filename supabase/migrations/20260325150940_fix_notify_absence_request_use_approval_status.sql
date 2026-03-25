/*
  # Fix notify_absence_request to Use approval_status

  1. Changes
    - Update notify_absence_request trigger function to use approval_status instead of status
    - Update trigger to watch approval_status column changes
*/

-- Funkcja wysyłająca notyfikację o nowej nieobecności (FIXED)
CREATE OR REPLACE FUNCTION notify_absence_request()
RETURNS TRIGGER AS $$
DECLARE
  v_employee_name text;
  v_absence_type_pl text;
  v_notification_id uuid;
  v_admin_id uuid;
BEGIN
  -- Tylko dla nowych nieobecności ze statusem pending
  IF (TG_OP = 'INSERT' AND NEW.approval_status = 'pending') OR 
     (TG_OP = 'UPDATE' AND OLD.approval_status != 'pending' AND NEW.approval_status = 'pending') THEN
    
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
      WHERE 'employees_manage' = ANY(permissions)
         OR 'admin' = ANY(permissions)
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

-- Recreate trigger to watch approval_status column
DROP TRIGGER IF EXISTS trigger_notify_absence_request ON employee_absences;
CREATE TRIGGER trigger_notify_absence_request
  AFTER INSERT OR UPDATE OF approval_status ON employee_absences
  FOR EACH ROW
  EXECUTE FUNCTION notify_absence_request();