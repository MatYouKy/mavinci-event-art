/*
  # Nowy system klientów - wersja poprawiona

  Usuwa i tworzy od nowa system klientów
*/

-- Usuń starą strukturę
DROP TABLE IF EXISTS client_history CASCADE;
DROP TABLE IF EXISTS client_contacts CASCADE;
DROP TABLE IF EXISTS clients CASCADE;

-- Usuń client_id z events (jeśli istnieje)
ALTER TABLE events DROP COLUMN IF EXISTS client_id;

-- TYPY ENUM (z obsługą duplikatów)
DO $$ BEGIN CREATE TYPE client_type AS ENUM ('company', 'individual');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE client_category AS ENUM ('corporate_events', 'weddings', 'private_parties', 'conferences', 'other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE client_status AS ENUM ('active', 'potential', 'inactive', 'blacklisted');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE interaction_type AS ENUM ('meeting', 'email', 'phone', 'offer_sent', 'contract_signed', 'payment_received', 'event_completed', 'note', 'other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CLIENTS
CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_type client_type NOT NULL,
  company_name text,
  company_nip text,
  company_regon text,
  first_name text,
  last_name text,
  email text,
  phone_number text,
  phone_secondary text,
  website text,
  address_street text,
  address_city text,
  address_postal_code text,
  address_country text DEFAULT 'Polska',
  category client_category DEFAULT 'other',
  tags text[],
  status client_status DEFAULT 'potential',
  source text,
  notes text,
  preferred_contact_method text,
  language text DEFAULT 'pl',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES crm_users(id),
  total_events integer DEFAULT 0,
  total_revenue decimal(10,2) DEFAULT 0,
  last_event_date timestamptz,
  last_contact_date timestamptz
);

-- CLIENT_CONTACTS
CREATE TABLE client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  position text,
  email text,
  phone_number text,
  phone_direct text,
  is_primary_contact boolean DEFAULT false,
  is_decision_maker boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- CLIENT_HISTORY
CREATE TABLE client_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  interaction_type interaction_type NOT NULL,
  title text NOT NULL,
  description text,
  interaction_date timestamptz DEFAULT now(),
  performed_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  attachments jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Dodaj client_id do events
ALTER TABLE events ADD COLUMN client_id uuid REFERENCES clients(id) ON DELETE SET NULL;

-- INDEKSY
CREATE INDEX idx_clients_type ON clients(client_type);
CREATE INDEX idx_clients_status_new ON clients(status);
CREATE INDEX idx_clients_category_new ON clients(category);
CREATE INDEX idx_clients_email_new ON clients(email);
CREATE INDEX idx_clients_company ON clients(company_name);
CREATE INDEX idx_client_contacts_client ON client_contacts(client_id);
CREATE INDEX idx_client_contacts_primary ON client_contacts(is_primary_contact);
CREATE INDEX idx_client_history_client ON client_history(client_id);
CREATE INDEX idx_client_history_date ON client_history(interaction_date DESC);
CREATE INDEX idx_events_client ON events(client_id);

-- TRIGGERY
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_client_contacts_updated_at BEFORE UPDATE ON client_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION update_client_last_contact()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE clients SET last_contact_date = NEW.interaction_date WHERE id = NEW.client_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_client_last_contact_trigger AFTER INSERT ON client_history
  FOR EACH ROW EXECUTE FUNCTION update_client_last_contact();

-- RLS
ALTER TABLE clients DISABLE ROW LEVEL SECURITY;
ALTER TABLE client_contacts DISABLE ROW LEVEL SECURITY;
ALTER TABLE client_history DISABLE ROW LEVEL SECURITY;

-- DANE PRZYKŁADOWE
INSERT INTO clients (client_type, company_name, company_nip, first_name, last_name, email, phone_number, category, status, source)
VALUES ('company'::client_type, 'Tech Corp Sp. z o.o.', '1234567890', 'Anna', 'Kowalska', 'kontakt@techcorp.pl', '+48 123 456 789', 'corporate_events'::client_category, 'active'::client_status, 'Rekomendacja');

INSERT INTO clients (client_type, first_name, last_name, email, phone_number, category, status, source)
VALUES ('individual'::client_type, 'Jan', 'Nowak', 'jan.nowak@email.pl', '+48 987 654 321', 'weddings'::client_category, 'potential'::client_status, 'Strona www');
