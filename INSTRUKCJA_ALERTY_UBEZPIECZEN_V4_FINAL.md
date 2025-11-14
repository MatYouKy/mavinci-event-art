# System Alertów Ubezpieczeń V4 FINAL - Ciągłość Ochrony

## 🎯 Jak działa nowy system

### Główne założenia:

1. **Alert per TYP** - każdy typ ubezpieczenia (OC, AC, NNW) ma swój osobny alert
2. **21 dni przed końcem** - alert pojawia się dokładnie 21 dni przed wygaśnięciem
3. **Sprawdzanie ciągłości** - jeśli jest nowa polisa która PRZEJMUJE ochronę, BRAK alertu
4. **Inteligentna logika** - system rozpoznaje czy jest luka w ochronie

## 🔍 Kluczowa zmiana V4:

### Problem który rozwiązaliśmy:

```
Masz:
- Stare OC: 22.10.2025 → 23.10.2025 (wygasa za 1 dzień)
- Nowe OC: 23.10.2025 → 23.10.2026 (zaczyna się tego samego dnia)

V3 pokazywał: ❌ Alert "OC - wygasa za 1 dzień"
V4 pokazuje: ✅ BRAK ALERTU (jest ciągłość ochrony!)
```

### Jak to działa:

1. System znajduje polisę która wygasa (stare OC: 23.10.2025)
2. Sprawdza: czy jest polisa która **przejmuje ochronę**?
   - Szuka polisy która zaczyna się ≤ koniec starej + 1 dzień
   - Znajduje nowe OC (start: 23.10.2025) ✓
3. Jest pokrycie → NIE TWORZY alertu
4. Brak pokrycia → TWORZY alert

## 📋 Scenariusze działania

### Scenariusz 1: Ciągła ochrona (Twój przypadek)

```
Stare OC: 22.10.2025 → 23.10.2025
Nowe OC:  23.10.2025 → 23.10.2026

TRIGGER:
├─ Usuwa alerty OC
├─ Znajduje wygasającą: 23.10.2025 (za 1 dzień)
├─ Szuka przejmującej: start ≤ 24.10.2025
├─ Znajduje nową OC ✓
└─ Jest pokrycie → BRAK ALERTU ✓

EFEKT: ✅ Alert znika automatycznie
```

### Scenariusz 2: Luka w ochronie (1 dzień przerwy)

```
Stare OC: 22.10.2025 → 23.10.2025
Nowe OC:  25.10.2025 → 25.10.2026 (zaczyna się 2 dni później!)

TRIGGER:
├─ Usuwa alerty OC
├─ Znajduje wygasającą: 23.10.2025 (za 1 dzień)
├─ Szuka przejmującej: start ≤ 24.10.2025
├─ NIE znajduje ✗
└─ Brak pokrycia → TWORZY ALERT ✓

EFEKT: 🔴 Alert "OC - wygasa za 1 dzień" (POPRAWNIE - jest luka!)
```

### Scenariusz 3: Nakładające się polisy

```
Stare OC: 22.10.2025 → 23.10.2025
Nowe OC:  20.10.2025 → 20.10.2026 (zaczęło się wcześniej!)

TRIGGER:
├─ Usuwa alerty OC
├─ Znajduje wygasającą: 20.10.2026 (najwcześniej wygasająca to NOWA)
├─ Sprawdza: wygasa za 364 dni
├─ > 21 dni → BRAK ALERTU ✓

EFEKT: ✅ Brak alertu (poprawnie - pokrycie do 2026)
```

### Scenariusz 4: Tylko stara polisa, brak nowej

```
Stare OC: 22.10.2025 → 23.10.2025

TRIGGER:
├─ Usuwa alerty OC
├─ Znajduje wygasającą: 23.10.2025 (za 1 dzień)
├─ Szuka przejmującej: NIE MA
└─ Brak pokrycia → TWORZY ALERT ✓

EFEKT: 🔴 Alert "OC - wygasa za 1 dzień" (POPRAWNIE!)
```

### Scenariusz 5: Usunięcie nowej polisy

```
PRZED:
- Stare OC: kończy się jutro
- Nowe OC: od jutra na rok
- Brak alertu ✓

USUWASZ NOWE OC:

TRIGGER DELETE:
├─ Usuwa alerty OC
├─ Znajduje wygasającą: stare OC (jutro!)
├─ Szuka przejmującej: NIE MA (usunąłeś)
└─ TWORZY ALERT ✓

EFEKT: 🔴 Alert pojawia się natychmiast!
```

## 🔧 Zastosowanie

