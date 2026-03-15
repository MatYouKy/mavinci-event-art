/*
  # System Konfliktów Sprzętowych dla Ofert

  1. Nowe Tabele
    - `offer_equipment_conflicts` - przechowuje wykryte konflikty dla każdej oferty
      * Pozwala na elastyczne rozwiązywanie konfliktów bez blokowania tworzenia oferty
      * Wspiera substytucje i rental zewnętrzny
      * Automatyczne odświeżanie gdy zmieni się dostępność sprzętu

  2. Nowe Pola w Events
    - `pending_external_rental` - flaga wskazująca że event wymaga rentalu zewnętrznego
    - Blokuje zmianę statusu na 'ready_for_execution' dopóki nie zostanie rozwiązane

  3. Statusy Rezerwacji w event_equipment
    - Rozróżnienie między wstępną a potwierdzoną rezerwacją
    - Status bazuje na statusie oferty

  4. Bezpieczeństwo
    - RLS policies dla wszystkich tabel
    - Dostęp dla użytkowników z odpowiednimi uprawnieniami
*/

-- Typ statusu konfliktu
DO $$ BEGIN
  CREATE TYPE conflict_status AS ENUM (
    'unresolved',        -- nierozwiązany
    'substituted',       -- rozwiązany przez substytucję
    'external_rental',   -- rozwiązany przez rental zewnętrzny
    'resolved'           -- rozwiązany (sprzęt się zwolnił)
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Typ statusu rezerwacji sprzętu
DO $$ BEGIN
  CREATE TYPE equipment_reservation_status AS ENUM (
    'planned',              -- planowany (oferta draft/sent)
    'reserved_pending',     -- wstępnie zarezerwowany (oferta accepted)
    'reserved_confirmed',   -- potwierdzona rezerwacja (po podpisaniu umowy)
    'in_use',              -- w użyciu (podczas eventu)
    'returned'             -- zwrócony
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Tabela konfliktów sprzętowych w ofertach
CREATE TABLE IF NOT EXISTS offer_equipment_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  
  -- Sprzęt, którego dotyczy konflikt
  equipment_item_id uuid REFERENCES equipment_items(id) ON DELETE CASCADE,
  equipment_kit_id uuid REFERENCES equipment_kits(id) ON DELETE CASCADE,
  
  -- Ilości
  required_qty integer NOT NULL CHECK (required_qty > 0),
  available_qty integer NOT NULL CHECK (available_qty >= 0),
  shortage_qty integer NOT NULL CHECK (shortage_qty >= 0),
  
  -- Status i rozwiązanie
  status conflict_status NOT NULL DEFAULT 'unresolved',
  use_external_rental boolean DEFAULT false,
  
  -- Szczegóły konfliktu
  conflict_details jsonb, -- nakładające się eventy, daty itp.
  conflict_until timestamptz,
  
  -- Kto i kiedy rozwiązał
  resolved_at timestamptz,
  resolved_by uuid REFERENCES employees(id),
  notes text,
  
  -- Timestampy
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Walidacje
  CONSTRAINT check_one_equipment_type CHECK (
    (equipment_item_id IS NOT NULL AND equipment_kit_id IS NULL) OR
    (equipment_item_id IS NULL AND equipment_kit_id IS NOT NULL)
  )
);

-- Dodaj pole do events dla rentalu zewnętrznego
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'events' AND column_name = 'pending_external_rental'
  ) THEN
    ALTER TABLE events ADD COLUMN pending_external_rental boolean DEFAULT false;
  END IF;
END $$;

-- Dodaj status rezerwacji do event_equipment
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'event_equipment' AND column_name = 'reservation_status'
  ) THEN
    ALTER TABLE event_equipment ADD COLUMN reservation_status equipment_reservation_status DEFAULT 'planned';
  END IF;
END $$;

-- Indeksy dla wydajności
CREATE INDEX IF NOT EXISTS idx_conflicts_offer ON offer_equipment_conflicts(offer_id);
CREATE INDEX IF NOT EXISTS idx_conflicts_status ON offer_equipment_conflicts(status);
CREATE INDEX IF NOT EXISTS idx_conflicts_item ON offer_equipment_conflicts(equipment_item_id);
CREATE INDEX IF NOT EXISTS idx_conflicts_kit ON offer_equipment_conflicts(equipment_kit_id);
CREATE INDEX IF NOT EXISTS idx_conflicts_unresolved ON offer_equipment_conflicts(offer_id, status) 
  WHERE status = 'unresolved';

