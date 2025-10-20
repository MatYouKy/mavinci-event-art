/*
  # System zaproszeń dla kierowców do wydarzeń

  1. Zmiany w tabeli event_vehicles
    - Dodaj kolumnę `invitation_status` (text) - 'pending', 'accepted', 'declined'
    - Dodaj kolumnę `invited_at` (timestamptz) - kiedy wysłano zaproszenie
    - Dodaj kolumnę `responded_at` (timestamptz) - kiedy kierowca odpowiedział

  2. Notyfikacje
    - Trigger wysyłający notyfikację do kierowcy po przypisaniu
    - Trigger notyfikujący managera o odpowiedzi kierowcy

  3. RLS
    - Kierowca może odpowiadać na swoje zaproszenia
*/

-- Dodaj kolumny do event_vehicles
ALTER TABLE event_vehicles
ADD COLUMN IF NOT EXISTS invitation_status text DEFAULT 'pending' CHECK (invitation_status IN ('pending', 'accepted', 'declined')),
ADD COLUMN IF NOT EXISTS invited_at timestamptz DEFAULT now(),
ADD COLUMN IF NOT EXISTS responded_at timestamptz;

-- Dodaj indeks
CREATE INDEX IF NOT EXISTS idx_event_vehicles_driver_invitation 
  ON event_vehicles(driver_id, invitation_status);

-- Funkcja wysyłająca notyfikację o zaproszeniu kierowcy
CREATE OR REPLACE FUNCTION notify_driver_invitation()
RETURNS TRIGGER AS $$
DECLARE
  event_name text;
  event_date timestamptz;
  event_location text;
  notification_id uuid;
BEGIN
  -- Pobierz dane wydarzenia
  SELECT name, event_date, location 
  INTO event_name, event_date, event_location
  FROM events 
  WHERE id = NEW.event_id;

  -- Jeśli jest kierowca i invitation_status to pending (nowe zaproszenie)
  IF NEW.driver_id IS NOT NULL AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.driver_id IS DISTINCT FROM OLD.driver_id)) THEN
    -- Wstaw notyfikację
    INSERT INTO notifications (
      title,
      message,
      category,
      entity_type,
      entity_id,
      action_url,
      created_by
    ) VALUES (
      'Zaproszenie do wydarzenia jako kierowca',
      format('Zostałeś przypisany jako kierowca do wydarzenia "%s" w dniu %s w lokalizacji: %s. Proszę zaakceptuj lub odrzuć zaproszenie.',
        event_name,
        to_char(event_date, 'DD.MM.YYYY HH24:MI'),
        event_location
      ),
      'event_assignment',
      'event',
      NEW.event_id,
      '/crm/events/' || NEW.event_id || '?tab=logistics',
      NEW.driver_id
    )
    RETURNING id INTO notification_id;

    -- Wstaw odbiorcę
    INSERT INTO notification_recipients (notification_id, employee_id)
    VALUES (notification_id, NEW.driver_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger dla zaproszeń kierowców
DROP TRIGGER IF EXISTS trigger_notify_driver_invitation ON event_vehicles;
CREATE TRIGGER trigger_notify_driver_invitation
  AFTER INSERT OR UPDATE OF driver_id ON event_vehicles
  FOR EACH ROW
  WHEN (NEW.driver_id IS NOT NULL)
  EXECUTE FUNCTION notify_driver_invitation();

-- Funkcja notyfikująca o odpowiedzi kierowcy
CREATE OR REPLACE FUNCTION notify_driver_response()
RETURNS TRIGGER AS $$
DECLARE
  event_rec record;
  driver_name text;
  manager_ids uuid[];
  notification_id uuid;
BEGIN
  -- Jeśli zmienił się status zaproszenia
  IF TG_OP = 'UPDATE' AND NEW.invitation_status IS DISTINCT FROM OLD.invitation_status THEN
    -- Pobierz dane wydarzenia i kierowcy
    SELECT 
      e.id, e.name, e.event_date, e.created_by,
      emp.name || ' ' || emp.surname as driver_full_name
    INTO event_rec
    FROM events e
    LEFT JOIN employees emp ON emp.id = NEW.driver_id
    WHERE e.id = NEW.event_id;

    driver_name := event_rec.driver_full_name;

    -- Znajdź wszystkich managerów wydarzenia (creator + osoby z uprawnieniami events_manage)
    SELECT ARRAY_AGG(DISTINCT emp.id)
    INTO manager_ids
    FROM employees emp
    WHERE emp.id = event_rec.created_by
       OR 'events_manage' = ANY(emp.permissions);

    -- Wyślij notyfikację do managerów
    IF manager_ids IS NOT NULL THEN
      INSERT INTO notifications (
        title,
        message,
        category,
        entity_type,
        entity_id,
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
          driver_name,
          CASE 
            WHEN NEW.invitation_status = 'accepted' THEN 'zaakceptował'
            WHEN NEW.invitation_status = 'declined' THEN 'odrzucił'
            ELSE 'zmienił status'
          END,
          event_rec.name
        ),
        'event_update',
        'event',
        NEW.event_id,
        '/crm/events/' || NEW.event_id || '?tab=logistics',
        NEW.driver_id
      )
      RETURNING id INTO notification_id;

      -- Wstaw odbiorców
      INSERT INTO notification_recipients (notification_id, employee_id)
      SELECT notification_id, unnest(manager_ids);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger dla odpowiedzi kierowców
DROP TRIGGER IF EXISTS trigger_notify_driver_response ON event_vehicles;
CREATE TRIGGER trigger_notify_driver_response
  AFTER UPDATE OF invitation_status ON event_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION notify_driver_response();

-- RLS - kierowcy mogą aktualizować status swoich zaproszeń
DROP POLICY IF EXISTS "Drivers can update their invitation status" ON event_vehicles;
CREATE POLICY "Drivers can update their invitation status"
  ON event_vehicles
  FOR UPDATE
  TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());