# Analiza Systemu Konfliktów Sprzętowych

## 📋 Obecna Implementacja

### 1. Wyłapywanie Konfliktów

#### Frontend (Wizard)
**Hook:** `useOfferWizzardConflicts.ts`
- Wywołuje RPC `check_offer_cart_equipment_conflicts_v2`
- Sprawdza konflikty dla produktów w koszyku (przed zapisem oferty)
- Działa w czasie rzeczywistym podczas dodawania produktów

#### Backend (RPC Function)
**Funkcja:** `check_offer_cart_equipment_conflicts_v2(p_event_id, p_items, p_substitutions)`

**Logika:**
1. Pobiera daty eventu (start_date, end_date)
2. Rozwijaje produkty na sprzęt:
   - Pojedyncze elementy z `offer_product_equipment`
   - Kity na elementy z `equipment_kit_items`
3. Agreguje zapotrzebowanie (sumuje ilości)
4. Sprawdza dostępność dla każdego elementu:
   ```sql
   total_qty = liczba jednostek w magazynie (equipment_units)
   reserved_qty = suma zarezerwowanego sprzętu w nakładających się eventach
   available_qty = total_qty - reserved_qty
   ```
5. Wykrywa konflikty gdy: `available_qty < required_qty`
6. Znajduje alternatywy z tej samej kategorii magazynowej

**Zwraca strukturę:**
```typescript
{
  item_type: 'item' | 'kit',
  item_id: uuid,
  item_name: string,
  required_qty: number,
  total_qty: number,
  reserved_qty: number,
  available_qty: number,
  shortage_qty: number,  // required - available
  conflict_until: timestamp,
  conflicts: [], // szczegóły nakładających się rezerwacji
  alternatives: [] // dostępne zamienniki
}
```

---

### 2. Wyświetlanie Konfliktów

**Komponent:** `EquipmentConflictsModal.tsx`

**Wyświetla:**
- Listę sprzętu z brakami
- Wymagane vs dostępne ilości
- Szczegóły nakładających się eventów
- Listę alternatyw z tej samej kategorii magazynowej

**Opcje użytkownika:**
1. **"Zastosuj"** - wybiera alternatywę (tworzy substytucję)
2. **"Dodaj mimo to"** - ignoruje konflikt i tworzy ofertę
3. **"Zamknij"** - wraca do edycji produktów

**Komponent:** `EquipmentConflictsSummary.tsx`
- Podsumowanie konfliktów rozwiązanych (✅) i nierozwiązanych (❌)
- Pokazuje które elementy zostały zamienione

---

### 3. Rozwiązywanie Konfliktów

#### Substytucje (Zamiany)
**Tabela:** `offer_equipment_substitutions`
```sql
- offer_id (uuid)
- from_item_type ('item' | 'kit')
- from_item_id (uuid) - oryginalny sprzęt
- to_item_type ('item' | 'kit')
- to_item_id (uuid) - zamiennik
- qty (integer) - ilość zamiany
```

**Proces:**
1. Użytkownik wybiera alternatywę w modalu
2. Klik "Zastosuj" zapisuje substytucję do stanu `equipmentSubstitutions`
3. Ponownie sprawdza konflikty z uwzględnieniem substytucji
4. Przy zapisie oferty, substytucje są zapisywane do `offer_equipment_substitutions`

---

### 4. Synchronizacja ze Sprzętem Eventu

#### Aktualny Flow (PROBLEM!)

**Trigger (WYŁĄCZONY!):** `trigger_auto_assign_equipment_from_offer_product`
- Był wyłączony w `20260104142856_disable_old_auto_assign_trigger.sql`
- Powodował dublowanie sprzętu

