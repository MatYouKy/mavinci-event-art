# Instrukcja zastosowania systemu alertów V4

## ⚠️ WAŻNE - błąd "relation vehicle_alerts does not exist"

Jeśli otrzymałeś błąd:
```
ERROR: 42P01: relation "vehicle_alerts" does not exist
```

To znaczy że musisz najpierw utworzyć tabelę `vehicle_alerts`.

## 📋 Krok po kroku

### Krok 1: Sprawdź czy tabela istnieje

W Supabase Dashboard → SQL Editor uruchom:

```sql
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_name = 'vehicle_alerts'
);
```

**Wynik:**
- `true` → Tabela istnieje, przejdź do Kroku 3
- `false` → Tabela NIE istnieje, wykonaj Krok 2

### Krok 2: Utwórz tabelę vehicle_alerts (jeśli nie istnieje)

Uruchom zawartość pliku:
```
supabase/migrations/20251021240000_create_vehicle_alerts.sql
```

Lub użyj tego skryptu:

```sql
-- Minimalna wersja tworzenia tabeli
CREATE TABLE IF NOT EXISTS vehicle_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  alert_type text NOT NULL CHECK (alert_type IN ('insurance', 'inspection', 'maintenance', 'repair', 'other')),
  priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  title text NOT NULL,
  message text NOT NULL,
  icon text DEFAULT 'AlertTriangle',
  is_blocking boolean DEFAULT false,
  is_active boolean DEFAULT true,
  due_date date,
  related_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE vehicle_alerts ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Fleet managers can view alerts"
  ON vehicle_alerts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can manage alerts"
  ON vehicle_alerts FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_vehicle_alerts_vehicle_id ON vehicle_alerts(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_alerts_active ON vehicle_alerts(vehicle_id, is_active) WHERE is_active = true;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_alerts;
```

### Krok 3: Zastosuj system alertów V4

Uruchom plik:
```
FIX_ALERTS_AFTER_INSPECTION_V2.sql
```

Ten plik zawiera:
- ✅ Sprawdzenie czy tabele istnieją
- ✅ Trigger dla kontroli technicznych
- ✅ Trigger dla ubezpieczeń z ciągłością ochrony (V4)
- ✅ Czyszczenie duplikatów

### Krok 4: Wyczyść stare alerty (opcjonalne)

Jeśli masz już polisy w bazie, uruchom:
```
FIX_INSURANCE_ALERTS_V3_CLEAN.sql
```

Lub ręcznie:

```sql
-- Usuń wszystkie stare alerty ubezpieczeniowe
DELETE FROM vehicle_alerts WHERE alert_type = 'insurance';

-- Przelicz nowe (trigger wykona się automatycznie)
UPDATE insurance_policies
SET updated_at = now()
WHERE status IN ('active', 'expired');
```

### Krok 5: Weryfikacja

Sprawdź czy działa:

```sql
-- 1. Czy są duplikaty? (powinno być 0)
SELECT vehicle_id, LEFT(message, 10), COUNT(*)
FROM vehicle_alerts
WHERE alert_type = 'insurance'
GROUP BY vehicle_id, LEFT(message, 10)
HAVING COUNT(*) > 1;

-- 2. Pokaż wszystkie alerty
SELECT
  v.registration_number,
  va.message,
  va.priority,
  va.due_date
FROM vehicle_alerts va
JOIN vehicles v ON v.id = va.vehicle_id
WHERE va.alert_type = 'insurance'
ORDER BY v.registration_number;

-- 3. Dla konkretnego pojazdu (zmień PASSAT na swój)
SELECT * FROM vehicle_alerts va
JOIN vehicles v ON v.id = va.vehicle_id
WHERE v.registration_number LIKE '%PASSAT%'
AND va.alert_type = 'insurance';
```

## 🎯 Diagnoza problemu

Jeśli alert się nie pojawia lub nie znika, użyj:
```
DIAGNOZA_UBEZPIECZEN.sql
```

Pokaże dokładnie:
- Jakie polisy ma pojazd
- Czy jest ciągłość ochrony
- Co trigger "widzi"
- Dlaczego alert się pojawia lub nie

## 🚀 Gotowe!

Po zastosowaniu:
- ✅ Alert OC zniknie jeśli jest ciągłość ochrony
- ✅ Alert pojawi się 21 dni przed końcem
- ✅ System wykrywa luki w ochronie
- ✅ Alerty per typ (OC/AC/NNW osobno)
- ✅ Realtime aktualizacja

## 📚 Dokumentacja

Pełna dokumentacja systemu:
```
INSTRUKCJA_ALERTY_UBEZPIECZEN_V4_FINAL.md
```
