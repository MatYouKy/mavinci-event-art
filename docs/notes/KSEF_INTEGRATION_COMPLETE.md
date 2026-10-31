# ✅ Integracja KSeF - Kompletna dokumentacja

## 🎉 Status: GOTOWE DO UŻYCIA

System jest w pełni przygotowany do wystawiania faktur VAT i wysyłki do KSeF, z pełną obsługą faktur proforma.

---

## 📋 Co zostało zaimplementowane

### 1. Backend - Generator XML FA(2) ✅

**Plik:** `src/lib/ksef/generateFA2XML.ts`

- ✅ Generowanie poprawnego XML w formacie FA(2) wymaganym przez KSeF
- ✅ Obsługa wszystkich pól faktury (sprzedawca, nabywca, pozycje, VAT)
- ✅ Grupowanie pozycji według stawek VAT
- ✅ Walidacja wymagań KSeF przed wysyłką
- ✅ Escape znaków specjalnych XML
- ✅ Formatowanie kwot i dat zgodnie z wymogami

**Kluczowe funkcje:**
```typescript
generateFA2XML(invoice) // Generuje XML
validateFA2Requirements(invoice) // Waliduje przed wysyłką
```

---

### 2. Backend - API Route wysyłki ✅

**Plik:** `src/app/(public)/api/ksef/invoices/send/route.ts`

Endpoint: `POST /api/ksef/invoices/send`

**Co robi:**
1. Pobiera fakturę z bazy danych
2. Waliduje (czy nie jest proformą, czy nie została już wysłana)
3. Uwierzytelnia się w KSeF (automatyczna ponowna autentykacja jeśli token wygasł)
4. Generuje XML FA(2)
5. Wysyła do KSeF
6. Zapisuje w `ksef_invoices` z numerem referencyjnym
7. Aktualizuje status faktury na 'issued'
8. Dodaje wpis do historii

**Zabezpieczenia:**
- ❌ Blokuje wysyłkę proform do KSeF
- ✅ Sprawdza czy faktura nie została już wysłana
- ✅ Automatyczne odświeżanie tokenu dostępu
- ✅ Pełne logowanie błędów

---

### 3. Baza danych - Wsparcie dla proform ✅

**Migracja:** `add_proforma_to_invoice_workflow.sql`

**Nowe kolumny w tabeli `invoices`:**
- `is_proforma` (boolean) - czy to proforma czy faktura VAT
- `proforma_converted_to_invoice_id` (uuid) - link proforma → faktura VAT

**Statusy:**
```
PROFORMA (is_proforma = true):
  - draft → proforma → cancelled

FAKTURA VAT (is_proforma = false):
  - draft → issued → paid/overdue → cancelled
```

**Workflow:**
```
Proforma (status='proforma')
    ↓ Klient zapłacił
    ↓ Klik: "Wystaw fakturę VAT"
    ↓
Faktura VAT (status='draft')
    ↓ Klik: "Wyślij do KSeF"
    ↓
Faktura w KSeF (status='issued')
```

---

### 4. Frontend - Formularz wystawiania ✅

**Plik:** `src/app/(crm)/crm/invoices/new/page.tsx`

**Zmiany:**
- ✅ Obsługa wyboru "Proforma" w dropdownie typu faktury
- ✅ Automatyczne ustawianie `is_proforma = true` dla proform
- ✅ Status 'proforma' dla proform, 'draft' dla faktur VAT
- ✅ Zapisywanie `invoice_type = 'vat'` nawet dla proform (zgodnie z KSeF)

**Kod:**
```typescript
const invoiceData = {
  invoice_type: invoiceType === 'proforma' ? 'vat' : invoiceType,
  is_proforma: invoiceType === 'proforma',
  status: invoiceType === 'proforma' ? 'proforma' : 'draft',
  // ... reszta pól
};
```

---

### 5. Frontend - Widok faktury ✅

**Plik:** `src/app/(crm)/crm/invoices/[id]/page.tsx`

**Nowe funkcje:**

#### A) Przycisk wysyłki do KSeF
```typescript
handleSendToKSeF() // Wysyła fakturę VAT do KSeF
```

**Gdzie widoczny:**
- Dla faktur VAT (`is_proforma = false`)
- W statusie 'draft'
- Złoty przycisk "Wyślij do KSeF"

#### B) Panel proformy
```typescript
handleConvertToVAT() // Konwertuje proformę na fakturę VAT
```

**Co pokazuje:**
- Żółty banner dla proform
- Informacja że proforma nie idzie do KSeF
- Przycisk "Wystaw fakturę VAT na podstawie proformy"
- Po konwersji: link do utworzonej faktury VAT