CREATE INDEX IF NOT EXISTS idx_event_equipment_reservation ON event_equipment(reservation_status);
CREATE INDEX IF NOT EXISTS idx_events_pending_rental ON events(pending_external_rental) 
  WHERE pending_external_rental = true;

-- Automatyczna aktualizacja updated_at
CREATE OR REPLACE FUNCTION update_conflicts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_conflicts_updated_at ON offer_equipment_conflicts;
CREATE TRIGGER trigger_conflicts_updated_at
  BEFORE UPDATE ON offer_equipment_conflicts
  FOR EACH ROW
  EXECUTE FUNCTION update_conflicts_updated_at();

-- Funkcja do automatycznej aktualizacji flagi pending_external_rental w events
CREATE OR REPLACE FUNCTION update_event_external_rental_flag()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_has_external_rental boolean;
BEGIN
  -- Pobierz event_id z oferty
  SELECT event_id INTO v_event_id
  FROM offers
  WHERE id = COALESCE(NEW.offer_id, OLD.offer_id);
  
  -- Sprawdź czy są nierozwiązane konflikty z rentalem zewnętrznym
  SELECT EXISTS (
    SELECT 1
    FROM offer_equipment_conflicts c
    JOIN offers o ON o.id = c.offer_id
    WHERE o.event_id = v_event_id
      AND c.use_external_rental = true
      AND c.status IN ('unresolved', 'external_rental')
  ) INTO v_has_external_rental;
  
  -- Zaktualizuj flagę w events
  UPDATE events
  SET pending_external_rental = v_has_external_rental
  WHERE id = v_event_id;
  
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Trigger do automatycznej aktualizacji flagi
DROP TRIGGER IF EXISTS trigger_update_event_external_rental ON offer_equipment_conflicts;
CREATE TRIGGER trigger_update_event_external_rental
  AFTER INSERT OR UPDATE OR DELETE ON offer_equipment_conflicts
  FOR EACH ROW
  EXECUTE FUNCTION update_event_external_rental_flag();

-- RLS Policies
ALTER TABLE offer_equipment_conflicts ENABLE ROW LEVEL SECURITY;

-- Polityka SELECT - użytkownicy z uprawnieniami do ofert
DROP POLICY IF EXISTS "Users can view conflicts for offers they can access" ON offer_equipment_conflicts;
CREATE POLICY "Users can view conflicts for offers they can access"
  ON offer_equipment_conflicts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (
          'admin' = ANY(employees.permissions)
          OR 'offers_view' = ANY(employees.permissions)
        )
    )
  );

-- Polityka INSERT - użytkownicy z uprawnieniami do zarządzania ofertami
DROP POLICY IF EXISTS "Users can create conflicts for offers" ON offer_equipment_conflicts;
CREATE POLICY "Users can create conflicts for offers"
  ON offer_equipment_conflicts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (
          'admin' = ANY(employees.permissions)
          OR 'offers_manage' = ANY(employees.permissions)
        )
    )
  );

-- Polityka UPDATE - użytkownicy z uprawnieniami do zarządzania ofertami
DROP POLICY IF EXISTS "Users can update conflicts" ON offer_equipment_conflicts;
CREATE POLICY "Users can update conflicts"
  ON offer_equipment_conflicts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (
          'admin' = ANY(employees.permissions)
          OR 'offers_manage' = ANY(employees.permissions)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND (
          'admin' = ANY(employees.permissions)
          OR 'offers_manage' = ANY(employees.permissions)
        )
    )
  );

-- Polityka DELETE - tylko admini
DROP POLICY IF EXISTS "Admins can delete conflicts" ON offer_equipment_conflicts;
CREATE POLICY "Admins can delete conflicts"
  ON offer_equipment_conflicts
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
        AND 'admin' = ANY(employees.permissions)
    )
  );

-- Enable realtime dla konfliktów
ALTER PUBLICATION supabase_realtime ADD TABLE offer_equipment_conflicts;

-- Komentarze
COMMENT ON TABLE offer_equipment_conflicts IS 
'Przechowuje konflikty sprzętowe wykryte dla ofert - pozwala na elastyczne rozwiązywanie bez blokowania tworzenia oferty';

COMMENT ON COLUMN events.pending_external_rental IS 
'Flaga wskazująca że event wymaga rentalu zewnętrznego i nie może być oznaczony jako gotowy do realizacji';

COMMENT ON COLUMN event_equipment.reservation_status IS 
'Status rezerwacji sprzętu: planned (oferta draft), reserved_pending (oferta accepted), reserved_confirmed (po umowie)';
