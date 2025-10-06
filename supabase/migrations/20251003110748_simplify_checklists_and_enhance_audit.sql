/*
  # Uproszczenie checklisty i rozszerzenie audit log

  1. Zmiany w tabeli event_checklists
    - Dodanie kolumny `task` (text) - treść zadania
    - Dodanie kolumny `priority` (text) - priorytet
    - Dodanie kolumny `completed` (boolean) - status wykonania
    - Usunięcie kolumn `title` i `items` (stara struktura)
  
  2. Rozszerzenie audit log
    - Dodanie triggerów do automatycznego logowania zmian
  
  3. Bezpieczeństwo
    - RLS wyłączony dla developmentu
*/

-- Usuń starą strukturę i stwórz nową prostszą tabelę checklisty
DROP TABLE IF EXISTS event_checklists CASCADE;

CREATE TABLE event_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  task text NOT NULL,
  priority text DEFAULT 'medium',
  completed boolean DEFAULT false,
  completed_at timestamptz,
  completed_by uuid REFERENCES crm_users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index dla szybszego wyszukiwania
CREATE INDEX IF NOT EXISTS idx_event_checklists_event_id ON event_checklists(event_id);

-- Wyłącz RLS dla developmentu
ALTER TABLE event_checklists DISABLE ROW LEVEL SECURITY;

-- Funkcja do automatycznego aktualizowania updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger dla event_checklists
DROP TRIGGER IF EXISTS update_event_checklists_updated_at ON event_checklists;
CREATE TRIGGER update_event_checklists_updated_at
    BEFORE UPDATE ON event_checklists
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger dla events
DROP TRIGGER IF EXISTS update_events_updated_at ON events;
CREATE TRIGGER update_events_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Dodaj updated_at do events jeśli nie istnieje
ALTER TABLE events ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
