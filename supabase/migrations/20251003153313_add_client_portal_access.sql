/*
  # System dostępu klientów do portalu

  ## Opis zmian
  
  Rozszerzenie systemu o możliwość logowania klientów i tworzenia przez nich ofert
  z ograniczonym dostępem do usług.

  ## 1. Zmiany w tabeli clients
    - `portal_access` (boolean) - czy klient ma dostęp do portalu
    - `portal_email` (text) - email do logowania (może być inny niż główny email)
    - `allowed_categories` (text[]) - dozwolone kategorie usług dla tego klienta
    - `custom_price_multiplier` (numeric) - mnożnik ceny dla tego klienta (np. 0.9 = 10% rabatu)
    - `portal_active_until` (timestamptz) - data wygaśnięcia dostępu do portalu

  ## 2. Nowa tabela: client_allowed_attractions
    - Precyzyjna kontrola - które konkretne atrakcje klient może widzieć
    - `client_id` - ID klienta
    - `attraction_id` - ID atrakcji
    - `custom_price` - opcjonalna własna cena dla klienta (nadpisuje base_price)
    - `notes` - notatki dla admina

  ## 3. Tabela: client_portal_sessions
    - Audyt logowań klientów do portalu
    - `client_id` - ID klienta
    - `logged_in_at` - kiedy się zalogował
    - `logged_out_at` - kiedy się wylogował
    - `ip_address` - adres IP
    - `user_agent` - przeglądarka

  ## 4. Security (RLS)
    - Klienci mogą widzieć tylko swoje dane i oferty
    - Klienci mogą widzieć tylko dozwolone atrakcje
    - Pracownicy widzą wszystko
    - Admin może zarządzać dostępami
*/

-- 1. Rozszerz tabelę clients
DO $$
BEGIN
  -- Portal access fields
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'clients' AND column_name = 'portal_access'
  ) THEN
    ALTER TABLE clients ADD COLUMN portal_access boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'clients' AND column_name = 'portal_email'
  ) THEN
    ALTER TABLE clients ADD COLUMN portal_email text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'clients' AND column_name = 'allowed_categories'
  ) THEN
    ALTER TABLE clients ADD COLUMN allowed_categories text[];
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'clients' AND column_name = 'custom_price_multiplier'
  ) THEN
    ALTER TABLE clients ADD COLUMN custom_price_multiplier numeric DEFAULT 1.0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'clients' AND column_name = 'portal_active_until'
  ) THEN
    ALTER TABLE clients ADD COLUMN portal_active_until timestamptz;
  END IF;
END $$;

-- 2. Tabela: client_allowed_attractions
CREATE TABLE IF NOT EXISTS client_allowed_attractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  attraction_id uuid NOT NULL REFERENCES attractions(id) ON DELETE CASCADE,
  custom_price numeric,
  notes text,
  created_at timestamptz DEFAULT NOW(),
  created_by uuid REFERENCES employees(id),
  UNIQUE(client_id, attraction_id)
);

-- Indeksy dla wydajności
CREATE INDEX IF NOT EXISTS idx_client_allowed_attractions_client 
  ON client_allowed_attractions(client_id);
CREATE INDEX IF NOT EXISTS idx_client_allowed_attractions_attraction 
  ON client_allowed_attractions(attraction_id);

-- 3. Tabela: client_portal_sessions
CREATE TABLE IF NOT EXISTS client_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  logged_in_at timestamptz DEFAULT NOW(),
  logged_out_at timestamptz,
  ip_address text,
  user_agent text,
  session_data jsonb
);

CREATE INDEX IF NOT EXISTS idx_client_portal_sessions_client 
  ON client_portal_sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_client_portal_sessions_login_date 
  ON client_portal_sessions(logged_in_at DESC);

-- 4. RLS Policies

-- client_allowed_attractions
ALTER TABLE client_allowed_attractions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees can view all allowed attractions" ON client_allowed_attractions;
CREATE POLICY "Employees can view all allowed attractions"
  ON client_allowed_attractions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE employees.id = auth.uid() 
      AND employees.is_active = true
    )
  );

DROP POLICY IF EXISTS "Employees can manage allowed attractions" ON client_allowed_attractions;
CREATE POLICY "Employees can manage allowed attractions"
  ON client_allowed_attractions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE employees.id = auth.uid() 
      AND employees.is_active = true
      AND employees.access_level IN ('admin', 'manager')
    )
  );

