/*
  # Dodanie systemu typów klientów do eventów

  1. Zmiany w tabelach
    - Dodanie client_type do events ('individual' | 'business')
    - Dodanie position (stanowisko) do contacts
    - Utworzenie event_contact_persons dla wielu osób kontaktowych w business

  2. Opis
    - Individual: osoba prywatna, bez organizacji, bez faktur
    - Business: firma, z organizacją, osobami kontaktowymi i fakturami
*/

-- Dodaj client_type do events
ALTER TABLE events
ADD COLUMN IF NOT EXISTS client_type text DEFAULT 'business'
CHECK (client_type IN ('individual', 'business'));

COMMENT ON COLUMN events.client_type IS 'Typ klienta: individual (osoba prywatna bez firmy), business (firma z fakturami)';

-- Dodaj stanowisko do contacts
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS position text;

COMMENT ON COLUMN contacts.position IS 'Stanowisko osoby kontaktowej w firmie (np. Dyrektor, Manager)';

-- Utwórz tabelę dla wielu osób kontaktowych w evencie
CREATE TABLE IF NOT EXISTS event_contact_persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
  is_primary boolean DEFAULT false,
  role text,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(event_id, contact_id)
);

COMMENT ON TABLE event_contact_persons IS 'Wiele osób kontaktowych dla eventu (głównie business)';
COMMENT ON COLUMN event_contact_persons.is_primary IS 'Czy to główna osoba kontaktowa dla eventu';
COMMENT ON COLUMN event_contact_persons.role IS 'Rola w evencie (np. decydent, osoba kontaktowa)';

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_event_contact_persons_event ON event_contact_persons(event_id);
CREATE INDEX IF NOT EXISTS idx_event_contact_persons_contact ON event_contact_persons(contact_id);

-- RLS policies
ALTER TABLE event_contact_persons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Pracownicy mogą przeglądać osoby kontaktowe eventów"
  ON event_contact_persons FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'events_view' = ANY(permissions)
    )
  );

CREATE POLICY "Pracownicy mogą zarządzać osobami kontaktowymi eventów"
  ON event_contact_persons FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'events_manage' = ANY(permissions)
    )
  );

-- Trigger do automatycznego ustawienia is_primary gdy to pierwsza osoba
CREATE OR REPLACE FUNCTION set_primary_contact_person()
RETURNS TRIGGER AS $$
BEGIN
  -- Jeśli to pierwsza osoba kontaktowa dla eventu, ustaw jako primary
  IF NOT EXISTS (
    SELECT 1 FROM event_contact_persons
    WHERE event_id = NEW.event_id AND id != NEW.id
  ) THEN
    NEW.is_primary := true;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_primary_contact_person
  BEFORE INSERT ON event_contact_persons
  FOR EACH ROW
  EXECUTE FUNCTION set_primary_contact_person();