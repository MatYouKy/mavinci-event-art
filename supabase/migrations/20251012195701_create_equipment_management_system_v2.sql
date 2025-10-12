/*
  # System Zarządzania Sprzętem

  ## Opis
  Kompleksowy system do zarządzania sprzętem eventowym z kategoriami, 
  szczegółowymi informacjami technicznymi, galeriami zdjęć i stanem magazynowym.

  ## Nowe Tabele

  ### `equipment_categories`
  Elastyczny system kategorii zarządzany przez admina
  - `id` (uuid, primary key)
  - `name` (text) - nazwa kategorii (np. "Dźwięk", "Oświetlenie")
  - `description` (text, nullable) - opis kategorii
  - `icon` (text, nullable) - nazwa ikony do wyświetlenia
  - `order_index` (integer) - kolejność wyświetlania
  - `is_active` (boolean) - czy kategoria jest aktywna
  - `parent_category_id` (uuid, nullable) - dla podkategorii
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### `equipment_items`
  Główna tabela sprzętu
  - `id` (uuid, primary key)
  - `name` (text) - nazwa sprzętu
  - `category_id` (uuid) - foreign key do equipment_categories
  - `brand` (text, nullable) - marka
  - `model` (text, nullable) - model
  - `description` (text, nullable) - opis
  - `thumbnail_url` (text, nullable) - miniaturka
  - `user_manual_url` (text, nullable) - link do instrukcji
  - `weight_kg` (decimal, nullable) - waga w kg
  - `dimensions_cm` (jsonb, nullable) - wymiary {length, width, height}
  - `purchase_date` (date, nullable) - data zakupu
  - `purchase_price` (decimal, nullable) - cena zakupu
  - `current_value` (decimal, nullable) - aktualna wartość
  - `warranty_until` (date, nullable) - gwarancja do
  - `serial_number` (text, nullable) - numer seryjny
  - `barcode` (text, nullable) - kod kreskowy
  - `notes` (text, nullable) - notatki
  - `is_active` (boolean) - czy sprzęt jest aktywny
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### `equipment_gallery`
  Galeria zdjęć dla każdego sprzętu
  - `id` (uuid, primary key)
  - `equipment_id` (uuid) - foreign key do equipment_items
  - `image_url` (text) - URL zdjęcia
  - `image_metadata` (jsonb, nullable) - metadata obrazu (pozycja, scale, etc.)
  - `caption` (text, nullable) - opis zdjęcia
  - `order_index` (integer) - kolejność
  - `created_at` (timestamptz)

  ### `equipment_components`
  Co wchodzi w skład zestawu (np. przewody, pokrowce)
  - `id` (uuid, primary key)
  - `equipment_id` (uuid) - foreign key do equipment_items
  - `component_name` (text) - nazwa komponentu
  - `quantity` (integer) - ilość
  - `description` (text, nullable) - opis
  - `is_included` (boolean) - czy jest w komplecie
  - `created_at` (timestamptz)

  ### `equipment_stock`
  Stan magazynowy
  - `id` (uuid, primary key)
  - `equipment_id` (uuid) - foreign key do equipment_items (unique)
  - `total_quantity` (integer) - łączna ilość
  - `available_quantity` (integer) - dostępne
  - `reserved_quantity` (integer) - zarezerwowane
  - `in_use_quantity` (integer) - w użyciu
  - `damaged_quantity` (integer) - uszkodzone
  - `in_service_quantity` (integer) - w serwisie
  - `min_stock_level` (integer) - minimalny poziom magazynowy
  - `storage_location` (text, nullable) - lokalizacja w magazynie
  - `last_inventory_date` (date, nullable) - ostatnia inwentaryzacja
  - `updated_at` (timestamptz)

  ### `equipment_stock_history`
  Historia zmian stanu magazynowego
  - `id` (uuid, primary key)
  - `equipment_id` (uuid) - foreign key do equipment_items
  - `change_type` (text) - typ zmiany (purchase, rent, return, damage, repair, etc.)
  - `quantity_change` (integer) - zmiana ilości (+/-)
  - `quantity_after` (integer) - stan po zmianie
  - `employee_id` (uuid, nullable) - kto dokonał zmiany
  - `notes` (text, nullable) - notatki
  - `created_at` (timestamptz)

  ## Bezpieczeństwo
  - RLS włączony na wszystkich tabelach
  - Polityki dla authenticated users do odczytu
  - Polityki dla adminów do zapisu

  ## Notatki
  - System pozwala na elastyczne dodawanie kategorii przez admina
  - Pełna historia zmian magazynowych
  - Obsługa komponentów wchodzących w skład zestawu
  - Galerie zdjęć z każdego kąta
*/

-- Kategorie sprzętu
CREATE TABLE IF NOT EXISTS equipment_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  icon text,
  order_index integer DEFAULT 0,
  is_active boolean DEFAULT true,
  parent_category_id uuid REFERENCES equipment_categories(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Główna tabela sprzętu
CREATE TABLE IF NOT EXISTS equipment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category_id uuid REFERENCES equipment_categories(id) ON DELETE SET NULL,
  brand text,
  model text,
  description text,
  thumbnail_url text,
  user_manual_url text,
  weight_kg decimal(10,2),
  dimensions_cm jsonb,
  purchase_date date,
  purchase_price decimal(10,2),
  current_value decimal(10,2),
  warranty_until date,
  serial_number text,
  barcode text UNIQUE,
  notes text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Galeria zdjęć
CREATE TABLE IF NOT EXISTS equipment_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  image_metadata jsonb,
  caption text,
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Komponenty wchodzące w skład
CREATE TABLE IF NOT EXISTS equipment_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  component_name text NOT NULL,
  quantity integer DEFAULT 1,
  description text,
  is_included boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Stan magazynowy
CREATE TABLE IF NOT EXISTS equipment_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL UNIQUE REFERENCES equipment_items(id) ON DELETE CASCADE,
  total_quantity integer DEFAULT 0,
  available_quantity integer DEFAULT 0,
  reserved_quantity integer DEFAULT 0,
  in_use_quantity integer DEFAULT 0,
  damaged_quantity integer DEFAULT 0,
  in_service_quantity integer DEFAULT 0,
  min_stock_level integer DEFAULT 0,
  storage_location text,
  last_inventory_date date,
  updated_at timestamptz DEFAULT now()
);

