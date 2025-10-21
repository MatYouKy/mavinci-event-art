# Instrukcja zastosowania migracji systemu flotowego

## ⚠️ WAŻNE - Przed rozpoczęciem

1. **Zrób backup bazy danych!**
2. Migracja jest w pliku: `supabase/migrations/20251021200000_reorganize_vehicle_maintenance_system.sql`
3. Zawiera 627 linii - zastosuj ją przez Supabase Dashboard

## Kroki zastosowania migracji

### Opcja A: Przez Supabase Dashboard (zalecane)

1. Wejdź na https://supabase.com/dashboard
2. Wybierz projekt
3. Przejdź do **SQL Editor**
4. Skopiuj zawartość pliku `supabase/migrations/20251021200000_reorganize_vehicle_maintenance_system.sql`
5. Wklej do SQL Editor
6. Kliknij **Run**
7. Sprawdź logi - wszystko powinno przejść bez błędów

### Opcja B: Przez Supabase CLI

```bash
# Zainstaluj Supabase CLI jeśli jeszcze nie masz
npm install -g supabase

# Zaloguj się
supabase login

# Link do projektu
supabase link --project-ref fuuljhhuhfojtmmfmskq

# Zastosuj migrację
supabase db push
```

## Co zostanie utworzone

### Nowe tabele:
- ✅ `periodic_inspections` - Przeglądy okresowe
- ✅ `maintenance_repairs` - Serwis i naprawy
- ✅ `vehicle_alerts` - Alerty

### Rozszerzenia istniejących tabel:
- ✅ `vehicles` - nowe statusy (9 wartości)
- ✅ `insurance_policies` - 3 nowe kolumny

### Funkcje:
- ✅ `generate_vehicle_alerts()` - Generowanie alertów
- ✅ `update_vehicle_status_from_alerts()` - Aktualizacja statusów
- ✅ `manage_current_inspection()` - Zarządzanie aktualnością przeglądów
- ✅ `auto_block_high_severity_repairs()` - Auto-blokowanie napraw

### Triggery:
- ✅ `trigger_manage_current_inspection` - Na periodic_inspections
- ✅ `trigger_auto_block_repairs` - Na maintenance_repairs

## Po zastosowaniu migracji

Uruchom funkcje testowo:

```sql
-- Wygeneruj alerty (na razie będzie puste bo nie ma danych)
SELECT generate_vehicle_alerts();

-- Zaktualizuj statusy pojazdów
SELECT update_vehicle_status_from_alerts();

-- Sprawdź czy wszystko działa
SELECT * FROM periodic_inspections LIMIT 1;
SELECT * FROM maintenance_repairs LIMIT 1;
SELECT * FROM vehicle_alerts LIMIT 1;
```

## Dodanie testowych danych

### 1. Dodaj przegląd techniczny:

```sql
INSERT INTO periodic_inspections (
  vehicle_id,
  inspection_type,
  inspection_date,
  valid_until,
  next_inspection_due,
  inspection_station,
  result,
  cost,
  odometer_reading
) VALUES (
  (SELECT id FROM vehicles LIMIT 1), -- Weź pierwszy pojazd
  'technical',
  CURRENT_DATE - INTERVAL '6 months',
  CURRENT_DATE + INTERVAL '6 months',
  CURRENT_DATE + INTERVAL '5 months',
  'Stacja Kontroli Pojazdów XYZ',
  'passed',
  150.00,
  150000
);
```

### 2. Dodaj ubezpieczenie OC:

```sql
INSERT INTO insurance_policies (
  vehicle_id,
  type,
  insurance_company,
  policy_number,
  start_date,
  end_date,
  premium_amount,
  is_mandatory,
  blocks_usage
) VALUES (
  (SELECT id FROM vehicles LIMIT 1),
  'oc',
  'PZU',
  'OC/2025/001',
  CURRENT_DATE - INTERVAL '6 months',
  CURRENT_DATE + INTERVAL '6 months',
  1200.00,
  true,
  true
);
```

### 3. Dodaj naprawę (wysokiej wagi - zablokuje pojazd):

```sql
INSERT INTO maintenance_repairs (
  vehicle_id,
  repair_type,
  severity,
  title,
  description,
  odometer_reading,
  status,
  reported_date
) VALUES (
  (SELECT id FROM vehicles LIMIT 1),
  'repair',
  'high',
  'Wymiana silnika',
  'Poważna usterka silnika wymagająca wymiany',
  150000,
  'in_progress',
  CURRENT_DATE
);
```

### 4. Wygeneruj alerty:

```sql
SELECT generate_vehicle_alerts();
SELECT update_vehicle_status_from_alerts();

-- Sprawdź alerty
SELECT * FROM vehicle_alerts WHERE is_active = true;
```

## Weryfikacja

Po zastosowaniu migracji i dodaniu testowych danych:

```sql
-- 1. Sprawdź statusy pojazdów
SELECT name, status FROM vehicles;

-- 2. Sprawdź przeglądy
SELECT
  v.name,
  pi.inspection_type,
  pi.valid_until,
  pi.is_current
FROM periodic_inspections pi
JOIN vehicles v ON v.id = pi.vehicle_id;

-- 3. Sprawdź ubezpieczenia
SELECT
  v.name,
  ip.type,
  ip.end_date,
  ip.is_mandatory,
  ip.blocks_usage
FROM insurance_policies ip
JOIN vehicles v ON v.id = ip.vehicle_id;

-- 4. Sprawdź naprawy
SELECT
  v.name,
  mr.title,
  mr.severity,
  mr.status,
  mr.blocks_availability
FROM maintenance_repairs mr
JOIN vehicles v ON v.id = mr.vehicle_id;

-- 5. Sprawdź alerty
SELECT
  v.name,
  va.alert_type,
  va.priority,
  va.title,
  va.is_blocking
FROM vehicle_alerts va
JOIN vehicles v ON v.id = va.vehicle_id
WHERE va.is_active = true;
```

## Rozwiązywanie problemów

### Problem: Constraint violation na vehicles.status
**Rozwiązanie:** Niektóre pojazdy mogą mieć status 'active'. Migracja automatycznie zmienia je na 'available'.

### Problem: Funkcje nie działają
**Rozwiązanie:** Sprawdź czy użytkownik bazy ma uprawnienia SECURITY DEFINER.

### Problem: Brak alertów po uruchomieniu generate_vehicle_alerts()
**Rozwiązanie:** To normalne jeśli nie masz jeszcze danych w nowych tabelach. Dodaj testowe dane jak wyżej.

## Następne kroki

Po pomyślnym zastosowaniu migracji:
1. ✅ Odśwież aplikację
2. ✅ Przejdź do /crm/fleet/[id]
3. ✅ Zobaczysz nową zakładkę "Ubezpieczenia/Przeglądy"
4. ✅ Dodaj dane przez UI

## Kontakt

W razie problemów sprawdź:
- Logi w Supabase Dashboard > Logs
- File: `FLEET_SYSTEM_REORGANIZATION.md` - pełna dokumentacja systemu