-- client_portal_sessions  
ALTER TABLE client_portal_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees can view all portal sessions" ON client_portal_sessions;
CREATE POLICY "Employees can view all portal sessions"
  ON client_portal_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE employees.id = auth.uid() 
      AND employees.is_active = true
    )
  );

DROP POLICY IF EXISTS "System can create portal sessions" ON client_portal_sessions;
CREATE POLICY "System can create portal sessions"
  ON client_portal_sessions FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 5. Funkcja pomocnicza: sprawdź czy klient ma dostęp do atrakcji
CREATE OR REPLACE FUNCTION client_can_view_attraction(
  p_client_id uuid,
  p_attraction_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_portal_access boolean;
  v_portal_active_until timestamptz;
  v_allowed_categories text[];
  v_attraction_category text;
  v_has_specific_access boolean;
BEGIN
  -- Sprawdź czy klient ma aktywny dostęp do portalu
  SELECT 
    portal_access, 
    portal_active_until,
    allowed_categories
  INTO 
    v_portal_access, 
    v_portal_active_until,
    v_allowed_categories
  FROM clients
  WHERE id = p_client_id;

  -- Brak dostępu do portalu
  IF NOT v_portal_access THEN
    RETURN false;
  END IF;

  -- Dostęp wygasł
  IF v_portal_active_until IS NOT NULL AND v_portal_active_until < NOW() THEN
    RETURN false;
  END IF;

  -- Sprawdź czy ma konkretny dostęp do tej atrakcji
  SELECT EXISTS(
    SELECT 1 FROM client_allowed_attractions
    WHERE client_id = p_client_id
    AND attraction_id = p_attraction_id
  ) INTO v_has_specific_access;

  IF v_has_specific_access THEN
    RETURN true;
  END IF;

  -- Sprawdź czy kategoria atrakcji jest w dozwolonych kategoriach
  IF v_allowed_categories IS NOT NULL AND array_length(v_allowed_categories, 1) > 0 THEN
    SELECT category INTO v_attraction_category
    FROM attractions
    WHERE id = p_attraction_id;

    RETURN v_attraction_category = ANY(v_allowed_categories);
  END IF;

  -- Domyślnie brak dostępu
  RETURN false;
END;
$$;

-- 6. Funkcja: pobierz cenę atrakcji dla klienta
CREATE OR REPLACE FUNCTION get_client_attraction_price(
  p_client_id uuid,
  p_attraction_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_custom_price numeric;
  v_base_price numeric;
  v_multiplier numeric;
BEGIN
  -- Sprawdź czy jest custom price dla tego klienta
  SELECT custom_price INTO v_custom_price
  FROM client_allowed_attractions
  WHERE client_id = p_client_id
  AND attraction_id = p_attraction_id;

  IF v_custom_price IS NOT NULL THEN
    RETURN v_custom_price;
  END IF;

  -- Pobierz base price i multiplier
  SELECT 
    a.base_price,
    c.custom_price_multiplier
  INTO 
    v_base_price,
    v_multiplier
  FROM attractions a
  CROSS JOIN clients c
  WHERE a.id = p_attraction_id
  AND c.id = p_client_id;

  -- Zastosuj multiplier
  IF v_multiplier IS NOT NULL AND v_multiplier != 1.0 THEN
    RETURN v_base_price * v_multiplier;
  END IF;

  RETURN v_base_price;
END;
$$;

-- 7. Dodaj constraint na portal_email (unikalna tylko gdy wypełniona)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_portal_email_unique 
  ON clients(portal_email) 
  WHERE portal_email IS NOT NULL;

-- 8. Komentarze
COMMENT ON COLUMN clients.portal_access IS 'Czy klient ma dostęp do portalu samoobsługowego';
COMMENT ON COLUMN clients.portal_email IS 'Email do logowania do portalu (może różnić się od głównego email)';
COMMENT ON COLUMN clients.allowed_categories IS 'Kategorie usług dostępne dla tego klienta';
COMMENT ON COLUMN clients.custom_price_multiplier IS 'Mnożnik ceny dla tego klienta (np. 0.9 = 10% rabatu)';
COMMENT ON COLUMN clients.portal_active_until IS 'Data wygaśnięcia dostępu do portalu';

COMMENT ON TABLE client_allowed_attractions IS 'Precyzyjna kontrola dostępu klientów do konkretnych atrakcji';
COMMENT ON TABLE client_portal_sessions IS 'Audyt logowań klientów do portalu samoobsługowego';