-- Historia magazynowa
CREATE TABLE IF NOT EXISTS equipment_stock_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES equipment_items(id) ON DELETE CASCADE,
  change_type text NOT NULL,
  quantity_change integer NOT NULL,
  quantity_after integer NOT NULL,
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Indeksy dla wydajności
CREATE INDEX IF NOT EXISTS idx_equipment_category ON equipment_items(category_id);
CREATE INDEX IF NOT EXISTS idx_equipment_active ON equipment_items(is_active);
CREATE INDEX IF NOT EXISTS idx_equipment_barcode ON equipment_items(barcode);
CREATE INDEX IF NOT EXISTS idx_equipment_gallery_item ON equipment_gallery(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_components_item ON equipment_components(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_stock_item ON equipment_stock(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_history_item ON equipment_stock_history(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_history_date ON equipment_stock_history(created_at);

-- RLS Policies
ALTER TABLE equipment_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_gallery ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_stock_history ENABLE ROW LEVEL SECURITY;

-- Polityki dla kategorii
CREATE POLICY "Anyone can view active categories"
  ON equipment_categories FOR SELECT
  USING (is_active = true);

CREATE POLICY "Authenticated users can view all categories"
  ON equipment_categories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage categories"
  ON equipment_categories FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
  );

-- Polityki dla sprzętu
CREATE POLICY "Authenticated users can view equipment"
  ON equipment_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage equipment"
  ON equipment_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
  );

-- Polityki dla galerii
CREATE POLICY "Authenticated users can view gallery"
  ON equipment_gallery FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage gallery"
  ON equipment_gallery FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
  );

-- Polityki dla komponentów
CREATE POLICY "Authenticated users can view components"
  ON equipment_components FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage components"
  ON equipment_components FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
  );

-- Polityki dla stanu magazynowego
CREATE POLICY "Authenticated users can view stock"
  ON equipment_stock FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Employees can update stock"
  ON equipment_stock FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage stock"
  ON equipment_stock FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
  );

-- Polityki dla historii magazynowej
CREATE POLICY "Authenticated users can view stock history"
  ON equipment_stock_history FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Employees can add stock history"
  ON equipment_stock_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
    )
  );

-- Trigger do automatycznej aktualizacji updated_at
CREATE OR REPLACE FUNCTION update_equipment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER equipment_categories_updated_at
  BEFORE UPDATE ON equipment_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_equipment_updated_at();

CREATE TRIGGER equipment_items_updated_at
  BEFORE UPDATE ON equipment_items
  FOR EACH ROW
  EXECUTE FUNCTION update_equipment_updated_at();

CREATE TRIGGER equipment_stock_updated_at
  BEFORE UPDATE ON equipment_stock
  FOR EACH ROW
  EXECUTE FUNCTION update_equipment_updated_at();

-- Funkcja do automatycznego tworzenia rekordu stock przy dodaniu sprzętu
CREATE OR REPLACE FUNCTION create_equipment_stock()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO equipment_stock (equipment_id, total_quantity, available_quantity)
  VALUES (NEW.id, 0, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER equipment_items_create_stock
  AFTER INSERT ON equipment_items
  FOR EACH ROW
  EXECUTE FUNCTION create_equipment_stock();

-- Funkcja do aktualizacji stanu magazynowego i dodania historii
CREATE OR REPLACE FUNCTION update_equipment_stock_with_history(
  p_equipment_id uuid,
  p_change_type text,
  p_quantity_change integer,
  p_employee_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_current_available integer;
  v_new_available integer;
BEGIN
  SELECT available_quantity INTO v_current_available
  FROM equipment_stock
  WHERE equipment_id = p_equipment_id;

  v_new_available := v_current_available + p_quantity_change;

  UPDATE equipment_stock
  SET 
    available_quantity = v_new_available,
    total_quantity = CASE 
      WHEN p_change_type IN ('purchase', 'add') THEN total_quantity + p_quantity_change
      WHEN p_change_type IN ('remove', 'dispose') THEN total_quantity + p_quantity_change
      ELSE total_quantity
    END,
    in_use_quantity = CASE
      WHEN p_change_type = 'rent' THEN in_use_quantity + ABS(p_quantity_change)
      WHEN p_change_type = 'return' THEN in_use_quantity - ABS(p_quantity_change)
      ELSE in_use_quantity
    END,
    damaged_quantity = CASE
      WHEN p_change_type = 'damage' THEN damaged_quantity + ABS(p_quantity_change)
      WHEN p_change_type = 'repair' THEN damaged_quantity - ABS(p_quantity_change)
      ELSE damaged_quantity
    END
  WHERE equipment_id = p_equipment_id;

  INSERT INTO equipment_stock_history (
    equipment_id,
    change_type,
    quantity_change,
    quantity_after,
    employee_id,
    notes
  ) VALUES (
    p_equipment_id,
    p_change_type,
    p_quantity_change,
    v_new_available,
    p_employee_id,
    p_notes
  );
END;
$$ LANGUAGE plpgsql;
