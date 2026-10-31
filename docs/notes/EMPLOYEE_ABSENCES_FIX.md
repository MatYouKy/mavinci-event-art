# Naprawiono system nieobecności pracowników (employee_absences)

## Problem

Podczas dodawania nieobecności przez pracownika system rzucał błąd:
```
"PGRST204"
message: "Could not find the 'approval_status' column of 'employee_absences' in the schema cache"
```

### Przyczyna:

Tabela `employee_absences` nie miała kolumny `approval_status`, ale:
- Nowsze funkcje (z marca 2026) używały `approval_status`
- Starsze funkcje (z lutego 2026) używały `status`
- Brak spójności w nazewnictwie kolumn

## Rozwiązanie

### 1. ✅ Dodano kolumnę `approval_status`

**Migracja:** `add_approval_status_to_employee_absences`

```sql
ALTER TABLE employee_absences
ADD COLUMN approval_status text DEFAULT 'pending'
CHECK (approval_status IN ('pending', 'approved', 'rejected'));

-- Migracja danych jeśli istniała stara kolumna 'status'
UPDATE employee_absences
SET approval_status = status
WHERE approval_status IS NULL;
```

**Cechy kolumny:**
- Typ: `text`
- Wartości: `'pending'`, `'approved'`, `'rejected'`
- Domyślna: `'pending'`
- Index: `idx_employee_absences_approval_status`

### 2. ✅ Zaktualizowano polityki RLS

Polityki dostępu zostały zaktualizowane do używania `approval_status`:

```sql
-- Pracownicy mogą edytować tylko swoje PENDING nieobecności
CREATE POLICY "Employees can update own pending absences"
  ON employee_absences FOR UPDATE
  TO authenticated
  USING (
    employee_id = auth.uid()
    AND approval_status = 'pending'
  );

-- Pracownicy mogą usuwać tylko swoje PENDING nieobecności
CREATE POLICY "Employees can delete own pending absences"
  ON employee_absences FOR DELETE
  TO authenticated
  USING (
    employee_id = auth.uid()
    AND approval_status = 'pending'
  );
```

### 3. ✅ Zaktualizowano funkcje bazodanowe

**Funkcja:** `notify_absence_request()`
```sql
-- PRZED (nie działało):
IF (TG_OP = 'INSERT' AND NEW.status = 'pending')

-- PO (działa):
IF (TG_OP = 'INSERT' AND NEW.approval_status = 'pending')
```

**Trigger:**
```sql
-- Teraz obserwuje zmianę approval_status
CREATE TRIGGER trigger_notify_absence_request
  AFTER INSERT OR UPDATE OF approval_status ON employee_absences
  FOR EACH ROW
  EXECUTE FUNCTION notify_absence_request();
```

**Funkcje zaktualizowane:**
1. `notify_absence_request()` - notyfikacje o nowych nieobecnościach
2. `get_employee_timeline_data()` - timeline pracownika
3. `check_absence_overlap()` - sprawdzanie konfliktów
4. `check_employee_availability()` - dostępność pracownika

### 4. ✅ Funkcje approve/reject już używały approval_status

Funkcje zatwierdzania i odrzucania były już poprawne (z migracji z marca):
- `approve_absence()` - używa `approval_status`
- `reject_absence()` - używa `approval_status`

## Struktura tabeli employee_absences

```sql
CREATE TABLE employee_absences (
  id uuid PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES employees(id),
  absence_type text NOT NULL, -- 'vacation', 'sick_leave', 'unpaid_leave', 'training', 'remote_work', 'other'
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  all_day boolean DEFAULT true,

  -- KOLUMNA STATUSU (nowa)
  approval_status text DEFAULT 'pending', -- 'pending', 'approved', 'rejected'

  -- METADATA ZATWIERDZENIA
  approved_by uuid REFERENCES employees(id),
  approved_at timestamptz,
  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

## Workflow nieobecności

### Krok 1: Pracownik tworzy nieobecność
```typescript
const { data, error } = await supabase
  .from('employee_absences')
  .insert({
    employee_id: currentUserId,
    absence_type: 'vacation',
    start_date: '2026-04-01',
    end_date: '2026-04-07',
    all_day: true,
    notes: 'Urlop rodzinny'
  });