**Aktualny System:** `sync_offer_equipment_to_event`
- Wywoływany przez trigger `trg_sync_offer_equipment_items`
- **DZIAŁA NATYCHMIAST** po dodaniu `offer_items`
- Używa funkcji `get_offer_equipment_final(offer_id)` która:
  - Agreguje sprzęt z wszystkich produktów w ofercie
  - Uwzględnia substytucje
  - **POMIJA sprzęt z nierozwiązanymi konfliktami** (qty = 0)
- Synchronizuje do `event_equipment` z statusem `'planned'`

**KLUCZOWY PROBLEM:**
```sql
-- Sprzęt jest NATYCHMIAST dodawany do eventu po utworzeniu oferty
-- Nie ma mechanizmu blokowania na podstawie statusu oferty!
```

---

### 5. Status Oferty i Rezerwacje

#### Statusy Oferty
```typescript
type offer_status =
  | 'draft'           // szkic
  | 'sent'            // wysłana
  | 'accepted'        // zaakceptowana
  | 'rejected'        // odrzucona
  | 'expired'         // wygasła
```

**Obecny Flow:**
1. Oferta jest tworzona ze statusem `'draft'`
2. Sprzęt jest **NATYCHMIAST** synchronizowany do `event_equipment`
3. Status nie wpływa na rezerwację!

#### Flaga Braków Sprzętowych
**Pole:** `events.has_equipment_shortage`
- Ustawiane na `true` gdy oferta ma nierozwiązane konflikty
- Używane do wyświetlania ostrzeżeń w UI
- **NIE blokuje** tworzenia oferty ani statusów eventu

---

## ⚠️ Zidentyfikowane Problemy

### Problem 1: Zbyt Wczesna Rezerwacja
**Obecne zachowanie:**
- Sprzęt jest rezerwowany natychmiast po utworzeniu oferty (`draft`)
- Klient może otrzymać 3 oferty → sprzęt zablokowany z 3 eventów
- Tylko 1 oferta zostanie zaakceptowana, ale wszystkie 3 rezerwują sprzęt

**Powinno być:**
- Oferta `draft` = NIE rezerwuje sprzętu
- Oferta `accepted` = wstępna rezerwacja
- Po podpisaniu umowy = pełna rezerwacja

### Problem 2: Brak Mechanizmu "Zablokuj Sprzęt"
**Brak flow:**
- Zmiana statusu oferty na `accepted` nie uruchamia specjalnej logiki
- Nie ma modalu z listą sprzętu do zarezerwowania
- Nie ma akcji "Zablokuj sprzęt"

### Problem 3: Konflikty Blokują Tworzenie Oferty
**Obecne zachowanie:**
- Modal z konfliktami jest "blokujący"
- Użytkownik MUSI wybrać alternatywę lub "Dodaj mimo to"

**Powinno być:**
- Oferta powinna być tworzona z tablicą konfliktów
- Konflikty powinny być widoczne jako osobna zakładka
- Elastyczne rozwiązywanie w trakcie życia oferty

### Problem 4: Brak Dynamicznego Odświeżania
**Obecne zachowanie:**
- Konflikty są sprawdzane tylko przy tworzeniu oferty
- Jeśli inny pracownik odblokuje sprzęt, nie ma automatycznego odświeżenia

### Problem 5: Brak Wsparcia dla Rentalu Zewnętrznego
**Brak funkcjonalności:**
- Nie ma flagi "Rental zewnętrzny"
- Nie ma blokady statusu "ready_for_execution" gdy są braki
- Nie ma żółtego trójkąta w liście eventów

---

## 🎯 Wymagana Architektura (Twoja Wizja)

### 1. Elastyczne Tworzenie Oferty
```
✅ Oferta tworzona BEZ blokowania przez konflikty
✅ Tablica konfliktów zapisana w osobnej tabeli
✅ Konflikty widoczne w zakładce "Konflikty"
✅ Możliwość rozwiązywania w dowolnym momencie
```