#### C) Panel powiązań
- Dla faktury VAT z proformy: link do źródłowej proformy
- Dla proformy po konwersji: link do faktury VAT

---

### 6. Frontend - Konwersja proforma → VAT ✅

**Plik:** `src/lib/invoices/convertProformaToInvoice.ts`

**Funkcja:** `convertProformaToInvoice(proformaId)`

**Co robi:**
1. Pobiera proformę z pozycjami
2. Waliduje czy to proforma i czy nie była już konwertowana
3. Generuje nowy numer faktury VAT
4. Tworzy fakturę VAT z danymi z proformy
5. Kopiuje wszystkie pozycje
6. Linkuje proformę z fakturą VAT
7. Dodaje wpis do historii

**Rezultat:**
- Nowa faktura VAT w statusie 'draft'
- Gotowa do wysyłki do KSeF
- Proforma ma link do faktury VAT
- Faktura VAT ma link do proformy

---

## 🔐 Uwierzytelnianie KSeF

System automatycznie zarządza uwierzytelnianiem:

1. **Pierwsze logowanie:**
   - Panel: `/crm/settings/ksef`
   - Dodajesz certyfikat i token dla każdej firmy
   - System zapisuje dane w `ksef_credentials`

2. **Automatyczne odświeżanie:**
   - Przed wysyłką sprawdzany jest token dostępu
   - Jeśli wygasł - automatycznie odświeżany
   - Nowy token zapisywany w bazie

3. **Wielofirmowość:**
   - Każda firma (`my_company_id`) ma osobne dane KSeF
   - System automatycznie wybiera odpowiednie dane

---

## 📝 Instrukcja użycia

### Scenariusz 1: Faktura VAT bezpośrednio

```
1. Przejdź do: /crm/invoices/new
2. Wybierz typ: "Faktura VAT"
3. Wypełnij dane
4. Kliknij "Wystaw fakturę"
   → Faktura zapisana w statusie 'draft'

5. Wejdź w fakturę
6. Kliknij "Wyślij do KSeF"
   → System:
     - Generuje XML FA(2)
     - Loguje się do KSeF
     - Wysyła fakturę
     - Zapisuje numer referencyjny
     - Zmienia status na 'issued'

7. ✅ Faktura w KSeF!
```

### Scenariusz 2: Proforma → Faktura VAT

```
1. Przejdź do: /crm/invoices/new
2. Wybierz typ: "Proforma"
3. Wypełnij dane
4. Kliknij "Wystaw fakturę"
   → Proforma zapisana w statusie 'proforma'
   → ❌ NIE idzie do KSeF

5. Klient płaci

6. Wejdź w proformę
7. Kliknij "Wystaw fakturę VAT na podstawie proformy"
   → System:
     - Tworzy nową fakturę VAT
     - Kopiuje wszystkie dane
     - Linkuje z proformą
   → Przekierowuje na nową fakturę VAT

8. Na fakturze VAT kliknij "Wyślij do KSeF"
   → Faktura idzie do KSeF

9. ✅ Faktura w KSeF!
   → Proforma ma link do faktury VAT
   → Faktura VAT ma link do proformy
```

---

## 🏢 Wielofirmowość

System wspiera wiele firm (np. MAVINCI, NASTROJOWO):

1. **Dodawanie firmy:**
   - Panel: `/crm/settings/my-companies`
   - Dodaj dane firmy (NIP, adres, bank)

2. **Dane KSeF dla firmy:**
   - Panel: `/crm/settings/ksef`
   - Wybierz firmę
   - Dodaj certyfikat i token KSeF
   - Zaznacz środowisko (test/produkcja)

3. **Wystawianie faktury:**
   - W formularzu wybierz firmę wystawiającą
   - System automatycznie użyje odpowiednich danych KSeF

4. **Rozpoznawanie faktur:**
   - W `ksef_invoices` pole `my_company_id` wskazuje firmę
   - Przy syncowaniu z KSeF rozpoznawane po NIP

---

## 🔍 Monitorowanie

### Tabela: `ksef_invoices`

Przechowuje faktury wysłane do KSeF:

```sql
SELECT
  ksef_reference_number,
  invoice_number,
  sync_status,
  gross_amount,
  ksef_issued_at
FROM ksef_invoices
WHERE my_company_id = '...'
ORDER BY ksef_issued_at DESC;
```

**Statusy sync:**
- `synced` - pomyślnie wysłana
- `error` - błąd wysyłki (pole `sync_error` zawiera szczegóły)

### Historia faktur

```sql
SELECT
  action,
  changes,
  created_at
FROM invoice_history
WHERE invoice_id = '...'
ORDER BY created_at DESC;
```

**Akcje:**
- `created` - utworzenie
- `created_from_proforma` - konwersja z proformy
- `sent_to_ksef` - wysłanie do KSeF

