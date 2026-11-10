# Faktury dla jednostek JST — szkoła, przedszkole → gmina

## O co chodzi

Umowę podpisuje i wydarzenie zamawia szkoła lub przedszkole, ale płaci gmina. Na fakturze:

- **Nabywca** (Podmiot2) — gmina, z jej NIP-em i oznaczeniem **JST = 1**,
- **Odbiorca** (Podmiot3) — szkoła, z jej własnym NIP-em i **rolą 8** („jednostka podrzędna JST – odbiorca”).

Dzięki temu w KSeF fakturę widzi i gmina, i szkoła (po swoim NIP-ie).

## Jak to ustawić w CRM

1. Dodaj gminę jako zwykłą organizację (forma prawna: „Jednostka samorządu terytorialnego”, NIP gminy).
2. W karcie szkoły → **Dane do faktury** → „Na inną organizację” → wybierz gminę. Rola: „Odbiorca — jednostka podrzędna JST”.
3. Szkoła musi mieć własny NIP. Numer identyfikacji wewnętrznej KSeF zostaw pusty.

Klientem wydarzenia i stroną umowy zostaje szkoła. W karcie gminy widać listę „Jednostki rozliczane na tę organizację”.

Druga rola — **„oddział lub jednostka wewnętrzna nabywcy” (rola 2)** — jest dla firm z oddziałami: nabywca to centrala, odbiorca to oddział z numerem IDWew (NIP centrali + 5 cyfr, pole „Numer identyfikacji wewnętrznej KSeF”).

## Co dzieje się dalej

| Miejsce | Zachowanie |
| --- | --- |
| Wydarzenie → Rozliczenie | „Faktura: Gmina … (JST) — klient jako odbiorca”, gdy rozliczenie jest bezpośrednie |
| Nowa faktura z wydarzenia | nabywca = gmina, odbiorca = szkoła (rola 8, dane z karty); można zmienić ręcznie |
| Nowa faktura bez wydarzenia | po wybraniu szkoły jako nabywcy podpowiedź „Ustaw gminę jako nabywcę” |
| Umowa | „Nabywca: Gmina …” i „Odbiorca (jednostka podrzędna JST): Szkoła …” |
| KSeF | Podmiot2 z `JST=1`, Podmiot3 z `<NIP>` szkoły i `<Rola>8</Rola>`; walidacja wymaga NIP-u gminy i szkoły |
| PDF faktury | blok „Odbiorca” z dopiskiem „Jednostka podrzędna JST” |
| Aplikacja mobilna | w szczegółach wydarzenia: nabywca (JST) i odbiorca na fakturze |

Rozliczenie przez hotel / agencję / inną organizację ustawione w wydarzeniu ma pierwszeństwo przed kartą klienta.

## Zasady w bazie

Migracja `supabase/migrations/20261110100000_organization_invoice_buyer.sql`:

- `organizations.invoice_buyer_organization_id` (nabywca) i `organizations.invoice_recipient_role` (8 albo 2),
- wyzwalacz `guard_organization_invoice_buyer`: nabywca musi istnieć i mieć NIP, nie może być tą samą organizacją, nie może sam mieć nabywcy, a organizacja będąca nabywcą dla innych nie może mieć własnego; usunięcie gminy czyści powiązanie w szkołach,
- faktury: odbiorca w roli 2 albo 8 (`invoices_explicit_recipient_data`, `invoices_ksef_recipient_snapshot_shape`); `build_invoice_ksef_recipient_snapshot` dla roli 8 wymaga NIP-u jednostki i nie zapisuje IDWew, a faktura bez jawnego wyboru odbiorcy dostaje rolę z karty szkoły, gdy nabywcą jest jej gmina.

Wcześniej wystawione faktury się nie zmieniają (odbiorca jest zapisany przy fakturze).

## Formularz organizacji

Dodawanie (`/crm/contacts/new`) i edycja (karta organizacji) używają tego samego komponentu `OrganizationFormFields` i schematu Yup `organizationValidationSchema`:

- NIP — wymagany; dla Polski 10 cyfr z sumą kontrolną (prefiks „PL”, spacje i myślniki są usuwane),
- REGON — 9 albo 14 cyfr z sumą kontrolną, KRS — 10 cyfr (wymagany dla spółek, fundacji, stowarzyszeń),
- numer identyfikacji wewnętrznej KSeF — `NIP-5 cyfr`,
- kod pocztowy — `00-000` (5 cyfr bez myślnika jest poprawiane), adres, miasto — wymagane,
- e-mail, telefon (9–15 cyfr), strona (bez `https://` jest dopisywany),
- ocena 1–5, status: aktywna / nieaktywna / czarna lista,
- dane do faktury — przy „Na inną organizację” trzeba wybrać nabywcę.
