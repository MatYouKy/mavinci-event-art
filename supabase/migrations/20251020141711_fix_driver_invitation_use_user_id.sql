/*
  # Napraw triggery - użyj user_id zamiast employee_id
  
  Problem:
  - notification_recipients ma kolumnę user_id (nie employee_id)
  
  Rozwiązanie:
  - Użyj user_id w INSERT do notification_recipients
*/

-- Napraw funkcję notify_driver_invitation
CREATE OR REPLACE FUNCTION notify_driver_invitation()
RETURNS TRIGGER AS $$
DECLARE
  v_event_name text;
  v_event_date timestamptz;
  v_event_location text;
  v_notification_id uuid;
BEGIN
  -- Pobierz dane wydarzenia z aliasami
  SELECT e.name, e.event_date, e.location 
  INTO v_event_name, v_event_date, v_event_location
  FROM events e
  WHERE e.id = NEW.event_id;

  -- Jeśli jest kierowca i invitation_status to pending (nowe zaproszenie)
  IF NEW.driver_id IS NOT NULL AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.driver_id IS DISTINCT FROM OLD.driver_id)) THEN
    -- Wstaw notyfikację
    INSERT INTO notifications (
      title,
      message,
      category,
      related_entity_type,
      related_entity_id,
      action_url,
      created_by
    ) VALUES (
      'Zaproszenie do wydarzenia jako kierowca',
      format('Zostałeś przypisany jako kierowca do wydarzenia "%s" w dniu %s w lokalizacji: %s. Proszę zaakceptuj lub odrzuć zaproszenie.',
        v_event_name,
        to_char(v_event_date, 'DD.MM.YYYY HH24:MI'),
        v_event_location
      ),
      'event_assignment',
      'event',
      NEW.event_id,
      '/crm/events/' || NEW.event_id || '?tab=logistics',
      NEW.driver_id
    )
    RETURNING id INTO v_notification_id;

    -- Wstaw odbiorcę z user_id
    INSERT INTO notification_recipients (notification_id, user_id)
    VALUES (v_notification_id, NEW.driver_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Napraw funkcję notify_driver_response
CREATE OR REPLACE FUNCTION notify_driver_response()
RETURNS TRIGGER AS $$
DECLARE
  v_event_rec record;
  v_driver_name text;
  v_manager_ids uuid[];
  v_notification_id uuid;
  v_manager_id uuid;
BEGIN
  -- Jeśli zmienił się status zaproszenia
  IF TG_OP = 'UPDATE' AND NEW.invitation_status IS DISTINCT FROM OLD.invitation_status THEN
    -- Pobierz dane wydarzenia i kierowcy
    SELECT 
      e.id, e.name, e.event_date, e.created_by,
      emp.name || ' ' || emp.surname as driver_full_name
    INTO v_event_rec
    FROM events e
    LEFT JOIN employees emp ON emp.id = NEW.driver_id
    WHERE e.id = NEW.event_id;

    v_driver_name := v_event_rec.driver_full_name;

    -- Znajdź wszystkich managerów wydarzenia (creator + osoby z uprawnieniami events_manage)
    SELECT ARRAY_AGG(DISTINCT emp.id)
    INTO v_manager_ids
    FROM employees emp
    WHERE emp.id = v_event_rec.created_by
       OR 'events_manage' = ANY(emp.permissions);

    -- Wyślij notyfikację do każdego managera
    IF v_manager_ids IS NOT NULL THEN
      FOREACH v_manager_id IN ARRAY v_manager_ids
      LOOP
        INSERT INTO notifications (
          title,
          message,
          category,
          related_entity_type,
          related_entity_id,
          action_url,
          created_by
        ) VALUES (
          format('Kierowca %s zaproszenie do wydarzenia',
            CASE 
              WHEN NEW.invitation_status = 'accepted' THEN 'zaakceptował'
              WHEN NEW.invitation_status = 'declined' THEN 'odrzucił'
              ELSE 'zmienił status'
            END
          ),
          format('Kierowca %s %s zaproszenie do wydarzenia "%s".',
            v_driver_name,
            CASE 
              WHEN NEW.invitation_status = 'accepted' THEN 'zaakceptował'
              WHEN NEW.invitation_status = 'declined' THEN 'odrzucił'
              ELSE 'zmienił status'
            END,
            v_event_rec.name
          ),
          'event_update',
          'event',
          NEW.event_id,
          '/crm/events/' || NEW.event_id || '?tab=logistics',
          NEW.driver_id
        )
        RETURNING id INTO v_notification_id;

        -- Wstaw odbiorcę z user_id
        INSERT INTO notification_recipients (notification_id, user_id)
        VALUES (v_notification_id, v_manager_id);
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;