### 1. Zastosuj trigger (FIX_ALERTS_AFTER_INSPECTION_V2.sql):

```sql
-- W Supabase Dashboard → SQL Editor
-- Skopiuj i uruchom całą zawartość pliku
-- Zawiera V4 z logiką ciągłości ochrony
```

### 2. Wyczyść stare alerty (FIX_INSURANCE_ALERTS_V3_CLEAN.sql):

```sql
-- Opcjonalne - czyści stare alerty i przelicza nowe
-- Po zastosowaniu triggera możesz uruchomić UPDATE:

UPDATE insurance_policies
SET updated_at = now()
WHERE status IN ('active', 'expired');

-- To wywoła trigger dla wszystkich polis i przelicz alerty
```

## 🎨 Priorytety alertów

```
days < 0    → 🔴 CRITICAL - "brak ochrony od X dni"
days ≤ 7    → 🟠 HIGH     - "wygasa za X dni"
days ≤ 14   → 🟡 MEDIUM   - "wygasa za X dni"
days ≤ 21   → 🔵 LOW      - "wygasa za X dni"
days > 21   → ⚪ BRAK ALERTU
```

**WAŻNE:** Alert NIE POJAWI SIĘ jeśli jest ciągłość ochrony!

## ✨ Różnice między wersjami

### V2:

- ❌ Szukał "najnowszej" polisy globalnie
- ❌ Nie sprawdzał ciągłości ochrony
- ❌ 60 dni przed końcem

### V3:

- ✅ Alert per TYP (OC/AC/NNW osobno)
- ✅ 21 dni przed końcem
- ❌ NIE sprawdzał ciągłości (pokazywał alert mimo nowej polisy)

### V4 (FINAL):

- ✅ Alert per TYP (OC/AC/NNW osobno)
- ✅ 21 dni przed końcem
- ✅ **Sprawdza ciągłość ochrony** ← NOWE!
- ✅ Alert tylko gdy BRAK kolejnej polisy
- ✅ Rozpoznaje nakładające się polisy
- ✅ Inteligentne wykrywanie luk w ochronie

## 🚀 Logika szczegółowa

```sql
-- Krok 1: Znajdź polisę która wygasa (najwcześniej)
ORDER BY end_date ASC

-- Krok 2: Sprawdź czy jest "następna" która przejmuje
WHERE start_date <= expiring.end_date + 1 day
  AND end_date > expiring.end_date

-- Krok 3: Jeśli jest → BRAK alertu
-- Krok 4: Jeśli nie ma → UTWÓRZ alert
```

### Tolerancja 1 dzień:

System akceptuje 1 dzień przerwy jako "ciągłość" - jeśli nowa polisa zaczyna się dzień po końcu starej, to jest OK.

Możesz zmienić na `+ INTERVAL '0 day'` jeśli chcesz ZERO tolerancji.

## 📝 Testowanie

```sql
-- Po zastosowaniu triggera sprawdź:

-- 1. Czy są duplikaty? (powinno być 0)
SELECT vehicle_id, LEFT(message, 10), COUNT(*)
FROM vehicle_alerts
WHERE alert_type = 'insurance'
GROUP BY vehicle_id, LEFT(message, 10)
HAVING COUNT(*) > 1;

-- 2. Które pojazdy mają alerty?
SELECT v.registration_number, va.message, va.priority
FROM vehicle_alerts va
JOIN vehicles v ON v.id = va.vehicle_id
WHERE va.alert_type = 'insurance'
ORDER BY v.registration_number;

-- 3. Sprawdź ciągłość dla konkretnego pojazdu:
SELECT
  type,
  policy_number,
  start_date,
  end_date,
  status,
  LEAD(start_date) OVER (PARTITION BY type ORDER BY end_date) as next_start,
  end_date - LEAD(start_date) OVER (PARTITION BY type ORDER BY end_date) as gap_days
FROM insurance_policies
WHERE vehicle_id = 'twoje-vehicle-id'
ORDER BY type, end_date;
```

## 🎯 Twój przypadek - rozwiązany!

```
PRZED V4:
- Stare OC: 22.10.2025 → 23.10.2025 (za 1 dzień)
- Nowe OC: 23.10.2025 → 23.10.2026
- Alert: 🔴 "OC - wygasa za 1 dzień"

PO V4:
- Trigger wykrywa ciągłość (23.10 → 23.10)
- BRAK ALERTU ✅
- Pojazd bezpiecznie ubezpieczony!
```

Wszystko działa automatycznie, realtime aktualizuje widok natychmiast!
