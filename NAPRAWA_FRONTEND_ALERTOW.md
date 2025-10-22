# 🔧 NAPRAWA FRONTENDU - Alerty nie znikają na stronie

## 🎯 Problem:

**Zgłoszenie:**
> "Dodałem nową polisę która jest na rok, alert powinien zniknąć ale dalej pokazuje się na /crm/fleet i /crm/fleet/[id]"

**Przyczyna:**
Frontend **NIE korzystał** z tabeli `vehicle_alerts` i triggera! Zamiast tego:
1. `/crm/fleet/page.tsx` - liczył polisy bezpośrednio z `insurance_policies` (60 dni przed końcem)
2. `/crm/fleet/[id]/page.tsx` - filtrował wszystkie aktywne polisy wygasające w ciągu 60 dni
3. **Ignorował logikę ciągłości ochrony z triggera!**

## ✅ Rozwiązanie:

### 1. `/crm/fleet/page.tsx` (Lista pojazdów)

**PRZED:**
```typescript
const { count: expiringInsurance } = await supabase
  .from('insurance_policies')
  .select('*', { count: 'exact', head: true })
  .eq('vehicle_id', vehicle.id)
  .eq('status', 'active')
  .gte('end_date', new Date().toISOString())
  .lte('end_date', new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString());
// ✗ Liczy WSZYSTKIE polisy wygasające w ciągu 60 dni (ignoruje ciągłość!)
```

**PO:**
```typescript
// Pobierz alerty ubezpieczeniowe z vehicle_alerts (trigger już obliczył czy są potrzebne)
const { count: expiringInsurance } = await supabase
  .from('vehicle_alerts')
  .select('*', { count: 'exact', head: true })
  .eq('vehicle_id', vehicle.id)
  .eq('alert_type', 'insurance')
  .eq('is_active', true);
// ✓ Używa alertów z triggera (trigger sprawdził ciągłość ochrony!)
```

**Dodano Realtime:**
```typescript
const channel = supabase
  .channel('fleet_changes')
  .on('postgres_changes', { table: 'event_vehicles' }, () => fetchVehicles())
  .on('postgres_changes', { table: 'vehicle_alerts' }, () => fetchVehicles())
  .on('postgres_changes', { table: 'insurance_policies' }, () => fetchVehicles())
  .subscribe();
```

### 2. `/crm/fleet/[id]/page.tsx` (Szczegóły pojazdu)

**PRZED:**
```typescript
const expiringInsurance = insurancePolicies.filter(
  (p) => p.status === 'active' && getDaysUntil(p.end_date)! > 0 && getDaysUntil(p.end_date)! <= 60
);
// ✗ Filtruje WSZYSTKIE aktywne polisy (ignoruje ciągłość!)
```

**PO:**
```typescript
// Użyj alertów z vehicle_alerts zamiast samodzielnie filtrować
// Trigger już obliczył czy alert jest potrzebny (sprawdził ciągłość ochrony)
const expiringInsurance = vehicleAlerts.map(alert => {
  // Znajdź polisę powiązaną z alertem
  const policy = insurancePolicies.find(p => p.id === alert.related_id);
  return policy || null;
}).filter(Boolean) as InsurancePolicy[];
// ✓ Używa alertów z triggera!
```

**Dodano fetch alertów:**
```typescript
const [vehicleRes, ..., insuranceRes, alertsRes, ...] = await Promise.all([
  ...
  supabase
    .from('insurance_policies')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('end_date', { ascending: false }),
  // Pobierz alerty z vehicle_alerts (trigger oblicza ciągłość)
  supabase
    .from('vehicle_alerts')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .eq('alert_type', 'insurance')
    .eq('is_active', true),
  ...
]);

setInsurancePolicies(insuranceRes.data || []);
setVehicleAlerts(alertsRes.data || []);
```

**Dodano Realtime:**
```typescript
channel
  .on('postgres_changes', { table: 'maintenance_records' }, () => fetchVehicleData())
  .on('postgres_changes', { table: 'insurance_policies' }, () => fetchVehicleData())
  .on('postgres_changes', { table: 'vehicle_alerts' }, () => fetchVehicleData())
  .subscribe();
```

## 🔄 Jak to działa teraz:

### Scenariusz 1: Dodanie nowej polisy z ciągłością

```
1. Masz: Stare OC (wygasa jutro) → Alert na froncie
2. Dodajesz: Nowe OC (od dziś na rok)
3. Trigger:
   ├─ DELETE alertów OC
   ├─ Sprawdza ciągłość: Jest!
   └─ NIE tworzy alertu ✓
4. Realtime:
   ├─ Subskrypcja na insurance_policies → fetchVehicles()
   ├─ Subskrypcja na vehicle_alerts → fetchVehicles()
   └─ Frontend pobiera alerty: COUNT = 0 ✓
5. Frontend:
   ├─ expiringInsurance = 0
   ├─ Ikona alertu znika ✓
   └─ Komunikat znika ✓

REZULTAT: Alert znika automatycznie po ~1 sekundę! ✨
```