### 2. Rezerwacja Bazująca na Statusie
```
Status 'draft' → NIE rezerwuje sprzętu
Status 'sent' → NIE rezerwuje sprzętu

Akcja: "Zablokuj sprzęt" (przy zmianie na 'accepted')
  ↓
  Modal z listą sprzętu z oferty
  ↓
  Użytkownik widzi co zostanie zarezerwowane
  ↓
  Potwierdzenie → status 'accepted' + wstępna rezerwacja
  ↓
  Sprzęt zapisany w event_equipment z status='reserved_pending'

Po podpisaniu umowy:
  status='reserved_confirmed'
```

### 3. System Konfliktów
**Nowa tabela:** `offer_equipment_conflicts`
```sql
CREATE TABLE offer_equipment_conflicts (
  id uuid PRIMARY KEY,
  offer_id uuid REFERENCES offers(id),
  equipment_item_id uuid REFERENCES equipment_items(id),
  equipment_kit_id uuid REFERENCES equipment_kits(id),
  required_qty integer,
  available_qty integer,
  shortage_qty integer,
  status text, -- 'unresolved', 'substituted', 'external_rental'
  resolved_at timestamptz,
  resolved_by uuid REFERENCES employees(user_id),
  notes text
);
```

### 4. Rental Zewnętrzny
```sql
-- Dodaj pole do offer_equipment_conflicts
ALTER TABLE offer_equipment_conflicts
ADD COLUMN use_external_rental boolean DEFAULT false;

-- Dodaj flagę do events
ALTER TABLE events
ADD COLUMN pending_external_rental boolean DEFAULT false;
```

**Flow:**
1. Użytkownik widzi konflikt w zakładce "Konflikty"
2. Zaznacza "Rental zewnętrzny" dla brakującego sprzętu
3. Event otrzymuje flagę `pending_external_rental = true`
4. W liście eventów pojawia się żółty ⚠️
5. Status NIE może być zmieniony na `ready_for_execution` dopóki:
   - Wszystkie konflikty nie zostaną rozwiązane LUB
   - Rental zewnętrzny nie zostanie potwierdzony

### 5. Dynamiczne Odświeżanie
```typescript
// Hook w zakładce Konflikty
useRealtimeConflictUpdates(offerId) {
  // Nasłuchuje na zmiany w:
  // - equipment_units
  // - event_equipment (innych eventów)
  // - offer_equipment_substitutions

  // Automatycznie przelicza konflikty
  // Aktualizuje UI
}
```

---

## 📝 Proponowana Implementacja

### Etap 1: Struktura Danych
1. Utworzyć tabelę `offer_equipment_conflicts`
2. Dodać pole `pending_external_rental` do `events`
3. Dodać statusy rezerwacji do `event_equipment`

### Etap 2: Zmienić Flow Synchronizacji
1. WYŁĄCZYĆ automatyczną synchronizację przy tworzeniu oferty
2. Synchronizacja TYLKO przy zmianie statusu na `accepted`
3. Dodać modal "Zablokuj sprzęt" z listą

### Etap 3: System Konfliktów
1. Zapisywać konflikty do tabeli przy tworzeniu oferty
2. Zakładka "Konflikty" w ofercie
3. Opcje: Substytucja / Rental zewnętrzny
4. Realtime updates

### Etap 4: Walidacja Statusów
1. Blokada `ready_for_execution` gdy `pending_external_rental = true`
2. Żółty ⚠️ w liście eventów
3. Status event bazuje na statusach ofert

---

## 🔄 Migracja

**Krok 1:** Przeanalizować istniejące oferty
- Które mają `has_equipment_shortage = true`
- Które mają substytucje
- Zmigrować do nowej struktury

**Krok 2:** Stopniowe wprowadzanie
- Najpierw dodać nowe tabele i pola
- Pozostawić stary system działający
- Migrować oferty krok po kroku
- Wyłączyć stary system

---

Czy chcesz żebym implementował tę nową architekturę zgodnie z Twoją wizją?