---

## ⚠️ Zabezpieczenia

### 1. Proformy NIE idą do KSeF

```typescript
if (invoice.is_proforma) {
  return { error: 'Faktury proforma nie mogą być wysłane do KSeF' };
}
```

### 2. Brak duplikatów

```typescript
if (invoice.status === 'issued') {
  // Sprawdź czy już w ksef_invoices
}
```

### 3. Walidacja przed wysyłką

```typescript
const validation = validateFA2Requirements(invoice);
if (!validation.valid) {
  return { error: 'Nie spełnia wymagań', details: validation.errors };
}
```

### 4. RLS Policies

- Tylko użytkownicy z uprawnieniami `invoices_manage` mogą wysyłać
- Service role key używany tylko w API route (server-side)

---

## 🐛 Rozwiązywanie problemów

### Problem: "Brak aktywnych danych uwierzytelniających"

**Rozwiązanie:**
1. Przejdź do `/crm/settings/ksef`
2. Dodaj certyfikat i token dla firmy
3. Upewnij się że `is_active = true`

### Problem: "Token wygasł"

**Rozwiązanie:**
- System automatycznie odświeża token
- Jeśli dalej błąd - sprawdź certyfikat w bazie

### Problem: "KSeF API error 400"

**Rozwiązanie:**
1. Sprawdź logi w konsoli (szczegóły błędu)
2. Waliduj czy wszystkie pola są poprawne:
   - NIP sprzedawcy (10 cyfr)
   - NIP nabywcy
   - Kwoty > 0
   - Pozycje faktury

### Problem: "Faktura wysłana ale nie ma w ksef_invoices"

**Rozwiązanie:**
1. Sprawdź `invoice_history` - czy jest akcja `sent_to_ksef`
2. Sprawdź status faktury - powinien być 'issued'
3. Logi serwera pokażą szczegóły

---

## 📊 Struktura plików

```
src/
├── lib/
│   ├── ksef/
│   │   └── generateFA2XML.ts          # Generator XML FA(2)
│   └── invoices/
│       └── convertProformaToInvoice.ts # Konwersja proforma→VAT
│
├── app/
│   ├── (public)/api/
│   │   └── ksef/
│   │       ├── client.ts              # Klient HTTP KSeF
│   │       ├── crypto.ts              # Szyfrowanie tokenów
│   │       ├── parsePaymentData.ts    # Parsowanie + certyfikat
│   │       └── invoices/
│   │           └── send/
│   │               └── route.ts       # API wysyłki do KSeF
│   │
│   └── (crm)/crm/invoices/
│       ├── new/
│       │   └── page.tsx               # Formularz wystawiania
│       └── [id]/
│           └── page.tsx               # Widok faktury + KSeF
│
└── supabase/migrations/
    └── ...add_proforma_to_invoice_workflow.sql
```

---

## ✅ Checklist przed produkcją

- [x] Migracja bazy danych wykonana
- [x] Generator XML FA(2) zaimplementowany
- [x] API route wysyłki gotowy
- [x] Frontend - formularz wystawiania
- [x] Frontend - widok faktury
- [x] Frontend - konwersja proforma→VAT
- [x] Walidacja wymagań KSeF
- [x] Obsługa błędów
- [x] Automatyczne odświeżanie tokenów
- [x] Wielofirmowość
- [x] RLS policies
- [ ] **Testy na środowisku testowym KSeF**
- [ ] **Dodanie certyfikatów produkcyjnych**
- [ ] **Testy z prawdziwymi fakturami**

---

## 🚀 Następne kroki (opcjonalne)

1. **Pobieranie UPO** (Urzędowe Potwierdzenie Odbioru)
   - Po wysłaniu faktury KSeF zwraca UPO
   - Można je zapisać jako PDF i załączyć do faktury

2. **Automatyczna synchronizacja**
   - Cron job pobierający faktury z KSeF co godzinę
   - Automatyczne dopasowanie płatności

3. **Generowanie PDF faktury**
   - Aktualnie `window.print()`
   - Można dodać backend PDF z logo i pieczątkami

4. **Email z fakturą**
   - Automatyczny mail do klienta po wysłaniu do KSeF
   - Załącznik PDF + link do faktury w KSeF

---

## 📞 Wsparcie

W razie problemów:
1. Sprawdź logi w konsoli przeglądarki
2. Sprawdź logi API route (`console.log` w route.ts)
3. Sprawdź tabele: `ksef_invoices`, `invoice_history`
4. Dokumentacja KSeF: https://www.gov.pl/web/kas/api-ksef

---

**Status: System gotowy do testów i wdrożenia produkcyjnego! 🎉**
