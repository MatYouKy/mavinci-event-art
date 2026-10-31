# System Powiadomień o Płatnościach KSeF

## Opis

System automatycznie monitoruje terminy płatności faktur z KSeF i wysyła powiadomienia do administratorów z uprawnieniem `ksef_manage` lub `admin`.

## Typy Powiadomień

### 1. Przypomnienie 3 dni przed terminem
- **Kategoria**: `payment_reminder_3days`
- **Kiedy**: 3 dni przed terminem płatności
- **Tytuł**: "Zbliża się termin płatności faktury"
- **Treść**: Numer faktury + data terminu płatności

### 2. Przypomnienie 1 dzień przed terminem
- **Kategoria**: `payment_reminder_1day`
- **Kiedy**: 1 dzień przed terminem płatności
- **Tytuł**: "PILNE: Jutro termin płatności faktury"
- **Treść**: Numer faktury + data terminu płatności

### 3. Płatność po terminie
- **Kategoria**: `payment_overdue`
- **Kiedy**: W dniu po terminie płatności
- **Tytuł**: "UWAGA: Płatność po terminie"
- **Treść**: Numer faktury + data terminu płatności
- **Akcja**: Automatycznie zmienia status faktury na `overdue`

## Uruchomienie Systemu

### Metoda 1: Cron Job (Zalecane)

Dodaj do crontab:

```bash
# Sprawdzanie płatności codziennie o 8:00 rano
0 8 * * * curl -X POST https://twoja-domena.com/api/cron/check-payments
```

### Metoda 2: Ręczne wywołanie funkcji

W konsoli Supabase SQL Editor:

```sql
SELECT check_and_notify_invoice_payments();
```

### Metoda 3: Edge Function (Rekomendowane dla produkcji)

Utwórz Edge Function w Supabase:

```typescript
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Wywołaj funkcję sprawdzającą płatności
  const { error } = await supabase.rpc('check_and_notify_invoice_payments');

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

Następnie użyj Supabase Cron:

```sql
-- W Supabase Dashboard > Database > Cron Jobs
select cron.schedule(
  'check-invoice-payments',
  '0 8 * * *',  -- Codziennie o 8:00
  $$
  SELECT check_and_notify_invoice_payments();
  $$
);
```

## Status Płatności

### Dostępne statusy:
- **`unpaid`** (Nieopłacona) - Domyślny status, wyświetlany pomarańczowym kolorem
- **`paid`** (Opłacona) - Faktura została opłacona, wyświetlana zielonym kolorem
- **`overdue`** (Po terminie) - Termin płatności minął, wyświetlana czerwonym kolorem

### Ręczna zmiana statusu:

W tabeli faktur w akcjach dostępne są przyciski:
- **"Oznacz jako opłaconą"** - zmienia status na `paid` i ustawia datę płatności na dzisiejszą
- **"Oznacz jako nieopłaconą"** - zmienia status z powrotem na `unpaid`

## Pola w Bazie Danych

Tabela `ksef_invoices` zawiera:

```sql
payment_due_date    date            -- Termin płatności
payment_status      text            -- Status: paid, unpaid, overdue
payment_date        timestamptz     -- Data faktycznej płatności
seller_nip          text            -- NIP sprzedawcy
buyer_nip           text            -- NIP nabywcy
seller_address      text            -- Adres sprzedawcy
buyer_address       text            -- Adres nabywcy
```

## Funkcje Pomocnicze

### update_overdue_invoices()
Aktualizuje status wszystkich faktur nieopłaconych po terminie na `overdue`:

```sql
SELECT update_overdue_invoices();
```

## Uwagi

1. Powiadomienia są wysyłane tylko raz dziennie dla każdego typu (3 dni, 1 dzień, po terminie)
2. System sprawdza czy powiadomienie nie zostało już wysłane tego samego dnia
3. Powiadomienia są widoczne w centrum powiadomień (`/crm/notifications`)
4. Link w powiadomieniu prowadzi do panelu KSeF: `/crm/settings/ksef`
5. Automatyczna zmiana statusu na `overdue` następuje w momencie wykrycia faktury po terminie
