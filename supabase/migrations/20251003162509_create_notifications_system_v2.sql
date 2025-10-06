/*
  # System notyfikacji dla platformy

  ## Opis
  
  System powiadomień dla administratorów i użytkowników (klientów).
  - Admin widzi WSZYSTKIE akcje w platformie
  - Klient widzi tylko swoje notyfikacje + globalne
  - Możliwość oznaczania jako przeczytane
  - Różne typy notyfikacji (info, success, warning, error)
  - Automatyczne tworzenie notyfikacji przez triggery

  ## Tabele
  
  1. **notifications** - główna tabela z powiadomieniami
     - `id` - UUID, primary key
     - `title` - tytuł notyfikacji
     - `message` - treść wiadomości
     - `type` - typ: 'info', 'success', 'warning', 'error'
     - `category` - kategoria: 'client', 'event', 'offer', 'employee', 'system', 'global'
     - `user_id` - UUID, ID użytkownika (NULL = wszyscy admini)
     - `client_id` - UUID, ID klienta (dla notyfikacji klientów)
     - `related_entity_type` - typ powiązanej encji
     - `related_entity_id` - UUID powiązanej encji
     - `is_read` - boolean, czy przeczytane
     - `is_global` - boolean, czy globalne (dla wszystkich)
     - `action_url` - link do akcji
     - `created_by` - UUID użytkownika który wywołał akcję
     - `created_at` - timestamp

  ## Bezpieczeństwo
  
  - RLS włączone
  - Admin widzi wszystkie notyfikacje (przez sprawdzenie w employees po email)
  - Klient widzi tylko swoje (gdzie client_id = jego ID) + globalne
  - Każdy może oznaczyć swoje jako przeczytane
*/

-- Tabela notifications
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'error')),
  category text NOT NULL CHECK (category IN ('client', 'event', 'offer', 'employee', 'system', 'global')),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  related_entity_type text CHECK (related_entity_type IN ('client', 'event', 'offer', 'employee', 'equipment')),
  related_entity_id uuid,
  is_read boolean DEFAULT false,
  is_global boolean DEFAULT false,
  action_url text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

-- Indeksy dla wydajności
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_client_id ON notifications(client_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_category ON notifications(category);

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Policy: Admin widzi wszystkie notyfikacje (sprawdzamy czy email z auth.users istnieje w employees)
CREATE POLICY "Admins can view all notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.email = (
        SELECT email FROM auth.users WHERE id = auth.uid()
      )
      AND employees.is_active = true
    )
  );

-- Policy: Klient widzi swoje notyfikacje + globalne
CREATE POLICY "Clients can view their notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (
    is_global = true 
    OR client_id IN (
      SELECT id FROM clients 
      WHERE portal_email = (
        SELECT email FROM auth.users WHERE id = auth.uid()
      )
    )
    OR user_id = auth.uid()
  );

-- Policy: Każdy może aktualizować status przeczytania swoich notyfikacji
CREATE POLICY "Users can update their own notifications"
  ON notifications FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid() 
    OR client_id IN (
      SELECT id FROM clients 
      WHERE portal_email = (
        SELECT email FROM auth.users WHERE id = auth.uid()
      )
    )
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE employees.email = (
        SELECT email FROM auth.users WHERE id = auth.uid()
      )
    )
  )
  WITH CHECK (
    user_id = auth.uid() 
    OR client_id IN (
      SELECT id FROM clients 
      WHERE portal_email = (
        SELECT email FROM auth.users WHERE id = auth.uid()
      )
    )
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE employees.email = (
        SELECT email FROM auth.users WHERE id = auth.uid()
      )
    )
  );

