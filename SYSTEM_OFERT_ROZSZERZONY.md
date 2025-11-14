# System Ofert - Katalog Produktów i Kreator PDF

## 📋 Przegląd

Zaawansowany system zarządzania ofertami z:

- **Katalogiem produktów/usług** z cenami, kosztami, wymaganiami
- **Automatyczną kalkulacją** kosztów, marż, VAT
- **Kreatorem ofert** - łączenie produktów w profesjonalne oferty
- **Szablonami PDF** - gotowe layouty do generowania dokumentów

---

## 🗄️ Struktura bazy danych

### 1. **Katalog produktów**

#### `offer_product_categories` - Kategorie produktów

```sql
- id (uuid)
- name (text) - np. "DJ i prowadzenie", "Nagłośnienie"
- description (text)
- icon (text) - nazwa ikony Lucide
- display_order (integer)
- is_active (boolean)
```

#### `offer_products` - Produkty/usługi

```sql
- id (uuid)
- category_id (uuid) → offer_product_categories
- name (text) - np. "DJ Standard"
- description (text)

-- Ceny
- base_price (numeric) - cena bazowa dla klienta
- cost_price (numeric) - koszt własny

-- Transport i logistyka
- transport_cost (numeric)
- logistics_cost (numeric)
- setup_time_hours (numeric) - czas montażu
- teardown_time_hours (numeric) - czas demontażu

-- Jednostka i ilość
- unit (text) - "szt", "komplet", "dzień"
- min_quantity (integer)
- max_quantity (integer)

-- Wymagania
- requires_vehicle (boolean) - czy wymaga pojazdu
- requires_driver (boolean) - czy wymaga kierowcy

-- Metadane
- tags (text[]) - tagi do wyszukiwania
- is_active (boolean)
- display_order (integer)
```

#### `offer_product_equipment` - Wymagany sprzęt

```sql
- id (uuid)
- product_id (uuid) → offer_products
- equipment_item_id (uuid) → equipment_items
- quantity (integer) - ile sztuk
- is_optional (boolean) - czy opcjonalny
- notes (text)
```

#### `offer_product_staff` - Wymagani pracownicy

```sql
- id (uuid)
- product_id (uuid) → offer_products
- role (text) - np. "DJ", "Technik"
- quantity (integer) - ile osób
- hourly_rate (numeric) - stawka godzinowa
- estimated_hours (numeric) - szacowane godziny
- required_skills (text[]) - wymagane umiejętności
- is_optional (boolean)
- notes (text)
```

---

### 2. **Oferty**

#### `offers` - Oferty (rozszerzone)

```sql
-- Istniejące pola
- id (uuid)
- offer_number (text) - numer oferty
- event_id (uuid) → events
- client_id (uuid) → clients
- created_by (uuid) → employees
- status (text) - "draft", "sent", "accepted", "rejected"
- valid_until (timestamptz)
- notes (text)

-- Nowe pola finansowe
- template_id (uuid) → offer_templates
- subtotal (numeric) - suma przed rabatem i VAT
- discount_percent (numeric) - % rabatu
- discount_amount (numeric) - kwota rabatu
- tax_percent (numeric) - % VAT (domyślnie 23)
- tax_amount (numeric) - kwota VAT
- total_amount (numeric) - kwota końcowa
- total_cost (numeric) - suma kosztów
- margin_amount (numeric) - marża w PLN
- margin_percent (numeric) - marża w %
```

#### `offer_items` - Pozycje oferty

```sql
- id (uuid)
- offer_id (uuid) → offers
- product_id (uuid) → offer_products (opcjonalne)

-- Szczegóły
- name (text) - nazwa pozycji
- description (text)
- quantity (integer)
- unit (text)

-- Ceny
- unit_price (numeric) - cena jednostkowa
- unit_cost (numeric) - koszt jednostkowy
- discount_percent (numeric) - rabat na pozycję
- discount_amount (numeric) - kwota rabatu

-- Dodatkowe koszty
- transport_cost (numeric)
- logistics_cost (numeric)

-- Wyliczenia automatyczne (GENERATED)
- subtotal (numeric) - (unit_price * quantity) - discount_amount
- total (numeric) - subtotal + transport_cost + logistics_cost

-- Kolejność wyświetlania
- display_order (integer)
- notes (text)
```

