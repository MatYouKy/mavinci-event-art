# 📋 System Ofert dla Sprzedawców - Dokumentacja

## ✅ Co zostało zaimplementowane:

### 1. Struktura Bazy Danych

#### **Nowe tabele:**

- **`salespeople`** - Sprzedawcy (oddzielni od użytkowników CRM)
  - Powiązani z auth.users przez `auth_user_id`
  - Email, imię, nazwisko, prowizja
  - Przypisane regiony

- **`attractions`** - Katalog 40+ atrakcji z cenami
  - Kategorie: nagłośnienie, DJ, oświetlenie, technika, kasyno, VR, streaming, etc.
  - Cena bazowa, jednostka, czas trwania
  - Tagi i opisy

- **`offers`** - Oferty (rozszerzona istniejąca tabela)
  - Numer oferty (auto-generowany)
  - Powiązanie z klientem i sprzedawcą
  - Status (draft, sent, viewed, accepted, rejected, expired)
  - Ceny bazowe i finalne
  - Rabaty

- **`offer_items`** - Pozycje w ofercie
  - Atrakcja + ilość
  - Cena bazowa (z katalogu)
  - Cena finalna (edytowalna przez sprzedawcę)
  - Automatyczne liczenie subtotal

- **`offer_price_audit`** - Audyt zmian cen
  - **AUTOMATYCZNY** - trigger zapisuje każdą zmianę ceny
  - Kto zmienił, kiedy, o ile %
  - Różnica w złotówkach

- **`salesperson_calendar`** - Kalendarz sprzedawcy
  - Rezerwacje klientów
  - Blokady czasowe
  - Powiązania z ofertami

### 2. Panel Sprzedawcy (/seller)

**Dashboard sprzedawcy:**

- Statystyki: wszystkie oferty, oczekujące, zaakceptowane, przychód
- Lista ostatnich ofert
- Szybkie akcje (nowa oferta, kalendarz, klienci, katalog)

**Nawigacja:**

- ✅ Dashboard
- 🔜 Moje oferty (lista + szczegóły)
- 🔜 Kalendarz rezerwacji
- 🔜 Klienci (widok sprzedawcy)
- 🔜 Katalog atrakcji (przeglądanie cen)

### 3. Zabezpieczenia (RLS)

- ✅ Sprzedawcy widzą TYLKO swoje dane
- ✅ Admin widzi wszystko
- ✅ Automatyczny audyt zmian cen (nie do ominięcia)
- ✅ Pełna izolacja danych między sprzedawcami

### 4. Automatyzacje (Triggers)

**`calculate_offer_item_subtotal`**

- Auto-liczy subtotal = cena × ilość

**`audit_price_change`**

- AUTOMATYCZNIE zapisuje do audytu gdy sprzedawca zmienia cenę
- Liczy różnicę i procent zmiany

**`generate_offer_number`**

- Auto-generuje numer oferty: OFF-20251003-0001

## 🚀 Jak to działa:

### Dla Sprzedawcy:

1. **Loguje się** (/crm/login)
   - Konto Supabase Auth musi być powiązane z zapisem w `salespeople`

2. **Przechodzi na /seller**
   - Widzi swoje statystyki
   - Listę swoich ofert

3. **Tworzy nową ofertę** (/seller/offers/new) - DO ZROBIENIA
   - Wybiera klienta
   - Dodaje atrakcje z katalogu
   - **MOŻE EDYTOWAĆ CENY** (ale audyt to zapisze!)
   - Dodaje rabat globalny
   - Zapisuje jako draft lub wysyła

4. **Generuje PDF** - DO ZROBIENIA
   - Profesjonalna oferta z logo Mavinci
   - Tabela pozycji
   - Podsumowanie z cenami

5. **Zarządza kalendarzem** - DO ZROBIENIA
   - Dodaje rezerwacje
   - Widzi swoje zajętości

### Dla Admina:

1. **Przegląda audyt cen** (/crm/price-audit) - DO ZROBIENIA
   - Kto, kiedy zmienił cenę
   - Z jakiej na jaką (różnica w zł i %)
   - W jakiej ofercie
   - Powód (opcjonalnie)

2. **Widzi wszystkie oferty**
   - Może przeglądać oferty wszystkich sprzedawców
   - Statystyki sprzedaży

3. **Zarządza katalogiem**
   - Dodaje/edytuje atrakcje
   - Zmienia ceny bazowe

## 📊 Przykładowe dane:

