# 🔧 Instrukcja zastosowania migracji systemu serwisu pojazdów

## ⚠️ KRYTYCZNE: Wykonaj te kroki aby naprawić błędy!

### Błędy które naprawimy:
```
❌ "Could not find the table 'public.periodic_inspections' in the schema cache"
❌ "column employees.full_name does not exist"
❌ "column employees.is_admin does not exist"
```

---

## 📋 KROK 1: Zastosuj migrację w Supabase Dashboard

1. **Wejdź na:** https://supabase.com/dashboard
2. **Wybierz projekt**
3. **SQL Editor** (z lewego menu)
4. **Skopiuj i uruchom poniższy kod SQL:**

```sql
-- ============================================
-- MIGRACJA: System serwisu i napraw pojazdów
-- Data: 2025-10-21
-- ============================================

-- 1. KONTROLE TECHNICZNE I PRZEGLĄDY
CREATE TABLE IF NOT EXISTS periodic_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  inspection_type text NOT NULL CHECK (inspection_type IN ('technical_inspection', 'periodic_service')),
  inspection_date date NOT NULL,
  valid_until date NOT NULL,
  certificate_number text,
  performed_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  service_provider text,
  passed boolean DEFAULT true,
  defects_noted text,
  cost numeric(10,2) DEFAULT 0,
  odometer_reading integer NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE periodic_inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fleet managers can view inspections"
  ON periodic_inspections FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can insert inspections"
  ON periodic_inspections FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can update inspections"
  ON periodic_inspections FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Only admins can delete inspections"
  ON periodic_inspections FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  );

-- 2. WYMIANY OLEJU
CREATE TABLE IF NOT EXISTS oil_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  change_date date NOT NULL,
  odometer_reading integer NOT NULL,
  next_change_due_mileage integer NOT NULL,
  next_change_due_date date NOT NULL,
  service_provider text,
  labor_cost numeric(10,2) DEFAULT 0,
  parts_cost numeric(10,2) DEFAULT 0,
  total_cost numeric(10,2) GENERATED ALWAYS AS (labor_cost + parts_cost) STORED,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oil_change_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oil_change_id uuid NOT NULL REFERENCES oil_changes(id) ON DELETE CASCADE,
  part_type text NOT NULL CHECK (part_type IN ('oil', 'oil_filter', 'air_filter', 'cabin_filter', 'other')),
  part_name text NOT NULL,
  part_number text,
  quantity numeric(10,2) NOT NULL,
  unit text DEFAULT 'l',
  cost numeric(10,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE oil_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE oil_change_parts ENABLE ROW LEVEL SECURITY;

-- Polityki dla oil_changes
CREATE POLICY "Fleet managers can view oil changes"
  ON oil_changes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can insert oil changes"
  ON oil_changes FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can update oil changes"
  ON oil_changes FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Only admins can delete oil changes"
  ON oil_changes FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  );

-- Polityki dla oil_change_parts
CREATE POLICY "Fleet managers can view parts"
  ON oil_change_parts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      JOIN oil_changes oc ON oc.id = oil_change_parts.oil_change_id
      WHERE e.id = auth.uid()
      AND 'fleet_manage' = ANY(e.permissions)
    )
  );

CREATE POLICY "Fleet managers can insert parts"
  ON oil_change_parts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      JOIN oil_changes oc ON oc.id = oil_change_parts.oil_change_id
      WHERE e.id = auth.uid()
      AND 'fleet_manage' = ANY(e.permissions)
    )
  );

CREATE POLICY "Fleet managers can update parts"
  ON oil_change_parts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      JOIN oil_changes oc ON oc.id = oil_change_parts.oil_change_id
      WHERE e.id = auth.uid()
      AND 'fleet_manage' = ANY(e.permissions)
    )
  );

CREATE POLICY "Only admins can delete parts"
  ON oil_change_parts FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  );

-- 3. WYMIANY ROZRZĄDU
CREATE TABLE IF NOT EXISTS timing_belt_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  change_date date NOT NULL,
  odometer_reading integer NOT NULL,
  next_change_due_mileage integer NOT NULL,
  service_provider text,
  labor_cost numeric(10,2) DEFAULT 0,
  parts_cost numeric(10,2) DEFAULT 0,
  total_cost numeric(10,2) GENERATED ALWAYS AS (labor_cost + parts_cost) STORED,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE timing_belt_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fleet managers can view timing belt changes"
  ON timing_belt_changes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can insert timing belt changes"
  ON timing_belt_changes FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can update timing belt changes"
  ON timing_belt_changes FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Only admins can delete timing belt changes"
  ON timing_belt_changes FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  );

-- 4. USTERKI POJAZDU
CREATE TABLE IF NOT EXISTS vehicle_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  blocks_availability boolean DEFAULT false,
  reported_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES employees(id) ON DELETE SET NULL,
  reported_date date NOT NULL DEFAULT CURRENT_DATE,
  resolved_date date,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE vehicle_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fleet managers can view issues"
  ON vehicle_issues FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can insert issues"
  ON vehicle_issues FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can update issues"
  ON vehicle_issues FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Only admins can delete issues"
  ON vehicle_issues FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  );

-- Trigger: automatycznie blokuj pojazd przy krytycznych usterkach
CREATE OR REPLACE FUNCTION auto_block_critical_issues()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.priority IN ('high', 'critical') AND NEW.status IN ('open', 'in_progress') THEN
    NEW.blocks_availability = true;
  END IF;

  IF NEW.status IN ('resolved', 'closed') THEN
    NEW.blocks_availability = false;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_block_issues
  BEFORE INSERT OR UPDATE ON vehicle_issues
  FOR EACH ROW
  EXECUTE FUNCTION auto_block_critical_issues();
```

