# ✅ Lista kontrolna - Gotowość do wystawiania faktur

## 📊 Status aktualny

### ✅ Backend - GOTOWE

| Element | Status | Uwagi |
|---------|--------|-------|
| Tabela `invoices` | ✅ Gotowa | Wszystkie pola obecne |
| Tabela `invoice_items` | ✅ Gotowa | Pozycje z VAT |
| Tabela `my_companies` | ✅ Gotowa | Dane firm wystawiających |
| Kolumna `is_proforma` | ✅ Dodana | Migracja wykonana |
| Kolumna `proforma_converted_to_invoice_id` | ✅ Dodana | Link proforma→faktura |
| Funkcja `generate_invoice_number` | ✅ Gotowa | Obsługuje proformy (PRO/1/2026) |
| Statusy faktur | ✅ Zaktualizowane | draft, proforma, issued, paid, cancelled, overdue |
| RLS policies | ✅ Powinny być | Sprawdź czy są |

### ⚠️ Frontend - WYMAGA AKTUALIZACJI

| Element | Status | Co zrobić |
|---------|--------|-----------|
| Formularz wystawiania | ⚠️ Do poprawy | Dodać obsługę `is_proforma` |
| Lista faktur | ⚠️ Do poprawy | Filtrowanie proforma/VAT, badge |
| Widok faktury | ⚠️ Do poprawy | Przycisk "Wystaw fakturę VAT" dla proform |
| Funkcja konwersji | ❌ Brak | Konwersja proforma → faktura VAT |
| PDF dla proformy | ❌ Brak | Szablon PDF z napisem "PROFORMA" |
| Integracja KSeF | ❌ Brak | Wysyłka tylko faktur VAT, NIE proform |

### 🔌 Integracja KSeF - DO ZROBIENIA

| Element | Status | Co zrobić |
|---------|--------|-----------|
| Generowanie XML | ❌ Brak | FA(2) format dla KSeF |
| Wysyłka do KSeF | ❌ Brak | Edge Function lub API route |
| Odbieranie UPO | ❌ Brak | Potwierdzenie z KSeF |
| Pobieranie faktur | ✅ Częściowo | Masz już sync z KSeF |
| Status sync | ✅ Jest | W tabeli `ksef_invoices` |

## 🚀 Co trzeba zrobić NAJPIERW

### 1. Frontend - Formularz wystawiania (PRIORYTET 1)

```typescript
// src/app/(crm)/crm/invoices/new/page.tsx

// Przy zapisie:
const handleSubmit = async () => {
  // ...
  const invoiceData = {
    // ... pozostałe pola
    is_proforma: invoiceType === 'proforma',
    status: invoiceType === 'proforma' ? 'proforma' : 'draft',
    invoice_type: invoiceType === 'proforma' ? 'vat' : invoiceType,
  };

  const { data: invoice } = await supabase
    .from('invoices')
    .insert(invoiceData)
    .select()
    .single();

  // Jeśli to proforma - od razu generuj PDF
  // Jeśli to faktura VAT - możliwość wysłania do KSeF
};
```

### 2. Frontend - Konwersja proforma → faktura VAT (PRIORYTET 1)

Utwórz plik: `src/lib/invoices/convertProformaToInvoice.ts`

```typescript
export async function convertProformaToInvoice(proformaId: string) {
  // 1. Pobierz proformę
  const { data: proforma } = await supabase
    .from('invoices')
    .select('*, invoice_items(*)')
    .eq('id', proformaId)
    .single();

  if (!proforma.is_proforma) {
    throw new Error('To nie jest proforma');
  }

  if (proforma.proforma_converted_to_invoice_id) {
    throw new Error('Faktura VAT została już wystawiona');
  }

  // 2. Generuj numer faktury VAT
  const { data: invoiceNumber } = await supabase.rpc('generate_invoice_number', {
    p_invoice_type: 'vat'
  });

  // 3. Utwórz fakturę VAT
  const { data: vatInvoice } = await supabase
    .from('invoices')
    .insert({
      // Skopiuj wszystkie pola z proformy
      invoice_number: invoiceNumber,
      invoice_type: 'vat',
      status: 'draft',
      is_proforma: false,
      related_invoice_id: proformaId,

      // Dane z proformy
      my_company_id: proforma.my_company_id,
      organization_id: proforma.organization_id,
      seller_name: proforma.seller_name,
      seller_nip: proforma.seller_nip,
      // ... wszystkie inne pola

      // Nowa data wystawienia
      issue_date: new Date().toISOString().split('T')[0],
      sale_date: new Date().toISOString().split('T')[0],

      // Przelicz datę płatności
      payment_due_date: calculatePaymentDueDate(14), // lub z proformy
    })
    .select()
    .single();

  // 4. Skopiuj pozycje
  const items = proforma.invoice_items.map(item => ({
    invoice_id: vatInvoice.id,
    position_number: item.position_number,
    name: item.name,
    unit: item.unit,
    quantity: item.quantity,
    price_net: item.price_net,
    vat_rate: item.vat_rate,
    value_net: item.value_net,
    vat_amount: item.vat_amount,
    value_gross: item.value_gross,
  }));

  await supabase.from('invoice_items').insert(items);

  // 5. Zaktualizuj proformę
  await supabase
    .from('invoices')
    .update({ proforma_converted_to_invoice_id: vatInvoice.id })
    .eq('id', proformaId);

  // 6. Historia
  await supabase.from('invoice_history').insert({
    invoice_id: vatInvoice.id,
    action: 'created_from_proforma',
    changed_by: employee?.id,
    changes: { source_proforma_id: proformaId },
  });

  return vatInvoice;
}
```