---

### 3. **Szablony PDF**

#### `offer_templates` - Szablony ofert

```sql
- id (uuid)
- name (text) - np. "Szablon standardowy"
- description (text)

-- HTML i CSS
- header_html (text) - nagłówek oferty
- footer_html (text) - stopka
- styles_css (text) - style CSS

-- Ustawienia widoczności
- show_logo (boolean)
- show_company_details (boolean)
- show_client_details (boolean)
- show_terms (boolean)
- show_payment_info (boolean)

-- Treści tekstowe
- terms_text (text) - warunki oferty
- payment_info_text (text) - dane do przelewu
- footer_text (text) - tekst stopki

-- Metadane
- is_default (boolean) - domyślny szablon
- is_active (boolean)
```

---

## ⚙️ Funkcje automatyczne

### 1. **Automatyczna kalkulacja sum**

Funkcja `calculate_offer_totals(offer_uuid)` automatycznie przelicza:

```sql
-- Przy każdej zmianie w offer_items:
1. Subtotal = suma wszystkich pozycji (z transportem i logistyką)
2. Discount = subtotal × discount_percent / 100
3. Tax = (subtotal - discount) × tax_percent / 100
4. Total = subtotal - discount + tax
5. Cost = suma unit_cost × quantity
6. Margin = total - cost
7. Margin % = (margin / total) × 100
```

**Trigger:** Automatycznie uruchamiany przy INSERT/UPDATE/DELETE na `offer_items`

### 2. **Wyliczenia na poziomie pozycji**

Kolumny `subtotal` i `total` w `offer_items` są typu **GENERATED ALWAYS AS**:

```sql
subtotal = (unit_price × quantity) - discount_amount
total = subtotal + transport_cost + logistics_cost
```

---

## 📦 Przykładowe dane

### Kategorie:

1. **DJ i prowadzenie** - Usługi DJ i konferansjerów
2. **Nagłośnienie** - Systemy audio
3. **Oświetlenie** - Reflektory, efekty świetlne
4. **Multimedia** - Projektory, ekrany LED
5. **Dekoracje** - Dekoracje świetlne

### Przykładowe produkty:

#### DJ Standard

- Cena: 2500 zł
- Koszt: 800 zł
- Transport: 200 zł
- Logistyka: 100 zł
- Czas montażu: 1.5h
- Wymaga pojazdu i kierowcy

#### Nagłośnienie Standard

- Cena: 2500 zł
- Koszt: 1000 zł
- Transport: 350 zł
- Dla: do 200 osób
- Czas montażu: 3h

---

## 🎯 Workflow tworzenia oferty

### Krok 1: Utwórz ofertę

```typescript
const { data: offer } = await supabase
  .from('offers')
  .insert({
    client_id: 'xxx',
    event_id: 'yyy',
    created_by: auth.uid(),
    status: 'draft',
    valid_until: '2025-12-31',
    tax_percent: 23,
    discount_percent: 0,
  })
  .select()
  .single();
```

### Krok 2: Dodaj produkty z katalogu

```typescript
// Pobierz produkt z katalogu
const { data: product } = await supabase
  .from('offer_products')
  .select('*')
  .eq('id', productId)
  .single();

// Dodaj jako pozycję oferty
const { data: item } = await supabase.from('offer_items').insert({
  offer_id: offer.id,
  product_id: product.id,
  name: product.name,
  description: product.description,
  quantity: 1,
  unit_price: product.base_price,
  unit_cost: product.cost_price,
  transport_cost: product.transport_cost,
  logistics_cost: product.logistics_cost,
});

// Sumy przeliczą się automatycznie!
```

### Krok 3: Zastosuj rabat

```typescript
// Rabat na całą ofertę
await supabase.from('offers').update({ discount_percent: 10 }).eq('id', offer.id);

// Lub na pojedynczą pozycję
await supabase.from('offer_items').update({ discount_amount: 200 }).eq('id', itemId);
```

