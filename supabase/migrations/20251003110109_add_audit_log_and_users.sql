/*
  # Dodanie audit log i systemu śledzenia zmian

  1. Nowe tabele
    - `crm_users` - użytkownicy CRM (proste rozwiązanie bez pełnej autentykacji)
      - `id` (uuid, primary key)
      - `email` (text, unique)
      - `name` (text)
      - `role` (text)
      - `created_at` (timestamp)
    
    - `event_audit_log` - historia zmian w eventach
      - `id` (uuid, primary key)
      - `event_id` (uuid, foreign key)
      - `user_id` (uuid, foreign key)
      - `user_name` (text) - przechowujemy nazwę dla historii
      - `action` (text) - typ akcji (created, updated, status_changed, equipment_added, etc.)
      - `field_name` (text) - nazwa zmienionego pola
      - `old_value` (text) - stara wartość
      - `new_value` (text) - nowa wartość
      - `description` (text) - opis zmiany
      - `created_at` (timestamp)
  
  2. Bezpieczeństwo
    - RLS wyłączony dla developmentu
*/

-- Tabela użytkowników CRM
CREATE TABLE IF NOT EXISTS crm_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  role text DEFAULT 'user',
  created_at timestamptz DEFAULT now()
);

-- Dodaj przykładowego użytkownika
INSERT INTO crm_users (email, name, role) 
VALUES ('admin@mavinci.pl', 'Administrator', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Tabela audit log dla eventów
CREATE TABLE IF NOT EXISTS event_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid REFERENCES crm_users(id) ON DELETE SET NULL,
  user_name text NOT NULL,
  action text NOT NULL,
  field_name text,
  old_value text,
  new_value text,
  description text,
  created_at timestamptz DEFAULT now()
);

-- Index dla szybszego wyszukiwania
CREATE INDEX IF NOT EXISTS idx_audit_log_event_id ON event_audit_log(event_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON event_audit_log(created_at DESC);

-- Wyłącz RLS dla developmentu
ALTER TABLE crm_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE event_audit_log DISABLE ROW LEVEL SECURITY;

-- Dodaj kolumnę do trackowania checklistów
ALTER TABLE event_checklists ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE event_checklists ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES crm_users(id) ON DELETE SET NULL;