### 3. Frontend - Widok faktury z przyciskiem (PRIORYTET 1)

```typescript
// src/app/(crm)/crm/invoices/[id]/page.tsx

{invoice.is_proforma && (
  <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
    <div className="flex items-center justify-between">
      <div>
        <h3 className="font-medium text-yellow-400">Faktura Proforma</h3>
        <p className="text-sm text-[#e5e4e2]/60">
          Ta proforma nie zostanie wysłana do KSeF
        </p>
      </div>

      {!invoice.proforma_converted_to_invoice_id && (
        <button
          onClick={handleConvertToInvoice}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33]"
        >
          ✅ Wystaw fakturę VAT
        </button>
      )}

      {invoice.proforma_converted_to_invoice_id && (
        <Link
          href={`/crm/invoices/${invoice.proforma_converted_to_invoice_id}`}
          className="text-sm text-[#d3bb73] hover:underline"
        >
          → Zobacz fakturę VAT
        </Link>
      )}
    </div>
  </div>
)}

{!invoice.is_proforma && invoice.related_invoice_id && (
  <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
    <div className="text-sm text-[#e5e4e2]/60">
      Wystawiona na podstawie proformy:
      <Link
        href={`/crm/invoices/${invoice.related_invoice_id}`}
        className="ml-2 text-[#d3bb73] hover:underline"
      >
        Zobacz proformę
      </Link>
    </div>
  </div>
)}
```

### 4. Integracja KSeF - Wysyłka faktur (PRIORYTET 2)

Utwórz Edge Function: `supabase/functions/send-invoice-to-ksef/index.ts`

```typescript
// Pobierz fakturę
const { data: invoice } = await supabase
  .from('invoices')
  .select('*, invoice_items(*)')
  .eq('id', invoiceId)
  .single();

// Sprawdź czy to NIE jest proforma
if (invoice.is_proforma) {
  throw new Error('Proformy nie są wysyłane do KSeF');
}

// Sprawdź czy już nie została wysłana
if (invoice.status === 'issued') {
  throw new Error('Faktura została już wysłana do KSeF');
}

// Generuj XML w formacie FA(2)
const xml = generateKSeFXML(invoice);

// Wyślij do KSeF
const ksef = await sendToKSeF(xml, invoice.my_company_id);

// Zapisz w ksef_invoices
await supabase.from('ksef_invoices').insert({
  invoice_id: invoice.id,
  ksef_reference_number: ksef.reference_number,
  invoice_type: 'issued',
  sync_status: 'synced',
  ksef_issued_at: new Date().toISOString(),
  // ... pozostałe pola z faktury
});

// Zaktualizuj status
await supabase
  .from('invoices')
  .update({ status: 'issued' })
  .eq('id', invoiceId);
```

## 📝 Podsumowanie

### ✅ Gotowe do użycia:
- Backend całkowicie przygotowany
- Funkcje numeracji działają
- Powiązania między tabelami OK

### ⚠️ Wymaga pracy:
1. **Frontend** - dodać obsługę `is_proforma` w formularzach (1-2 godziny)
2. **Konwersja** - funkcja proforma → faktura VAT (1 godzina)
3. **Widok** - przyciski i statusy (1 godzina)

### ❌ Do zrobienia później:
1. **KSeF XML** - generowanie FA(2) (4-6 godzin)
2. **Edge Function** - wysyłka do KSeF (2-3 godziny)
3. **PDF** - szablony dla proform i faktur (2-3 godziny)

## 🎯 Kolejność pracy

1. ✅ Migracja bazy (DONE)
2. Frontend - formularz + konwersja (NASTĘPNE)
3. PDF - szablony (OPCJONALNE)
4. KSeF - integracja (PÓŹNIEJ)

**Aktualny stan: 60% gotowe do wystawiania faktur proforma i VAT wewnętrznie (bez KSeF)**
**Do pełnej integracji z KSeF: ~8-12 godzin pracy**