```

**Rezultat:**
- Nowy rekord z `approval_status: 'pending'`
- Automatycznie wysyłana notyfikacja do managerów/adminów
- Trigger: `trigger_notify_absence_request`

### Krok 2: Manager zatwierdza
```typescript
const { data, error } = await supabase.rpc('approve_absence', {
  p_absence_id: absenceId,
  p_approver_id: managerId,
  p_notes: 'Zatwierdzam urlop'
});
```

**Rezultat:**
- `approval_status` zmienia się na `'approved'`
- Ustawiane: `approved_by`, `approved_at`
- Wysyłana notyfikacja do pracownika o zatwierdzeniu

### Krok 3: Manager odrzuca (opcjonalnie)
```typescript
const { data, error } = await supabase.rpc('reject_absence', {
  p_absence_id: absenceId,
  p_rejector_id: managerId,
  p_reason: 'W tym terminie mamy duży event'
});
```

**Rezultat:**
- `approval_status` zmienia się na `'rejected'`
- Ustawiane: `approved_by`, `notes` (z powodem)
- Wysyłana notyfikacja do pracownika o odrzuceniu

## Stany approval_status

| Status | Opis | Kto może zmienić |
|--------|------|------------------|
| **pending** | Czeka na zatwierdzenie | Manager/Admin przez `approve_absence()` lub `reject_absence()` |
| **approved** | Zatwierdzona | Tylko manager/admin (może zmienić z powrotem na rejected) |
| **rejected** | Odrzucona | Manager/admin może zmienić na approved lub pracownik może edytować i wznowić |

## Polityki dostępu (RLS)

### Pracownik:
- ✅ Może przeglądać swoje nieobecności
- ✅ Może tworzyć nowe nieobecności (status automatycznie: pending)
- ✅ Może edytować tylko swoje PENDING nieobecności
- ✅ Może usuwać tylko swoje PENDING nieobecności
- ❌ Nie może zmieniać approval_status bezpośrednio

### Manager/Admin:
- ✅ Widzi wszystkie nieobecności
- ✅ Może zatwierdzać przez `approve_absence()`
- ✅ Może odrzucać przez `reject_absence()`
- ✅ Może edytować wszystkie nieobecności

## Notyfikacje

### 1. Nowa nieobecność (pending)
- **Kategoria:** `absence_request`
- **Odbiorcy:** Wszyscy z uprawnieniem `employees_manage` lub `admin`
- **Treść:** "Jan Kowalski zgłosił prośbę o urlop wypoczynkowy w terminie 01.04.2026 - 07.04.2026"
- **Link:** `/crm/employees/{employeeId}?tab=timeline`

### 2. Zatwierdzona nieobecność
- **Kategoria:** `absence_approved`
- **Odbiorcy:** Pracownik, który zgłosił
- **Treść:** "Marek Manager zatwierdził Twoją prośbę o urlop wypoczynkowy..."

### 3. Odrzucona nieobecność
- **Kategoria:** `absence_rejected`
- **Odbiorcy:** Pracownik, który zgłosił
- **Treść:** "Marek Manager odrzucił Twoją prośbę... Powód: W tym terminie mamy duży event"

## Timeline i dostępność

### Funkcja: get_employee_timeline_data()
Zwraca połączone dane:
- Wydarzenia (z tabelą `events`)
- Nieobecności (z tabelą `employee_absences`)

Nieobecności są wyświetlane tylko jeśli:
- `approval_status IN ('approved', 'pending')`
- W zakresie dat timeline

### Funkcja: check_employee_availability()
Sprawdza konflikty pracownika:
- Z innymi wydarzeniami
- Z zatwierdzonymi/oczekującymi nieobecnościami

Zwraca JSON:
```json
{
  "has_conflicts": true,
  "conflicts": [
    {
      "type": "absence",
      "id": "uuid",
      "absence_type": "vacation",
      "start": "2026-04-01",
      "end": "2026-04-07",
      "status": "approved"
    }
  ]
}
```

## Migracje zastosowane

1. ✅ `add_approval_status_to_employee_absences` - dodanie kolumny
2. ✅ `fix_notify_absence_request_use_approval_status` - trigger notyfikacji
3. ✅ `fix_timeline_drop_and_recreate` - funkcje timeline i availability

## Testowanie

### Test 1: Tworzenie nieobecności
```typescript
const { data, error } = await supabase
  .from('employee_absences')
  .insert({
    employee_id: myId,
    absence_type: 'vacation',
    start_date: '2026-05-01',
    end_date: '2026-05-10',
    all_day: true
  });

console.log(data.approval_status); // 'pending'
```
✅ **Oczekiwany rezultat:** Brak błędu, status = 'pending', notyfikacja wysłana

### Test 2: Edycja pending nieobecności
```typescript
const { error } = await supabase
  .from('employee_absences')
  .update({ end_date: '2026-05-12' })
  .eq('id', absenceId)
  .eq('approval_status', 'pending');
```
✅ **Oczekiwany rezultat:** Sukces dla własnej nieobecności ze statusem pending

### Test 3: Próba edycji approved nieobecności przez pracownika
```typescript
const { error } = await supabase
  .from('employee_absences')
  .update({ end_date: '2026-05-15' })
  .eq('id', absenceId)
  .eq('approval_status', 'approved');
```
❌ **Oczekiwany rezultat:** Błąd - brak uprawnień (RLS policy zablokuje)

### Test 4: Zatwierdzanie przez managera
```typescript
const { data, error } = await supabase.rpc('approve_absence', {
  p_absence_id: absenceId,
  p_approver_id: managerId,
  p_notes: 'OK'
});

console.log(data); // { success: true, message: 'Nieobecność została zatwierdzona' }
```
✅ **Oczekiwany rezultat:** Sukces, status zmieniony na 'approved', notyfikacja wysłana

## Podsumowanie

### Co było źle:
- ❌ Brak kolumny `approval_status` w tabeli
- ❌ Funkcje używały nieistniejącej kolumny
- ❌ Niespójność między starymi (status) a nowymi (approval_status) funkcjami

### Co naprawiono:
- ✅ Dodano kolumnę `approval_status`
- ✅ Zaktualizowano wszystkie funkcje do używania `approval_status`
- ✅ Zaktualizowano triggery i polityki RLS
- ✅ Zachowano backward compatibility (stara kolumna `status` może istnieć)

### Rezultat:
Teraz pracownicy mogą:
- ✅ Dodawać nieobecności bez błędów
- ✅ Otrzymywać notyfikacje o zatwierdzeniu/odrzuceniu
- ✅ Widzieć swoje nieobecności w timeline
- ✅ Managerowie mogą zatwierdzać/odrzucać