### Scenariusz 2: Dodanie polisy z luką

```
1. Masz: Stare OC (wygasa 23.10.2025) → Alert
2. Dodajesz: Nowe OC (od 25.10.2025) - luka 1 dzień!
3. Trigger:
   ├─ DELETE alertów OC
   ├─ Sprawdza ciągłość: Brak! (luka)
   └─ Tworzy alert ✓
4. Realtime → fetchVehicles()
5. Frontend:
   ├─ expiringInsurance = 1
   ├─ Ikona alertu pozostaje 🔴
   └─ Komunikat: "OC - wygasa za X dni" ✓

REZULTAT: Alert POZOSTAJE (poprawnie - jest luka!) ✓
```

### Scenariusz 3: Usunięcie nowej polisy

```
1. Masz: 2 polisy (stara + nowa z ciągłością) → Brak alertu
2. Usuwasz: Nową polisę
3. Trigger DELETE:
   ├─ DELETE alertów OC
   ├─ Sprawdza: tylko stara polisa, wygasa jutro
   └─ Tworzy alert ✓
4. Realtime → fetchVehicles()
5. Frontend:
   ├─ expiringInsurance = 1
   ├─ Ikona alertu pojawia się 🔴
   └─ Komunikat pojawia się ✓

REZULTAT: Alert pojawia się natychmiast! ✓
```

## 📊 Zmiany w plikach:

### Zmienione pliki:
1. **src/app/crm/fleet/page.tsx**
   - Linia 169-175: Zmiana z `insurance_policies` na `vehicle_alerts`
   - Linia 107-143: Dodano realtime dla `vehicle_alerts` i `insurance_policies`

2. **src/app/crm/fleet/[id]/page.tsx**
   - Linia 143: Dodano state `vehicleAlerts`
   - Linia 253: Dodano fetch alertów z `vehicle_alerts`
   - Linia 297-304: Dodano fetch alertów w Promise.all
   - Linia 398: Dodano `setVehicleAlerts`
   - Linia 526-532: Zmiana logiki `expiringInsurance` - używa alertów
   - Linia 241-252: Dodano realtime dla `vehicle_alerts`

### Nowe zależności:
- Tabela: `vehicle_alerts` (już istnieje)
- Trigger: `manage_insurance_alerts()` (FIX_ALERTS_AFTER_INSPECTION_V2.sql)

## 🎯 Co musisz zrobić:

### 1. Zastosuj trigger SQL (jeśli jeszcze nie):
```
FIX_ALERTS_AFTER_INSPECTION_V2.sql
```
W Supabase Dashboard → SQL Editor → Uruchom

### 2. Zbuduj i wdróż frontend:
```bash
npm run build
```
Już zrobione! ✓

### 3. Wyczyść cache przeglądarki:
- Ctrl+Shift+R (Chrome/Firefox)
- Lub otwórz w trybie incognito

### 4. Test:
1. Otwórz `/crm/fleet`
2. Zobacz pojazd z alertem
3. Dodaj nową polisę z ciągłością
4. **Odczekaj 1-2 sekundy**
5. Alert powinien zniknąć automatycznie! ✓

## 🚀 Korzyści:

✅ **Frontend używa logiki triggera** - jedna logika, brak duplikacji
✅ **Realtime aktualizacja** - alert znika automatycznie po dodaniu polisy
✅ **Ciągłość ochrony** - trigger sprawdza czy jest luka
✅ **Performance** - COUNT z alertów zamiast filtrowania wszystkich polis
✅ **Konsystencja** - frontend zawsze pokazuje to co trigger obliczył

## 🔍 Debugging:

Jeśli alert dalej się pokazuje:

1. **Sprawdź w konsoli DevTools:**
```javascript
// Otwórz Network tab
// Szukaj requestu do: vehicle_alerts?vehicle_id=eq.XXX
// Zobacz odpowiedź: powinno być [] (pusta tablica)
```

2. **Sprawdź w bazie:**
```sql
SELECT * FROM vehicle_alerts
WHERE vehicle_id = 'twoje-vehicle-id'
AND alert_type = 'insurance'
AND is_active = true;
-- Powinno być: 0 wierszy (jeśli jest ciągłość)
```

3. **Wymuś refresh:**
```sql
UPDATE insurance_policies
SET updated_at = now()
WHERE vehicle_id = 'twoje-vehicle-id'
AND type = 'oc';
-- To wywoła trigger i przelicz alerty
```

4. **Sprawdź realtime:**
```javascript
// W konsoli przeglądarki:
supabase.getChannels()
// Powinien być channel 'fleet_changes' z subskrypcją
```

## ✨ Gotowe!

Po wdrożeniu:
- ✅ Alerty znikają automatycznie po dodaniu polisy z ciągłością
- ✅ Alerty pozostają jeśli jest luka w ochronie
- ✅ Realtime aktualizacja (1-2 sekundy)
- ✅ Ikona i komunikat synchronizowane z bazą
- ✅ Jeden system logiki (trigger) dla całej aplikacji

Build zakończony sukcesem, gotowe do wdrożenia! 🎉