### Krok 4: Generuj PDF

```typescript
// Wybierz szablon
const { data: template } = await supabase
  .from('offer_templates')
  .select('*')
  .eq('is_default', true)
  .single();

// Pobierz pełne dane oferty
const { data: offerData } = await supabase
  .from('offers')
  .select(
    `
    *,
    client:clients(*),
    items:offer_items(*)
  `,
  )
  .eq('id', offer.id)
  .single();

// Wygeneruj PDF (do implementacji w UI)
```

---

## 🔒 Bezpieczeństwo (RLS)

### Katalog produktów:

- ✅ **Wszyscy pracownicy** mogą przeglądać
- ✅ Tylko z uprawnieniem **`offers_manage`** mogą edytować

### Oferty i pozycje:

- ✅ **Admini** widzą wszystkie
- ✅ Pracownicy z **`offers_manage`** widzą wszystkie
- ✅ **Twórca** widzi swoje oferty
- ✅ **Twórca** może edytować tylko **draft**
- ✅ **Admini** mogą edytować wszystkie statusy

### Szablony:

- ✅ Wszyscy mogą przeglądać
- ✅ Tylko **`offers_manage`** może zarządzać

---

## 📊 Przykładowe zapytania

### Produkty z wymaganym sprzętem

```sql
SELECT
  p.*,
  json_agg(
    json_build_object(
      'equipment_name', ei.name,
      'quantity', pe.quantity,
      'is_optional', pe.is_optional
    )
  ) as equipment
FROM offer_products p
LEFT JOIN offer_product_equipment pe ON pe.product_id = p.id
LEFT JOIN equipment_items ei ON ei.id = pe.equipment_item_id
GROUP BY p.id;
```

### Oferta z pełnymi danymi

```sql
SELECT
  o.*,
  c.company_name as client_name,
  json_agg(
    json_build_object(
      'name', oi.name,
      'quantity', oi.quantity,
      'unit_price', oi.unit_price,
      'subtotal', oi.subtotal,
      'total', oi.total
    ) ORDER BY oi.display_order
  ) as items
FROM offers o
LEFT JOIN clients c ON c.id = o.client_id
LEFT JOIN offer_items oi ON oi.offer_id = o.id
WHERE o.id = 'xxx'
GROUP BY o.id, c.company_name;
```

### Marża produktu

```sql
SELECT
  name,
  base_price,
  cost_price,
  (base_price - cost_price) as margin_amount,
  ROUND(((base_price - cost_price) / base_price) * 100, 2) as margin_percent
FROM offer_products
WHERE is_active = true
ORDER BY margin_percent DESC;
```

---

## 🚀 Dalszy rozwój

### Do implementacji w UI:

1. **Panel zarządzania produktami** - CRUD katalogu
2. **Kreator ofert** - drag & drop produktów do oferty
3. **Generator PDF** - rendering HTML→PDF z szablonem
4. **Kalkulator kosztów** - live preview marż
5. **Historia ofert** - wersjonowanie zmian
6. **Konwersja ofert** - oferta → wydarzenie (auto-rezerwacja sprzętu)

### Przyszłe rozszerzenia:

- **Pakiety** - zestawy produktów (np. "Wesele Standard")
- **Ceny sezonowe** - różne ceny w różnych miesiącach
- **Rabaty quantity** - automatyczne rabaty przy większych ilościach
- **Konfiguratory** - warianty produktów (Basic/Standard/Premium)
- **Integracja z magazynem** - sprawdzanie dostępności sprzętu

---

## 📝 Notatki implementacyjne

### Automatyzacje:

- ✅ Przeliczanie sum przy zmianie pozycji
- ✅ Kolumny GENERATED dla subtotal/total
- ✅ Triggery updated_at
- ✅ Walidacja RLS

### Do zrobienia:

- [ ] UI dla zarządzania katalogiem
- [ ] Kreator ofert z drag & drop
- [ ] Generator PDF
- [ ] Import/export produktów (CSV)
- [ ] Statystyki sprzedaży produktów
- [ ] Rekomendacje produktów dla klientów

---

Wszystko gotowe do implementacji w UI! 🎊
