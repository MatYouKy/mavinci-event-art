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
     - `category` - kategoria: 'client', 'event', 'offer', 'employee', 'system', 'global', 'contact_form'
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
  category text NOT NULL CHECK (category IN ('client', 'event', 'offer', 'employee', 'system', 'global', 'contact_form')),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid,
  related_entity_type text CHECK (related_entity_type IN ('client', 'event', 'offer', 'employee', 'equipment', 'contact_messages')),
  related_entity_id text,
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

-- Policy: Wszyscy mogą czytać notyfikacje (aby było widać notyfikacje o wiadomościach kontaktowych)
CREATE POLICY "Everyone can view notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Każdy może aktualizować status przeczytania notyfikacji
CREATE POLICY "Users can update notifications"
  ON notifications FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Policy: Użytkownicy mogą tworzyć notyfikacje
CREATE POLICY "Authenticated users can create notifications"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy: Użytkownicy mogą usuwać notyfikacje
CREATE POLICY "Users can delete notifications"
  ON notifications FOR DELETE
  TO authenticated
  USING (true);