-- Policy: Użytkownicy mogą tworzyć notyfikacje
CREATE POLICY "Authenticated users can create notifications"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Funkcja pomocnicza do tworzenia notyfikacji
CREATE OR REPLACE FUNCTION create_notification(
  p_title text,
  p_message text,
  p_type text DEFAULT 'info',
  p_category text DEFAULT 'system',
  p_user_id uuid DEFAULT NULL,
  p_client_id uuid DEFAULT NULL,
  p_related_entity_type text DEFAULT NULL,
  p_related_entity_id uuid DEFAULT NULL,
  p_is_global boolean DEFAULT false,
  p_action_url text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_notification_id uuid;
  v_created_by uuid;
BEGIN
  v_created_by := auth.uid();

  INSERT INTO notifications (
    title,
    message,
    type,
    category,
    user_id,
    client_id,
    related_entity_type,
    related_entity_id,
    is_global,
    action_url,
    created_by,
    metadata
  ) VALUES (
    p_title,
    p_message,
    p_type,
    p_category,
    p_user_id,
    p_client_id,
    p_related_entity_type,
    p_related_entity_id,
    p_is_global,
    p_action_url,
    v_created_by,
    p_metadata
  )
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$;

-- Trigger: Nowy klient
CREATE OR REPLACE FUNCTION notify_new_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_client_name text;
BEGIN
  v_client_name := COALESCE(NEW.company_name, NEW.first_name || ' ' || NEW.last_name);

  PERFORM create_notification(
    'Nowy klient dodany',
    'Dodano nowego klienta: ' || v_client_name,
    'success',
    'client',
    NULL,
    NULL,
    'client',
    NEW.id,
    false,
    '/crm/clients/' || NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_new_client ON clients;
CREATE TRIGGER trigger_notify_new_client
  AFTER INSERT ON clients
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_client();

-- Trigger: Nowe wydarzenie
CREATE OR REPLACE FUNCTION notify_new_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_client_name text;
BEGIN
  SELECT COALESCE(company_name, first_name || ' ' || last_name)
  INTO v_client_name
  FROM clients
  WHERE id = NEW.client_id;

  PERFORM create_notification(
    'Nowe wydarzenie utworzone',
    'Wydarzenie "' || NEW.name || '" dla klienta: ' || COALESCE(v_client_name, 'Nieznany'),
    'info',
    'event',
    NULL,
    NEW.client_id,
    'event',
    NEW.id,
    false,
    '/crm/events/' || NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_new_event ON events;
CREATE TRIGGER trigger_notify_new_event
  AFTER INSERT ON events
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_event();

-- Trigger: Zmiana statusu wydarzenia
CREATE OR REPLACE FUNCTION notify_event_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_client_name text;
  v_notification_type text;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT COALESCE(company_name, first_name || ' ' || last_name)
    INTO v_client_name
    FROM clients
    WHERE id = NEW.client_id;

    v_notification_type := CASE
      WHEN NEW.status = 'completed' THEN 'success'
      WHEN NEW.status = 'cancelled' THEN 'error'
      WHEN NEW.status = 'confirmed' THEN 'success'
      ELSE 'info'
    END;

    PERFORM create_notification(
      'Zmiana statusu wydarzenia',
      'Wydarzenie "' || NEW.name || '" - status zmieniony na: ' || NEW.status,
      v_notification_type,
      'event',
      NULL,
      NEW.client_id,
      'event',
      NEW.id,
      false,
      '/crm/events/' || NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_event_status_change ON events;
CREATE TRIGGER trigger_notify_event_status_change
  AFTER UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION notify_event_status_change();

-- Trigger: Nowa oferta
CREATE OR REPLACE FUNCTION notify_new_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_client_name text;
BEGIN
  SELECT COALESCE(company_name, first_name || ' ' || last_name)
  INTO v_client_name
  FROM clients
  WHERE id = NEW.client_id;

  PERFORM create_notification(
    'Nowa oferta utworzona',
    'Oferta #' || NEW.offer_number || ' dla klienta: ' || COALESCE(v_client_name, 'Nieznany'),
    'info',
    'offer',
    NULL,
    NEW.client_id,
    'offer',
    NEW.id,
    false,
    '/crm/offers/' || NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_new_offer ON offers;
CREATE TRIGGER trigger_notify_new_offer
  AFTER INSERT ON offers
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_offer();

-- Trigger: Zmiana statusu oferty
CREATE OR REPLACE FUNCTION notify_offer_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_client_name text;
  v_notification_type text;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT COALESCE(company_name, first_name || ' ' || last_name)
    INTO v_client_name
    FROM clients
    WHERE id = NEW.client_id;

    v_notification_type := CASE
      WHEN NEW.status = 'accepted' THEN 'success'
      WHEN NEW.status = 'rejected' THEN 'error'
      WHEN NEW.status = 'sent' THEN 'info'
      ELSE 'info'
    END;

    PERFORM create_notification(
      'Zmiana statusu oferty',
      'Oferta #' || NEW.offer_number || ' - status zmieniony na: ' || NEW.status,
      v_notification_type,
      'offer',
      NULL,
      NEW.client_id,
      'offer',
      NEW.id,
      false,
      '/crm/offers/' || NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_offer_status_change ON offers;
CREATE TRIGGER trigger_notify_offer_status_change
  AFTER UPDATE ON offers
  FOR EACH ROW
  EXECUTE FUNCTION notify_offer_status_change();

-- Trigger: Nowy pracownik
CREATE OR REPLACE FUNCTION notify_new_employee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM create_notification(
    'Nowy pracownik dodany',
    'Dodano pracownika: ' || NEW.name || ' ' || NEW.surname || ' (' || COALESCE(NEW.role::text, 'brak roli') || ')',
    'success',
    'employee',
    NULL,
    NULL,
    'employee',
    NEW.id,
    false,
    '/crm/employees/' || NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_new_employee ON employees;
CREATE TRIGGER trigger_notify_new_employee
  AFTER INSERT ON employees
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_employee();

-- Komentarze
COMMENT ON TABLE notifications IS 'System notyfikacji - admin widzi wszystko, klient tylko swoje + globalne';
COMMENT ON FUNCTION create_notification IS 'Funkcja pomocnicza do tworzenia notyfikacji';
