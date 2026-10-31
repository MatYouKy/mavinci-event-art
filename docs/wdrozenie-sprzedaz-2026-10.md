# Wdrożenie: sprzedawca, przetargi, bezpieczeństwo (31.10.2026)

Gałąź: `audyt-sprzedaz-2026-10` (od commitu `4db32540` — snapshot wcześniejszych, niezacommitowanych zmian).

## 1. Przed wdrożeniem

1. Sprawdź stan bazy: `scripts/migration-status.sql` w SQL Editor, potem
   `node scripts/check-migration-status.mjs applied.txt`.
2. Nowe migracje wymagają wcześniejszych:
   `20260907120000_add_company_roles_and_brand_scope`, `20260907121000_canonical_event_visibility_by_role_and_brand`,
   `20260926120000_inquiry_sales_workflow`, `20260926195000_scope_sales_finance`, `20260529113115_create_tenders_system`,
   `20260901130000_add_business_notification_delivery_window`.

## 2. Migracje — w tej kolejności

| Plik | Co robi |
| --- | --- |
| `20261031100000_event_commercial_owner_access` | `current_employee_can_manage_event`, opiekun sprzedaży edytuje agendę i wydarzenie |
| `20261031110000_sales_lead_finance_scope` | zakres `sales_lead`: koszty, marża i prowizje własnych wydarzeń, bez faktur; nowy sprzedawca przełączony |
| `20261031120000_sales_role_tenders_equipment` | rola sprzedaży: `tenders_view`, `equipment_view` |
| `20261031130000_customer_owner_defaults` | domyślny opiekun kontaktu/organizacji, ochrona przed przejęciem |
| `20261031140000_tenders_sales_pipeline` | RLS przetargów, opiekun, zapytanie z przetargu, przypomnienia, status z etapu |
| `20261031150000_sales_my_day` | `get_my_sales_day` dla pulpitu „Mój dzień” |
| `20261031160000_offer_discount_margin_approval` | progi rabatu/marży i akceptacja ofert |
| `20261031170000_offer_followups_and_invoice_handoff` | przypomnienia o ofertach, powiadomienie finansów po akceptacji |

## 3. Edge Functions

- `send-offer-email` — wklej cały plik `index.ts` (sprawdzanie progów przed wysyłką).

## 4. Aplikacja

`yarn deploy` po migracjach i funkcji.

## 5. Konfiguracja w CRM (administrator)

1. Pracownik 5e1a3293…: rola „Sprzedaż / Opiekun klienta”; Uprawnienia → Faktury → „Sprzedaż i rentowność — bez fakturowania”
   (migracja ustawia to automatycznie, jeśli miał „Sprzedaż — własne faktury”).
2. Zespół sprzedaży, marki (działalności), konto e-mail do wysyłki ofert.
3. Przekazanie mu kontaktów i sprzedawców zewnętrznych (karta kontaktu → Opiekun).
4. Ustawienia → Progi akceptacji ofert: domyślnie rabat 10%, marża 25% — dostosuj.

## 6. Test na koncie sprzedawcy

- [ ] Pulpit pokazuje „Mój dzień” i „Moja sprzedaż”
- [ ] Przetargi widoczne; „Przypisz do mnie”; „Utwórz zapytanie” otwiera zapytanie z danymi przetargu
- [ ] Nowy kontakt ma go jako opiekuna
- [ ] Oferta z rabatem powyżej progu: wysyłka zablokowana, „Wyślij do akceptacji”, admin zatwierdza, wysyłka działa
- [ ] Wydarzenie z zapytania: edycja agendy i statusu działa
- [ ] Finanse wydarzenia: dodaje koszt (oczekujący) i planowaną prowizję; nie zatwierdza ich; „Wystaw fakturę” niedostępne
- [ ] Konto portalu sprzedawcy nie widzi `/crm/tenders` ani danych przetargów przez API

## 7. Znane ograniczenia

- Zmiany nie były uruchamiane na bazie ani budowane (zasady `.build-policy.md`) — zastosuj najpierw na kopii bazy.
- Linki z zaproszeń do wydarzeń (`/invitation/accept`) akceptują zaproszenie samym wejściem — skanery poczty mogą je „kliknąć”.
- 28 starszych wersji migracji jest zduplikowanych; `supabase db push` ich nie przyjmie (raport w CI).
- Opiekun sprzedaży (`sales_lead`) widzi prowizje własnych wydarzeń, ale nie historię ich wypłat (`event_commission_payouts`).
- Ręczna zmiana etapu zapytania z przetargu na „Oferta wysłana” oznacza przetarg jako złożony.
- Powiązanie oferty z wydarzeniem przez `link_offer_context` nadal ustala opiekuna sprzedaży (zaakceptowana oferta); funkcja ma własne kontrole marki i jednej zaakceptowanej oferty.
- `current_employee_can_view_event` sprawdza teraz także opiekuna sprzedaży — przy bardzo długich listach wydarzeń obserwuj czas odpowiedzi.
- Endpointy `/bridge/events/revalidate`, `/bridge/ksef/auth/challenge`, `/bridge/places/*`, `/bridge/gus/company` wymagają teraz zalogowania; w repozytorium nie ma wywołań spoza przeglądarki, ale sprawdź własne skrypty/integracje.
