# System Alertów Ubezpieczeń V3 - Instrukcja

## 🎯 Jak działa nowy system

### Główne założenia:

1. **Alert per TYP** - każdy typ ubezpieczenia (OC, AC, NNW) ma swój osobny alert
2. **21 dni przed końcem** - alert pojawia się dokładnie 21 dni przed wygaśnięciem
3. **Automatyczne czyszczenie** - dodanie nowego ubezpieczenia usuwa alert starego

## 📋 Scenariusze działania

### Scenariusz 1: OC kończy się za 10 dni, dodajesz nowe OC

```
PRZED:
- OC wygasa: 2025-10-31
- Alert: "OC - wygasa za 10 dni"

DODAJESZ:
- Nowe OC: 2025-11-01 do 2026-10-31

PO:
- Trigger usuwa stary alert OC
- Trigger sprawdza najnowsze OC: 2026-10-31
- Trigger sprawdza: czy wygasa w ciągu 21 dni? NIE
- Alert znika ✓
```

### Scenariusz 2: Masz OC i AC, oba wygasają

```
PRZED:
- OC wygasa: 2025-10-25 (za 4 dni)
- AC wygasa: 2025-11-15 (za 25 dni)
- Alerty: BRAK (AC > 21 dni, OC < 21 dni ale dopiero za 17 dni alert się pojawi)

ZA 17 DNI (2025-10-08):
- Alert pojawia się: "OC - wygasa za 17 dni"

ZA 21 DNI (2025-10-25 - 21 = 2025-10-04):
- Dodatkowy alert: "AC - wygasa za 21 dni"

EFEKT:
- Możesz mieć 2 alerty jednocześnie (OC i AC)
- Każdy typ osobno ✓
```

### Scenariusz 3: Dodajesz ubezpieczenie wstecz (historyczne)

```
OBECNE:
- OC aktywne: 2025-01-01 do 2025-12-31 (brak alertu, wygasa za 71 dni)

DODAJESZ HISTORYCZNE:
- OC: 2024-01-01 do 2024-12-31 (przeszłość)

TRIGGER:
- Usuwa alerty OC
- Znajduje najnowsze AKTYWNE OC wg end_date: 2025-12-31
- Sprawdza: czy wygasa w ciągu 21 dni? NIE
- Brak alertu ✓ (poprawnie)
```

### Scenariusz 4: Usuwasz ubezpieczenie

```
PRZED:
- OC: 2025-01-01 do 2025-10-25 (wygasa za 4 dni)
- Alert: "OC - wygasa za 4 dni"

USUWASZ OC:
- Trigger DELETE wykonuje się
- Usuwa alert dla tego typu (OC)
- Brak innych OC
- Alert znika ✓
```

## 🔧 Zastosowanie

### 1. Zastosuj główny trigger (FIX_ALERTS_AFTER_INSPECTION_V2.sql):

```sql
-- W Supabase Dashboard → SQL Editor
-- Skopiuj i uruchom całą zawartość pliku
```

### 2. Wyczyść stare alerty i przelicz (FIX_INSURANCE_ALERTS_V3_CLEAN.sql):

```sql
-- To opcjonalne - jeśli masz już polisy w bazie
-- Czyści wszystkie stare alerty i tworzy nowe poprawnie
```

### 3. Testowanie:

```sql
-- Sprawdź czy są duplikaty (powinno być 0 wierszy)
SELECT
  vehicle_id,
  LEFT(message, 10) as insurance_type,
  COUNT(*) as count
FROM vehicle_alerts
WHERE alert_type = 'insurance'
GROUP BY vehicle_id, LEFT(message, 10)
HAVING COUNT(*) > 1;
```

## 🎨 Priorytety alertów

```
days_until_expiry < 0   → CRITICAL (czerwony)  - przeterminowane!
days_until_expiry <= 7  → HIGH (pomarańczowy)  - kończy się w tym tygodniu
days_until_expiry <= 14 → MEDIUM (żółty)       - kończy się za 2 tygodnie
days_until_expiry <= 21 → LOW (niebieski)      - kończy się za 3 tygodnie
days_until_expiry > 21  → BRAK ALERTU
```

## ✨ Co się zmieniło od V2?

### V2 (stary):

- ❌ Jeden alert dla całego pojazdu
- ❌ Szukał "najnowszej" polisy globalnie
- ❌ 60 dni przed końcem
- ❌ Nie działało przy dodawaniu nowego OC

### V3 (nowy):

- ✅ Alert per TYP ubezpieczenia (OC osobno, AC osobno)
- ✅ Szuka najnowszej polisy TEGO TYPU
- ✅ 21 dni przed końcem (jak chciałeś)
- ✅ Dodanie nowego OC usuwa alert starego OC
- ✅ Trigger dla INSERT, UPDATE i DELETE

## 🚀 Realtime

Alerty automatycznie pojawiają się i znikają w czasie rzeczywistym dzięki:

```typescript
// W kodzie frontendu już jest subscription:
.on('postgres_changes', {
  event: '*',
  schema: 'public',
  table: 'insurance_policies',
  filter: `vehicle_id=eq.${vehicleId}`,
}, () => {
  fetchVehicleData(); // Odświeża widok
})
```

## 📝 Notatki

- System automatycznie czyszcza alerty przy każdej operacji (INSERT/UPDATE/DELETE)
- Możesz mieć kilka alertów jednocześnie dla różnych typów (OC, AC, NNW)
- Alert usuwa się automatycznie po dodaniu nowego ubezpieczenia tego samego typu
- Nie musisz nic robić ręcznie - wszystko działa automatycznie
