# 📋 Workflow Faktur Proforma → Faktura VAT

## 🎯 Problem: KSeF nie obsługuje proform

W systemie KSeF **nie ma** faktur proforma. KSeF przyjmuje tylko:
- ✅ Faktury VAT
- ✅ Faktury zaliczkowe
- ✅ Faktury korygujące
- ✅ Faktury końcowe
- ❌ **NIE MA proform**

## 💡 Rozwiązanie

### 1️⃣ Faktura Proforma (tylko PDF, NIE idzie do KSeF)

```
Klient: "Potrzebuję wycenę przed zapłaceniem"
Ty: Wystawiasz PROFORMĘ
├── is_proforma = true
├── status = 'proforma'
├── invoice_number = "PROFORMA/2026/04/001"
└── Generuje się tylko PDF (mail do klienta)
    └── ❌ NIE wysyła się do KSeF!
```

**Proforma służy jako:**
- Wycena dla klienta
- Dokument do zapłaty zaliczki
- Potwierdzenie zamówienia

### 2️⃣ Po zapłacie: Wystaw Fakturę VAT

```
Klient: "Zapłaciłem, potrzebuję faktury"
Ty: Klikasz "Wystaw fakturę VAT na podstawie proformy"
├── System tworzy nową fakturę VAT:
│   ├── is_proforma = false
│   ├── status = 'issued'
│   ├── invoice_number = "FV/2026/04/015"
│   ├── related_invoice_id = [ID proformy]
│   └── Kopiuje wszystkie dane z proformy
└── Faktura VAT idzie do KSeF ✅
```

**Faktura VAT:**
- Wysyłana automatycznie do KSeF
- Prawnie wiążący dokument
- Pojawia się na koncie klienta w KSeF

### 3️⃣ Powiązanie Proforma ↔ Faktura VAT

```sql
-- Proforma wskazuje na fakturę VAT
UPDATE invoices
SET proforma_converted_to_invoice_id = [ID faktury VAT]
WHERE id = [ID proformy];

-- Faktura VAT wskazuje na proformę (opcjonalnie)
UPDATE invoices
SET related_invoice_id = [ID proformy]
WHERE id = [ID faktury VAT];
```

## 📊 Statusy Faktur

### Proforma (is_proforma = true):
- `draft` - Szkic proformy
- `proforma` - Wystawiona proforma (gotowy PDF)
- `cancelled` - Anulowana

### Faktura VAT (is_proforma = false):
- `draft` - Szkic faktury
- `issued` - Wysłana do KSeF
- `paid` - Zapłacona (z wyciągu bankowego)
- `overdue` - Przeterminowana
- `cancelled` - Anulowana

## 🔧 Wymagane zmiany w Frontendzie

### 1. Formularz wystawiania faktury

```typescript
// W /crm/invoices/new/page.tsx
const [invoiceType, setInvoiceType] = useState<'vat' | 'proforma' | 'advance' | 'corrective'>('vat');

// Przy zapisie:
const invoiceData = {
  // ... wszystkie pola
  is_proforma: invoiceType === 'proforma',
  status: invoiceType === 'proforma' ? 'proforma' : 'draft',
  invoice_type: invoiceType === 'proforma' ? 'vat' : invoiceType, // Zapisz jako 'vat' w bazie
};
```

### 2. Widok proformy - przycisk konwersji

```typescript
// W /crm/invoices/[id]/page.tsx
{invoice.is_proforma && !invoice.proforma_converted_to_invoice_id && (
  <button onClick={convertProformaToInvoice}>
    ✅ Wystaw fakturę VAT na podstawie proformy
  </button>
)}

{invoice.is_proforma && invoice.proforma_converted_to_invoice_id && (
  <div className="info">
    ✅ Faktura VAT wystawiona:
    <Link href={`/crm/invoices/${invoice.proforma_converted_to_invoice_id}`}>
      Zobacz fakturę VAT
    </Link>
  </div>
)}
```

### 3. Funkcja konwersji

```typescript
const convertProformaToInvoice = async (proformaId: string) => {
  // 1. Pobierz dane proformy
  const { data: proforma } = await supabase
    .from('invoices')
    .select('*, invoice_items(*)')
    .eq('id', proformaId)
    .single();

  // 2. Generuj nowy numer faktury VAT
  const { data: invoiceNumber } = await supabase.rpc('generate_invoice_number', {
    p_invoice_type: 'vat'
  });

  // 3. Utwórz fakturę VAT
  const { data: vatInvoice } = await supabase
    .from('invoices')
    .insert({
      ...proforma,
      id: undefined, // Nowe UUID
      invoice_number: invoiceNumber,
      is_proforma: false,
      status: 'draft', // Zostanie zmieniony na 'issued' przy wysyłce do KSeF
      related_invoice_id: proformaId,
      issue_date: new Date().toISOString().split('T')[0],
      created_at: undefined,
      updated_at: undefined,
    })
    .select()
    .single();

  // 4. Skopiuj pozycje
  const itemsToCopy = proforma.invoice_items.map(item => ({
    ...item,
    id: undefined,
    invoice_id: vatInvoice.id,
  }));

  await supabase.from('invoice_items').insert(itemsToCopy);

  // 5. Zaktualizuj proformę
  await supabase
    .from('invoices')
    .update({ proforma_converted_to_invoice_id: vatInvoice.id })
    .eq('id', proformaId);

  // 6. Przekieruj na nową fakturę
  router.push(`/crm/invoices/${vatInvoice.id}`);
};
```

## 🔍 Widok listy faktur

```typescript
// Filtrowanie
const [filterType, setFilterType] = useState<'all' | 'proforma' | 'vat'>('all');

// Query
let query = supabase.from('invoices').select('*');

if (filterType === 'proforma') {
  query = query.eq('is_proforma', true);
} else if (filterType === 'vat') {
  query = query.eq('is_proforma', false);
}

// Badge w tabeli
{invoice.is_proforma ? (
  <Badge variant="secondary">PROFORMA</Badge>
) : (
  <Badge variant="primary">FAKTURA VAT</Badge>
)}
```

## ✅ Korzyści tego podejścia

1. **Zgodność z KSeF** - Proformy nie idą do KSeF (bo nie powinny)
2. **Jasny workflow** - Proforma → Zapłata → Faktura VAT
3. **Historia** - Widać które faktury powstały z proform
4. **Elastyczność** - Możesz wystawić fakturę VAT bez proformy
5. **Dane klienta** - Wystarczy raz wypełnić w proformie

## 📝 Dodatkowe uwagi

- **Numeracja**: Proformy i faktury mają osobne numery (PROFORMA/2026/04/001 vs FV/2026/04/015)
- **PDF**: Proformy i faktury mają różne szablony PDF (proforma ma napis "FAKTURA PROFORMA")
- **KSeF**: Tylko faktury VAT z `is_proforma = false` i `status = 'issued'` idą do KSeF
- **Płatności**: Dopasowanie z banku działa dla faktur VAT, nie dla proform