✅ **40+ atrakcji** w katalogu:

- Nagłośnienie basic → premium (800-3500 zł)
- DJ pakiety (1200-3000 zł)
- Oświetlenie LED, moving heads, lasery
- Technika sceniczna (sceny, ekrany, projektory)
- Dekoracje, balony, tkaniny
- Kasyno (2500-3500 zł)
- Symulatory VR (1200-1500 zł)
- Konferencje (system tłumaczeń, głosowania)
- Streaming (basic → pro)

✅ **1 sprzedawca testowy:**

- Email: sprzedawca@mavinci.pl

## 🔧 Co pozostało do zrobienia:

### PRIORYTET 1:

- [ ] **Kreator ofert** (/seller/offers/new)
  - Formularz wieloetapowy
  - Wybór klienta
  - Dodawanie pozycji z katalogu
  - Edycja cen (z ostrzeżeniem o audycie)
  - Rabaty
  - Zapisz jako draft / wyślij

- [ ] **Lista ofert** (/seller/offers)
  - Filtry (status, klient, data)
  - Wyszukiwanie
  - Akcje (edytuj, usuń, generuj PDF)

- [ ] **Szczegóły oferty** (/seller/offers/[id])
  - Podgląd pełnej oferty
  - Edycja pozycji
  - Historia statusów
  - Generowanie PDF

### PRIORYTET 2:

- [ ] **Generator PDF ofert**
  - Biblioteka: react-pdf lub jsPDF
  - Template z logo Mavinci
  - Tabela pozycji
  - Podsumowanie
  - Zapis do Supabase Storage

- [ ] **Kalendarz sprzedawcy** (/seller/calendar)
  - Widok kalendarza (FullCalendar?)
  - Dodawanie rezerwacji
  - Blokady czasowe
  - Powiązanie z ofertami

### PRIORYTET 3:

- [ ] **Panel audytu dla admina** (/crm/price-audit)
  - Tabela zmian cen
  - Filtry (sprzedawca, zakres dat, wielkość zmiany)
  - Statystyki (średnia zmiana, TOP rabaty)
  - Export do Excel

- [ ] **Katalog atrakcji dla sprzedawcy** (/seller/attractions)
  - Przeglądanie atrakcji
  - Wyszukiwanie
  - Filtry po kategorii
  - Podgląd cen

## 🔐 Logowanie:

### ✅ NAJŁATWIEJSZY SPOSÓB - Strona rejestracji:

1. **Przejdź do:** http://localhost:3000/crm/register
2. **Zarejestruj konto:**
   - Email: **admin@mavinci.pl**
   - Hasło: **Mavinci2025!**
   - Potwierdź hasło
3. **Kliknij "Zarejestruj się"**
4. **Zaloguj się** (zostaniesz automatycznie przekierowany)

### Lub:

- Na stronie logowania kliknij link **"Zarejestruj się"** na dole

### Dodanie sprzedawcy:

**W SQL (Supabase Dashboard):**

```sql
-- 1. Najpierw utwórz konto auth (jak wyżej, inny email)
-- 2. Potem dodaj do salespeople:

INSERT INTO salespeople (
  auth_user_id,
  email,
  first_name,
  last_name,
  is_active
) VALUES (
  'WKLEJ_UUID_Z_AUTH_USERS',
  'sprzedawca@mavinci.pl',
  'Jan',
  'Kowalski',
  true
);
```

## 📈 Architektura:

```
┌─────────────────┐
│  Sprzedawca     │  Loguje się → /seller
│  (auth.users)   │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  salespeople    │  Profil sprzedawcy
│                 │  (prowizja, regiony)
└────────┬────────┘
         │
         v
┌─────────────────┐
│   offers        │  Tworzy oferty
│                 │  ├─ offer_items (pozycje)
│                 │  └─ offer_price_audit (auto!)
└────────┬────────┘
         │
         v
┌─────────────────┐
│   PDF Export    │  Generuje ofertę PDF
└─────────────────┘
```

## 🎯 Następne kroki:

1. **Dokończ kreator ofert** - najważniejsze
2. **Dodaj generator PDF** - kluczowe dla biznesu
3. **Zaimplementuj kalendarz** - funkcjonalność dla sprzedawców
4. **Stwórz audyt dla admina** - kontrola rabatów

---

**System jest gotowy do rozwoju!** Baza działą, struktura jest, panel sprzedawcy działa, audyt cen automatyczny.