---

## ✅ KROK 2: Weryfikacja

Po uruchomieniu SQL, sprawdź czy wszystko działa:

```sql
-- Sprawdź czy tabele zostały utworzone
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'periodic_inspections',
  'oil_changes',
  'oil_change_parts',
  'timing_belt_changes',
  'vehicle_issues'
);
```

Powinieneś zobaczyć **5 tabel**.

---

## 🎯 Co zostało naprawione:

### 1. Kontrola techniczna
- ✅ Pole `performed_by` (UUID pracownika) zamiast `inspector_name` (text)
- ✅ Select z listą pracowników: `{name} {surname}`

### 2. Inne naprawy
- ✅ Status `scheduled` - zaplanowane naprawy
- ✅ Pole `estimated_completion_date` - szacowana data
- ✅ Warunkowe wyświetlanie pól:
  - Status "Zaplanowana" → pokaż datę szacowaną
  - Status "Zakończona" → pokaż naprawione elementy

### 3. Uprawnienia DELETE
- ✅ **Tylko administratorzy** (`'admin' = ANY(permissions)`) mogą usuwać:
  - Kontrole techniczne
  - Wymiany oleju
  - Wymiany rozrządu
  - Usterki

### 4. Użycie przykładowe

**Zaplanowana naprawa:**
```
Tytuł: "Sprawdzić hamulce - pisk"
Status: Zaplanowana
Poziom: Niski
Szacowana data: 2025-11-10
Opis: "Kierowca zgłasza pisk podczas hamowania"
```

**Zakończona naprawa:**
```
Tytuł: "Wymiana klocków hamulcowych"
Status: Zakończona
Naprawione elementy:
  1. Klocki przednie (ABC123) - 450 zł
  2. Płyn hamulcowy (DOT4) - 50 zł
Robocizna: 200 zł
```

---

## 🚀 Po zastosowaniu migracji:

1. ✅ Formularz kontroli technicznej będzie działał
2. ✅ Select pracowników będzie wyświetlał listę
3. ✅ Możesz dodawać zaplanowane naprawy
4. ✅ Tylko admini mogą usuwać historię serwisu

---

## ⚠️ WAŻNE

Jeśli tabela `maintenance_repairs` już istnieje w bazie, **NIE** musisz jej tworzyć ponownie.
System zaplanowanych napraw działa na istniejącej tabeli `maintenance_repairs` która ma:
- `status` → 'scheduled', 'in_progress', 'completed', 'cancelled'
- `estimated_completion_date` → data szacowana

---

## 📞 Problemy?

Jeśli nadal występują błędy, sprawdź:
1. Czy tabele zostały utworzone: `\dt` w SQL Editor
2. Czy polityki RLS są aktywne: `SELECT * FROM pg_policies WHERE tablename LIKE '%inspection%';`
3. Czy użytkownik ma uprawnienie `fleet_manage` w tabeli `employees`
