/*
  # Rozbudowa systemu ofert dla sprzedawców
  
  Rozszerza istniejącą tabelę offers i dodaje nowe tabele
*/

-- 1. SPRZEDAWCY
CREATE TABLE IF NOT EXISTS salespeople (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE,
  email text UNIQUE NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone_number text,
  is_active boolean DEFAULT true,
  commission_rate numeric(5,2) DEFAULT 0,
  assigned_regions text[],
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. KATALOG ATRAKCJI
CREATE TABLE IF NOT EXISTS attractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  category text NOT NULL CHECK (category IN (
    'sound_system', 'lighting', 'dj_services', 'stage_tech', 
    'decorations', 'entertainment', 'casino', 'simulators', 
    'conference', 'streaming', 'other'
  )),
  base_price numeric(10,2) NOT NULL,
  unit text DEFAULT 'szt',
  duration_hours numeric(4,1),
  min_quantity integer DEFAULT 1,
  max_quantity integer,
  is_active boolean DEFAULT true,
  image_url text,
  tags text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 3. Rozszerz offers (tylko brakujące kolumny)
ALTER TABLE offers ADD COLUMN IF NOT EXISTS salesperson_id uuid;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS event_date timestamptz;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS event_location text;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS total_base_price numeric(10,2) DEFAULT 0;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS total_final_price numeric(10,2) DEFAULT 0;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS discount_percentage numeric(5,2) DEFAULT 0;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) DEFAULT 0;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS internal_notes text;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS viewed_at timestamptz;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

-- 4. POZYCJE OFERTY
CREATE TABLE IF NOT EXISTS offer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid REFERENCES offers(id) ON DELETE CASCADE NOT NULL,
  attraction_id uuid REFERENCES attractions(id),
  custom_name text,
  description text,
  base_price numeric(10,2) NOT NULL,
  final_price numeric(10,2) NOT NULL,
  quantity integer DEFAULT 1,
  unit text DEFAULT 'szt',
  discount_percentage numeric(5,2) DEFAULT 0,
  subtotal numeric(10,2),
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 5. AUDYT ZMIAN CEN
CREATE TABLE IF NOT EXISTS offer_price_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid REFERENCES offers(id) ON DELETE CASCADE,
  offer_item_id uuid REFERENCES offer_items(id) ON DELETE CASCADE,
  attraction_id uuid REFERENCES attractions(id),
  salesperson_id uuid REFERENCES salespeople(id),
  base_price numeric(10,2) NOT NULL,
  modified_price numeric(10,2) NOT NULL,
  price_difference numeric(10,2),
  price_change_percent numeric(5,2),
  reason text,
  created_at timestamptz DEFAULT now()
);

-- 6. KALENDARZ SPRZEDAWCY
CREATE TABLE IF NOT EXISTS salesperson_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id uuid REFERENCES salespeople(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  event_type text,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  is_blocked boolean DEFAULT false,
  client_id uuid REFERENCES clients(id),
  offer_id uuid REFERENCES offers(id),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE salespeople ENABLE ROW LEVEL SECURITY;
ALTER TABLE attractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_price_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE salesperson_calendar ENABLE ROW LEVEL SECURITY;

-- POLITYKI
DROP POLICY IF EXISTS "Auth can view salespeople" ON salespeople;
CREATE POLICY "Auth can view salespeople"
  ON salespeople FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth can manage salespeople" ON salespeople;
CREATE POLICY "Auth can manage salespeople"
  ON salespeople FOR ALL TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth can view attractions" ON attractions;
CREATE POLICY "Auth can view attractions"
  ON attractions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth can manage attractions" ON attractions;
CREATE POLICY "Auth can manage attractions"
  ON attractions FOR ALL TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth can manage offer_items" ON offer_items;
CREATE POLICY "Auth can manage offer_items"
  ON offer_items FOR ALL TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth can manage audit" ON offer_price_audit;
CREATE POLICY "Auth can manage audit"
  ON offer_price_audit FOR ALL TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth can manage calendar" ON salesperson_calendar;
CREATE POLICY "Auth can manage calendar"
  ON salesperson_calendar FOR ALL TO authenticated USING (true);

-- INDEKSY
CREATE INDEX IF NOT EXISTS idx_salespeople_auth ON salespeople(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_salespeople_email ON salespeople(email);
CREATE INDEX IF NOT EXISTS idx_offers_salesperson ON offers(salesperson_id);
CREATE INDEX IF NOT EXISTS idx_offer_items_offer ON offer_items(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_items_attraction ON offer_items(attraction_id);
CREATE INDEX IF NOT EXISTS idx_calendar_salesperson ON salesperson_calendar(salesperson_id);
CREATE INDEX IF NOT EXISTS idx_calendar_dates ON salesperson_calendar(start_date, end_date);

-- TRIGGER do aktualizacji subtotal w offer_items
CREATE OR REPLACE FUNCTION calculate_offer_item_subtotal()
RETURNS TRIGGER AS $$
BEGIN
  NEW.subtotal := NEW.final_price * NEW.quantity;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_offer_item_subtotal ON offer_items;
CREATE TRIGGER update_offer_item_subtotal
  BEFORE INSERT OR UPDATE ON offer_items
  FOR EACH ROW
  EXECUTE FUNCTION calculate_offer_item_subtotal();

-- TRIGGER do zapisywania audytu zmian cen
CREATE OR REPLACE FUNCTION audit_price_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.final_price != NEW.base_price THEN
    INSERT INTO offer_price_audit (
      offer_id, offer_item_id, attraction_id, salesperson_id,
      base_price, modified_price, 
      price_difference, price_change_percent
    ) VALUES (
      NEW.offer_id, NEW.id, NEW.attraction_id,
      (SELECT salesperson_id FROM offers WHERE id = NEW.offer_id),
      NEW.base_price, NEW.final_price,
      NEW.final_price - NEW.base_price,
      CASE WHEN NEW.base_price > 0 
        THEN ((NEW.final_price - NEW.base_price) / NEW.base_price * 100)
        ELSE 0 
      END
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_offer_item_price ON offer_items;
CREATE TRIGGER audit_offer_item_price
  AFTER INSERT OR UPDATE ON offer_items
  FOR EACH ROW
  EXECUTE FUNCTION audit_price_change();

-- SEKWENCJA dla numerów ofert (jeśli nie istnieje)
CREATE SEQUENCE IF NOT EXISTS offer_number_seq START WITH 1000;
