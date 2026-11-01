# Model dostępu — Mavinci CRM, aplikacja mobilna, portal sprzedawców i strona WWW

> **Stan na 2026-11-01.** Źródła: produkcyjna baza Supabase `fuuljhhuhfojtmmfmskq` (454 tabele i 16 widoków w schemacie `public`, 1539 polityk RLS, 1332 funkcje, z czego 868 `SECURITY DEFINER`, 30 bucketów storage) oraz kod (`src/`, `mobile/`). Migracje `20261101140000_public_holidays`, `20261101150000_security_hotfixes` i `20261101151000_time_entries_guards` traktujemy jako wdrożone — ich efekt (trigger `zzzz_guard_employee_privileged_columns`, nowe polityki `ksef_invoices`/`contact_form_submissions`, odebrane funkcje, `a_guard_time_entry_rules`, tabela `public_holidays`) jest już widoczny w bazie produkcyjnej, choć wersje nie są zapisane w `supabase_migrations.schema_migrations`. Model finansów opisujemy **docelowo** (migracja `20261101165000_finance_company_access` — wdrożona w produkcji 01.11.2026, uzupełnienie `20261101171000`). Poprawki P0 (sekcja 6.1) — migracja `20261101190000_security_p0` (do uruchomienia w SQL Editorze; statusy poniżej opisują stan po jej wdrożeniu), opcjonalnie `20261101192000_internal_function_secret_header`.
>
> **Ten plik jest źródłem prawdy o tym, kto widzi i zmienia jakie dane.** Każda nowa tabela, funkcja, bucket, uprawnienie lub ekran (CRM i mobile) wymaga aktualizacji tego pliku w tym samym PR (sekcja 7).

## Spis treści
1. [Zasady](#1-zasady) · 2. [Profile](#2-profile) · 3. [Domeny danych](#3-domeny-danych) · 4. [Funkcje (RPC)](#4-funkcje-rpc) · 5. [Interfejs](#5-interfejs) · 6. [Lista poprawek](#6-lista-poprawek) · 7. [Jak dodawać nowe dane](#7-jak-dodawać-nowe-dane)

### Podsumowanie stanu (tabele i widoki: 470)

| ✅ zgodne | ⚠️ za szeroko | ❌ krytyczne | ℹ️ do decyzji |
|---|---|---|---|
| 316 (w tym 1 naprawione w 20261101150000) | 111 (w tym 32 ⚠️* — finanse firmy, wdrożone w 20261101165000) | 38 | 5 |

**Po `20261101190000_security_p0`:** funkcje `SECURITY DEFINER` wykonywalne przez anon: 6 (wyjątki z 4.5, wcześniej 470 łącznie z funkcjami triggerów); anon nie zapisuje treści strony, powiadomień, osób kontaktowych wydarzeń ani pojazdów i nie czyta tabeli `employees`; konto portalu sprzedawcy odcięte od tabel bez logiki portalu (P0-4). Liczby w tabelach poniżej to stan audytu sprzed P0, statusy wierszy — po P0.

**Storage:** 30 bucketów — ✅ 14 · ⚠️ 10 (w tym 2 ⚠️*) · ❌ 6. **Funkcje `SECURITY DEFINER` wywoływalne przez API:** 523 (319 także anon) — z kontrolą w treści: 390; bez kontroli, nieszkodliwe: 45; **bez kontroli, zapisujące lub ujawniające dane: 88** (❌ 26, ⚠️ 62).

### Legenda

**Status:** ✅ zgodne z modelem · ⚠️ za szeroko (ktoś widzi/zmienia więcej, niż powinien) · ⚠️* za szeroko tylko do czasu wdrożenia modelu finansów `20261101165000` (wdrożone 01.11.2026) · ❌ krytyczne (anon, portal sprzedawcy albo każdy pracownik ma dostęp do danych wysokiej wrażliwości lub może je zmieniać/usuwać) · ℹ️ do decyzji właściciela / porządki.

**Wrażliwość:** wysoka — pieniądze firmy, płace i stawki, dane osobowe szczególne (PESEL, nr dowodu, zdrowie), sekrety (hasła, tokeny); średnia — dane klientów i pracowników, ceny i koszty, dokumenty; niska — katalogi, słowniki, treści publiczne.

**Skróty w kolumnie „Docelowo”** (nazwy w nawiasach to funkcje, które mają to egzekwować):

| Skrót | Znaczenie |
|---|---|
| ADM | administrator CRM — `current_employee_is_crm_admin()` (rola/poziom `admin` albo uprawnienie `admin`, nie konto portalu) |
| EMP | każdy aktywny pracownik CRM, bez kont portalu sprzedawcy — `current_crm_employee_id() IS NOT NULL` ∧ `NOT current_session_is_seller_portal()` |
| OWN | własny rekord — `employee_id = current_employee_id()` |
| P(x) | uprawnienie `x` w `employees.permissions` (manage zawiera view) |
| EV(v) / EV(m) | `current_employee_can_view_event(event_id)` / `current_employee_can_manage_event(event_id)` |
| EVC(v) / EVC(m) | finanse wydarzenia — `can_view_event_commercials(event_id, false/true)`: globalne `finances_view`/`finances_manage` + widoczność wydarzenia |
| F≥poziom | poziom finansów w działalności `my_company_id` z `employees.finance_company_access`: none < sales < invoices < invoices_issue < finance_view < finance_manage (admin = finance_manage wszędzie) |
| SALES | właściciel sprzedaży — `sales_can_manage_document/offer/calculation()`, `sales_lead_owns_event()` |
| INQ(v/m) | `can_view_inquiry()` / `can_manage_inquiry()` (+ zespół zapytania) |
| PERS(v/m) | `personnel_can_access(false/true)` (personnel_view / personnel_manage) |
| SP | konto portalu sprzedawcy — `current_sales_partner_id()` |
| PUB | anon (strona WWW, klucz publiczny) |
| SVC | tylko service_role / funkcje serwera (brak dostępu z API) |

**Kolumna „Obecnie (RLS)”** — skrót polityk z bazy: `R:` odczyt (SELECT/ALL), `W:` zapis (INSERT/UPDATE/DELETE/ALL; `[IUD]` = których operacji dotyczy), `∨` — alternatywne polityki (wystarczy jedna), przecinek — warunki w jednej polityce, `A/B` — warunek łączony (uprawnienie i/lub własny rekord). `AUTH` = każdy zalogowany (**także konto portalu sprzedawcy**, o ile nie ma `−SP`), `PUB` = także anon, `(filtr)` = tylko np. `is_visible/is_active`, `warunek` = wiersz nadrzędny musi być widoczny (dziedziczy RLS rodzica), `self` = tożsamość wywołującego, `finVIEW/finMANAGE` = `finance_can_view()/finance_can_manage()`, `firma` = `finance_company_visible()`/`current_employee_can_access_company()`. `ogr.:` — polityki RESTRICTIVE (muszą być spełnione zawsze): `−SP` wyklucza portal sprzedawcy, `−sprzedawca` wyklucza zakres finansów „sales”, `zakres` = `*_own_only` (`crm_record_id_scope_allows`), `firma` = zakres działalności, `katalogSprzętu` = `can_write_equipment_catalog()`.

## 1. Zasady

### 1.1 Reguły biznesowe (od właściciela)

1. **Fakturowanie zostaje u administratora.** Wystawianie i korekty faktur, wysyłka do KSeF, numeracja — administrator (poziom `invoices_issue`/`finance_manage` nadawany świadomie, per działalność).
2. **Sprzedawca jest właścicielem swoich ofert, kalkulacji i finansów swojej sprzedaży** (wartości i koszty swoich wydarzeń, prowizje, własne faktury sprzedaży — poziom `sales`). Opiekuje się sprzedawcami zewnętrznymi (portal).
3. **Zwykli pracownicy** — technicy, DJ-e, magazyn, freelancerzy, wykonawcy zewnętrzni — **nie widzą finansów** (budżety, koszty, stawki, marże, faktury, płace) ani tematów, które mają być przed nimi ukryte (dane osobowe klientów i współpracowników poza tym, co potrzebne do realizacji przypisanego wydarzenia).
4. **Aplikacja mobilna nigdy nie pokazuje więcej niż CRM tej samej osobie.** Każde ustawienie (uprawnienie, zakres danych, firmy, finanse, zakładki wydarzenia) działa w mobile tak samo; jeśli ekran go nie obsługuje — ukrywa dane, a nie pokazuje więcej.
5. **Reguły wymusza baza (RLS, funkcje), nie interfejs.** Aplikacja mobilna, portal sprzedawcy i każdy, kto zna publiczny klucz strony, rozmawiają z bazą bezpośrednio (PostgREST). Ukrycie przycisku lub zakładki nie chroni danych.
6. **Finanse firmy liczone per działalność** (model docelowy, poniżej).

### 1.2 Jak liczony jest dostęp

| Element | Gdzie | Działanie |
|---|---|---|
| Tożsamość | `auth.uid()` → `employees.id` lub `employees.auth_user_id` | `current_employee_id()`, `current_crm_employee_id()`, `current_invoice_employee_id()` (tylko aktywny), `sales_employee_id()`. Brak rekordu pracownika = brak dostępu do CRM UI (layout `src/app/(crm)/crm/layout.tsx`), ale **nie** do API |
| Administrator | `role='admin'` ∨ `access_level='admin'` ∨ `'admin' ∈ permissions` | `current_employee_is_crm_admin()`, `invoice_finance_is_admin()`; uwaga: starsze helpery liczą inaczej (`is_admin(uid)` — tylko `auth_user_id` i bez `access_level`; `is_crm_admin()` — bez uprawnienia `admin`) — nowe polityki używają `current_employee_is_crm_admin()` |
| Uprawnienia | `employees.permissions text[]` | `modul_view`, `modul_manage`, `modul_create` + specjalne: `inquiries_view_own/pool/team/all`, `inquiries_manage_own/all`, `inquiries_assign`, `*_own_only`, `events_view_planning`, `events_view_operational`, `calendar_view_accepted_only`, `time_tracking_view_own`, `personnel_view/manage`, `absences_manage`, `tenders_view`, `mavinci_live_*`, `website_edit`, `page_manage`, `webhooks_*`. Katalog: `src/lib/permissionCatalog.ts`. W UI `manage ⇒ view`; w RLS — zależnie od polityki |
| Pakiety (profile) | `access_levels.default_permissions`, `event_tabs`, `contact_tabs` | Przy zmianie `employees.access_level_id` trigger nadpisuje uprawnienia pakietem; `role_permissions_inherited` mówi, czy konto korzysta z pakietu (dziś 2 z 13 aktywnych — reszta ma uprawnienia ustawione ręcznie). `event_tabs`/`contact_tabs` to **wyłącznie UI** (zakładki), baza ich nie zna |
| Zakres rekordów | uprawnienia `events_own_only`, `offers_own_only`, `contracts_own_only` | `crm_record_scope_limited(modul)` → `crm_record_owned()` (autor, opiekun kontaktu/organizacji, sprzedawca, powiązane wydarzenie/oferta). Polityki RESTRICTIVE `crm_record_visibility_guard` i `crm_parent_scope_*` na tabelach podrzędnych |
| Działalności (firmy) | `employees.company_access_mode` (`all`/`selected`) + `my_company_ids` | `employee_can_access_company()`, `current_employee_can_access_company()`; RESTRICTIVE „… respect employee brand scope” na `events`/`offers`/`contracts`, `my_companies`. Dziś wszyscy aktywni mają `all` |
| Finanse firmy — **docelowo** | `employees.finance_company_access` (per `my_company_id`) | none < **sales** (tylko własna sprzedaż) < **invoices** (podgląd faktur, KSeF, dokumentów kosztowych) < **invoices_issue** (wystawianie) < **finance_view** (cała księgowość firmy tylko do odczytu: bank, uzgodnienia, deklaracje ZUS/US) < **finance_manage**. Administrator = finance_manage wszędzie. Globalne `finances_view/finances_manage` = **tylko wartości wydarzeń** (budżet, koszty, prowizje) wydarzeń, które osoba widzi |
| Finanse firmy — stan obecny | `finance_access_scope` (`inherit/sales/sales_lead`), `invoice_company_permissions` (jsonb), globalne uprawnienia | `invoice_finance_scope()` → `company`/`sales`/`none`; `finance_can_view()` = „company” — daje je **każde** globalne `finances_view`, `finances_manage`, `invoices_view`, `invoices_manage`, `ksef_manage`; `finance_company_visible()` dodaje zakres firm. Zastąpione migracją `20261101165000` (wdrożona 01.11.2026) |
| Finanse wydarzenia | `can_view_event_commercials()`, `sales_lead_owns_event()`, `sales_commission_visible()`, `realization_operational_only()` | Admin, autor wydarzenia, globalne finances/contracts/invoices; sprzedawca — swoje; kierownik realizacji bez uprawnień handlowych — bez danych rozliczeniowych |
| Wydarzenia | `current_employee_can_view_event()` | admin; magazyn (`can_receive_warehouse_event`); kierownik realizacji; sprzedawca wydarzenia; autor; przypisanie `employee_assignments.status='accepted'`; `events_view_planning`/`events_view_operational`; `events_manage`/`calendar_manage` = wszystkie; potem zakres firm i `*_own_only`. Kierowca — `is_event_driver()`. Samo `events_view` = tylko własne/przypisane |
| Portal sprzedawcy | `sales_partner_profiles.portal_auth_user_id` (3 aktywne konta) | `current_session_is_seller_portal()`, `current_sales_partner_id()`. **Konto portalu jest zwykłym `authenticated`** — każda polityka `TO authenticated USING (true)` wpuszcza je, jeśli tabela nie ma RESTRICTIVE `seller_portal_deny_*`. Dane portalu — przez funkcje `seller_*`/`save_seller_portal_*` |
| Anon / strona WWW | klucz publiczny w przeglądarce | rola `anon` ma GRANT ALL na większości tabel i widoków (domyślne uprawnienia Supabase) — chroni RLS. Od `20261101190000_security_p0` EXECUTE ma tylko na 6 funkcjach `SECURITY DEFINER` (lista w 4.5), a nowe funkcje nie dostają EXECUTE dla PUBLIC/anon automatycznie (`ALTER DEFAULT PRIVILEGES`). Pracownicy strony „Zespół” — widok `website_team_members` |
| Storage | `storage.objects` + flaga `public` bucketu | bucket publiczny = plik pobieralny po URL **bez RLS**; polityki dotyczą tylko API |
| Aplikacja mobilna | `mobile/src/lib/permissions.ts`, `PermissionGate` | czyta bazę tym samym kontem → widzi dokładnie to, co RLS; filtry UI muszą odpowiadać CRM |

## 2. Profile

Pakiety z `access_levels` (stan produkcyjny; „Akt.” = aktywni pracownicy z tym profilem). Tabela pokazuje **docelowy** zakres danych dla pakietu bez indywidualnych dodatków. Oznaczenia: ✓ pełny dostęp do domeny · „podgląd” · „swoje” (własne rekordy/sprzedaż) · „przypisane” (tylko wydarzenia, do których osoba jest przypisana i zaakceptowała) · „katalog” (imię, nazwisko, kontakt służbowy) · „wg poziomu” (finance_company_access per działalność) · ✗ brak.

| Profil (`slug`) | Akt. | Fin. firmy | Fin. wydarzeń | Kadry/płace | Czas pracy | Dane prac. | Klienci | Zapytania/sprzedaż | Oferty/umowy | Wydarzenia | Sprzęt/flota | Komunikacja | WWW/marketing | System |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Administrator (`admin`) | 1 | ✓ finance_manage wszędzie | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (kontrola skrzynek) | ✓ | ✓ |
| Zarząd / Dyrektor operacyjny (`operations-director`) | 0 | wg poziomu (pakiet ma `invoices_view` → docelowo poziom ustawiany per firma) | podgląd | ✗ | ✓ zarządzanie | podgląd profili | ✓ | ✓ (wszystkie, przydział) | ✓ | ✓ wszystkie | ✓ | ✓ (przydział wiadomości) | podgląd kampanii | ✗ |
| Sprzedaż / Opiekun klienta (`sales-specialist`) | 1 | swoje (poziom `sales`) | swoje | ✗ | swoje | katalog | ✓ zarządzanie (opiekun) | swoje + pula, przydział | ✓ (swoje przy `*_own_only`) | swoje (utworzone/sprzedane) | podgląd | przypisane skrzynki | ✗ | ✗ |
| Event Manager / PM (`event-manager`) | 0 | ✗ | podgląd (wszystkich wydarzeń — ma `events_manage`) | ✗ | ℹ️ dziś wszystkich (`time_tracking_view`) | podgląd profili | podgląd | ✗ | podgląd | ✓ wszystkie | podgląd | przypisane skrzynki, czat | ✗ | ✗ |
| Finanse / Księgowość (`finance-accounting`) | 0 | wg poziomu (docelowo finance_manage w wybranych firmach) | ✓ | ℹ️ D1 | swoje | katalog | podgląd | ✗ | podgląd | podgląd operacyjnych | ✗ | swoje | ✗ | podgląd baz danych |
| Marketing (`marketing-specialist`) | 0 | ✗ | ✗ | ✗ | swoje | katalog | podgląd | ✗ | ✗ | ✗ | ✗ | przypisane skrzynki, czat | ✓ | ✗ |
| Magazyn / Logistyka sprzętu (`warehouse`) | 2 | ✗ | ✗ | ✗ | swoje (⚠️ pakiet ma `time_tracking_view`) | katalog | ✗ | ✗ | ✗ | przypisane + planowanie | ✓ zarządzanie | czat | ✗ | ✗ |
| Magazyn (`mag`) | 0 | ✗ | ✗ | ✗ | swoje (⚠️ j.w.) | katalog | ℹ️ pakiet ma `contacts_view` | ✗ | ✗ | przypisane (tylko zaakceptowane) | ✓ zarządzanie | ✗ | ✗ | ✗ |
| Technik / Realizator (`event-technician`) | 1 | ✗ | ✗ | ✗ | swoje (⚠️ j.w.) | katalog | ✗ | ✗ | ✗ | przypisane | podgląd | czat | ✗ | ✗ |
| Podwykonawca / Freelancer (`external-contractor`) | 0 | ✗ | ✗ | ✗ | swoje (⚠️ j.w.) | katalog | ✗ | ✗ | ✗ | przypisane | ✗ | czat | ✗ | ✗ |
| Manager (`manager`) — stary | 1 | ✗ (ℹ️ osoba ma dodatkowo `invoices_manage`) | ✗ | ✗ | swoje | katalog | ✗ | ✗ | ✗ | ✓ wszystkie | ✓ | ✗ | ✗ | ✗ |
| Pracownik (`employee`), DJ (`dj`), Technik (`technician`), Wykonawca zewnętrzny (`contractor`) — stare, puste pakiety | 3 / 2 / 1 / 1 | ✗ | ✗ | ✗ | swoje | katalog | ✗ | ✗ | ✗ | przypisane | ✗ | ✗ | ✗ | ✗ |
| **Konto portalu sprzedawcy** (nie pracownik) | 3 | ✗ | tylko przez RPC portalu | ✗ | ✗ | ✗ | swoi klienci (`sales_partner_clients`) | swoje oferty | swoje oferty i dokumenty | ✗ | ✗ | rozmowa z opiekunem | ✗ | ✗ |
| **Anon (strona WWW)** | — | ✗ | ✗ | ✗ | ✗ | pola strony „Zespół” | ✗ | formularz kontaktowy (tylko INSERT) | ✗ | odpowiedź na zaproszenie (token) | ✗ | ✗ | treści strony (odczyt) | ✗ |

**Uwagi do pakietów i kont (stan produkcyjny, bez danych osobowych):**

- 11 z 13 aktywnych kont ma `role_permissions_inherited = false` — o dostępie decydują uprawnienia indywidualne, nie pakiet. Np. konto z profilem „Wykonawca zewnętrzny” ma 22 indywidualne uprawnienia (m.in. `clients_manage`, `events_manage`, `offers_manage`, `fleet_manage`, `time_tracking_manage`) — ℹ️ D6.
- `time_tracking_view` w bazie oznacza **wgląd w czas pracy wszystkich osób, łącznie ze stawką godzinową** (`time_entries.hourly_rate`). Jest w pakietach Technik/Realizator, Magazyn (oba), Freelancer, Event Manager; dziś ma je 6 aktywnych kont (m.in. technicy i magazyn). Docelowo zwykli pracownicy: `time_tracking_view_own` — ℹ️ D5 (dla Event Managera).
- Globalne `invoices_view`/`invoices_manage` (Zarząd, Finanse, konto Managera) dają dziś „widok firmy” we wszystkich działalnościach (bank, deklaracje) — po `20261101165000` (wdrożone) dostęp nadaje wyłącznie poziom per firma; konto Managera: finance_manage w NASTROJOWO.
- Profile „Magazyn” (`mag`) i „Magazyn / Logistyka sprzętu” (`warehouse`) dublują się — ℹ️ porządki.
- Administrator ma `role='admin'`; pakiet „Administrator” nie zawiera uprawnienia `admin` — działa, bo helpery sprawdzają też rolę.

## 3. Domeny danych

Każda tabela i widok schematu `public` (470) przypisane do domeny. Kolumna „Docelowo” to reguła, którą ma egzekwować baza; „Obecnie” — skrót aktualnych polityk RLS z produkcji (po migracjach z 1.11.2026). RLS jest włączone na wszystkich 454 tabelach; 24 tabele nie mają żadnej polityki (= dostęp tylko dla service_role). Wszystkie 16 widoków ma `security_invoker = true` (dziedziczą RLS tabel bazowych), choć 11 z nich ma zbędny GRANT SELECT dla anon. Kolumny z ograniczonymi uprawnieniami: `marketing_integrations.credentials_encrypted` (bez SELECT), `personnel_people` (część kolumn bez UPDATE).

### 3.1 Finanse firmy

Docelowo: poziom finansów w działalności (`finance_company_access[my_company_id]`). Faktury, KSeF, dokumenty kosztowe: F≥invoices; wystawianie: F≥invoices_issue (w praktyce administrator — fakturowanie zostaje u admina); bank, uzgodnienia, księgowość, ZUS/US: F≥finance_view (odczyt) / F=finance_manage (zmiany). Sprzedawca (poziom sales): tylko własna sprzedaż. Dziś polityki opierają się na `finance_can_view()/finance_can_manage()` + `finance_company_visible()`, gdzie „widok firmy” daje każde globalne finances_view/finances_manage/invoices_view/invoices_manage/ksef_manage — dlatego ⚠️* (wdrożone w `20261101165000_finance_company_access` — migracja przepisała te funkcje).

*40 obiektów: ✅ 3 · ⚠️ 36 · ❌ 1 · ℹ️ 0*

| Tabela | Wrażl. | Docelowo | Obecnie (RLS) | Status / uwagi |
|---|---|---|---|---|
| `accounting_delivery_attempts` | wysoka | R: F≥finance_view<br>W: SVC (claim/complete_accounting_delivery) | R: finVIEW,firma · W: ✗ | ⚠️* |
| `accounting_document_followups` | wysoka | R: F≥finance_view<br>W: F=finance_manage (RPC) | R: finVIEW,firma · W: ✗ · ogr.: −sprzedawca | ⚠️* |
| `accounting_month_handoffs` | wysoka | R: F≥finance_view<br>W: F=finance_manage | R: finMANAGE,firma ∨ finVIEW,firma · W: finMANAGE,firma · ogr.: −sprzedawca | ⚠️* |
| `bank_ai_reconciliation_reports` | wysoka | R: F≥finance_view<br>W: F=finance_manage | R: can_view_invoices,can_view_personnel_contracts,can_view_invoice_company,self · W: can_manage_invoices,can_manage_personnel_contracts,can_manage_invoice_company,self[UD] ∨ self,can_manage_invoices,can_manage_personnel_contracts,can_manage_invoice_company[I] · ogr.: −sprzedawca | ⚠️* dziś czyta też can_view_invoices/can_view_personnel_contracts (poziom faktur widzi raporty bankowe) |
| `bank_counterparty_mapping_templates` | wysoka | R: F≥finance_view<br>W: F=finance_manage | R: finMANAGE,firma ∨ finVIEW,firma · W: finMANAGE,firma · ogr.: −sprzedawca | ⚠️* |
| `bank_reconciliation_proposals` | wysoka | R: F≥finance_view<br>W: SVC/RPC | R: finVIEW,firma · W: ✗ · ogr.: −sprzedawca | ⚠️* |
| `bank_reconciliation_runs` | wysoka | R: F≥finance_view<br>W: SVC/RPC | R: finVIEW,firma · W: ✗ · ogr.: −sprzedawca | ⚠️* |
| `bank_statements` | wysoka | R: F≥finance_view<br>W: F=finance_manage | R: ADM∨P(bank_statements_manage) ∨ finMANAGE,firma ∨ ADM∨P(bank_statements_view,bank_statements_manage) ∨ finVIEW,firma · W: ADM∨P(bank_statements_manage) ∨ finMANAGE,firma · ogr.: −sprzedawca, −SP | ⚠️ stare polityki P(bank_statements_view/manage) omijają zakres firm (dziś nikt nie ma tych uprawnień) |
| `bank_transaction_invoice_matches` | wysoka | R: F≥finance_view<br>W: F=finance_manage (RPC) | R: finVIEW,firma · W: ✗ · ogr.: −sprzedawca | ⚠️* zapis tylko przez RPC — ale match_bank_transaction_to_documents jest wykonywalna przez anon bez kontroli (sekcja 4) |
| `bank_transaction_supporting_documents` | wysoka | R: F≥finance_view<br>W: F=finance_manage | R: finMANAGE,firma ∨ finVIEW,firma · W: finMANAGE,firma · ogr.: −sprzedawca | ⚠️* |
| `bank_transactions` | wysoka | R: F≥finance_view<br>W: F=finance_manage | R: ADM∨P(bank_statements_manage) ∨ finMANAGE,firma ∨ ADM∨P(bank_statements_view,bank_statements_manage) ∨ finVIEW,firma · W: ADM∨P(bank_statements_manage) ∨ finMANAGE,firma · ogr.: −sprzedawca | ⚠️ jak bank_statements (stare uprawnienia bez zakresu firm) |
| `bank_transactions_import_archive` | wysoka | R: SVC<br>W: SVC | brak polityk → tylko SVC | ✅ |
| `event_invoice_company_sources` | średnia | R: SVC<br>W: SVC | brak polityk → tylko SVC | ✅ |
| `external_invoices` | wysoka | R: F≥invoices<br>W: F=finance_manage | R: finMANAGE,firma ∨ finVIEW,firma ∨ can_read_external_invoices · W: finMANAGE,firma ∨ can_manage_external_invoices · ogr.: zakres, −sprzedawca | ⚠️ can_read_external_invoices() = globalne finances_view/invoices_view, bez zakresu firm |
| `finance_categories` | niska | R: F≥invoices<br>W: F=finance_manage | R: finMANAGE ∨ finVIEW · W: finMANAGE | ⚠️* słownik |
| `finance_declaration_files` | wysoka | R: F≥finance_view<br>W: F=finance_manage (RPC) | R: finVIEW,firma · W: ✗ · ogr.: −sprzedawca | ⚠️* |
| `finance_declaration_lines` | wysoka | R: F≥finance_view<br>W: F=finance_manage (RPC) | R: finVIEW,firma · W: ✗ · ogr.: −sprzedawca | ⚠️* |
| `finance_declaration_payments` | wysoka | R: F≥finance_view<br>W: F=finance_manage (RPC) | R: finVIEW,firma · W: ✗ · ogr.: −sprzedawca | ⚠️* |
| `finance_declarations` | wysoka | R: F≥finance_view<br>W: F=finance_manage (RPC) | R: finVIEW,firma · W: ✗ · ogr.: −sprzedawca | ⚠️* |
| `financial_entries` | wysoka | R: F≥finance_view<br>W: F=finance_manage | R: finMANAGE,firma ∨ finVIEW,firma · W: finMANAGE,firma · ogr.: zakres, −sprzedawca | ⚠️* |
| `financial_payment_review_issues` | wysoka | R: F≥finance_view<br>W: F=finance_manage | R: finVIEW,firma · W: finMANAGE,firma[U] · ogr.: −sprzedawca | ⚠️* |
| `financial_source_categories` | niska | R: F≥finance_view<br>W: F=finance_manage | R: finMANAGE ∨ finVIEW · W: finMANAGE · ogr.: −sprzedawca | ⚠️* |
| `invoice_history` | wysoka | R: F≥invoices (sprzedawca: własne)<br>W: F≥invoices_issue | R: can_view_invoice · W: can_manage_invoice[I] | ⚠️* |
| `invoice_items` | wysoka | R: F≥invoices (sprzedawca: własne)<br>W: F≥invoices_issue | R: can_manage_invoice ∨ can_view_invoice · W: can_manage_invoice | ⚠️* |
| `invoice_order_items` | wysoka | R: F≥invoices (sprzedawca: własne)<br>W: F≥invoices_issue | R: can_manage_invoice ∨ can_view_invoice · W: can_manage_invoice | ⚠️* |
| `invoice_settings` | średnia | R: F≥invoices_issue<br>W: ADM/F=finance_manage | R: P(finances_manage) · W: P(finances_manage)[U] | ⚠️* globalne finances_manage |
| `invoice_settlements` | wysoka | R: F≥invoices<br>W: F≥invoices_issue | R: can_manage_invoice ∨ can_view_invoice · W: can_manage_invoice | ⚠️* |
| `invoice_source_links` | wysoka | R: F≥invoices<br>W: F≥invoices_issue | R: can_manage_invoice ∨ can_view_invoice · W: can_manage_invoice | ⚠️* |
| `invoices` | wysoka | R: F≥invoices (sprzedawca: tylko własne)<br>W: F≥invoices_issue (fakturuje admin — reguła biznesowa) | R: can_view_invoice_row · W: can_manage_invoice_company[UD] ∨ can_manage_invoice_company,self[I] · ogr.: zakres, faktury, −SP | ⚠️* can_view_invoice_row/can_manage_invoice_company + invoice_company_permissions; pusty JSON = wszystkie firmy |
| `invoices_with_relations` *(widok)* | wysoka | R: jak invoices<br>W: — | widok `security_invoker` — RLS tabel bazowych | ⚠️* widok security_invoker → RLS invoices |
| `ksef_credentials` | wysoka | R: ✗ (tylko SVC / Edge Function ksef-api)<br>W: ADM przez RPC | R: kolumny bez sekretów — finance_company_manageable (token, tokeny dostępu/odświeżania/sesji, klucz i hasło certyfikatu: tylko SVC) · W: finance_company_manageable[IU] · ogr.: −sprzedawca | ✅ P0-8 (`20261101190000_security_p0`): sekrety bez SELECT dla authenticated (uprawnienia kolumn); odczyt tokenu — bridge KSeF i Edge Functions kluczem service_role; CRM czyta tylko pola stanu |
| `ksef_invoice_notification_events` | średnia | R: SVC<br>W: SVC | R: ✗ · W: ✗ · ogr.: −sprzedawca | ✅ tylko polityka restrykcyjna → nikt z API |
| `ksef_invoice_payments` | wysoka | R: F≥invoices<br>W: F=finance_manage | R: finMANAGE,firma ∨ finVIEW,firma · W: finMANAGE,firma · ogr.: −sprzedawca | ⚠️* |
| `ksef_invoices` | wysoka | R: F≥invoices (sprzedawca: własne)<br>W: F≥invoices_issue / SVC (synchronizacja) | R: ADM∨P(invoices_view,invoices_manage) ∨ invoice_finance_scope,can_view_invoice · W: finMANAGE,firma[D] ∨ ADM∨P(invoices_manage)[IU] · ogr.: sprzedawca | ⚠️* P(invoices_view/manage) bez zakresu firm; DELETE naprawione w 20261101150000 |
| `ksef_local_sales_sync_issues` | średnia | R: F≥invoices<br>W: SVC | R: firma · W: ✗ | ⚠️* |
| `ksef_sync_log` | średnia | R: F≥invoices<br>W: SVC | R: ADM∨P(invoices_view,invoices_manage) · W: AUTH[I] · ogr.: −sprzedawca | ⚠️ INSERT: każdy zalogowany (także portal sprzedawcy) |
| `legacy_bank_transaction_match_audit` | wysoka | R: F≥finance_view<br>W: SVC | R: finMANAGE · W: ✗ · ogr.: −sprzedawca | ⚠️* |
| `monthly_financial_summaries` | wysoka | R: F≥finance_view<br>W: SVC (update_monthly_summary) | R: ADM∨P(ksef_manage) · W: ADM∨P(ksef_manage) · ogr.: −sprzedawca | ⚠️ stare uprawnienie ksef_manage, bez zakresu firm |
| `saldeo_delivery_log` | wysoka | R: F≥finance_view<br>W: F=finance_manage | R: finMANAGE,firma ∨ finVIEW,firma · W: finMANAGE,firma · ogr.: −sprzedawca | ⚠️* |
| `subscriptions` | średnia | R: F≥invoices<br>W: F=finance_manage | R: can_read_external_invoices · W: can_manage_external_invoices | ⚠️* can_read_external_invoices() bez zakresu firm |

### 3.2 Finanse wydarzeń

Docelowo: wartości finansowe wydarzenia (budżet, koszty, prowizje, kasa, harmonogram płatności) widzi osoba z globalnym `finances_view`, która widzi to wydarzenie (`can_view_event_commercials(event_id,false)`); zmienia `finances_manage` (`…,true`). Sprzedawca — swoje wydarzenia (`sales_lead_owns_event()`, wpisy „pending”). Technik, DJ, magazyn, freelancer: ✗.

*12 obiektów: ✅ 9 · ⚠️ 3 · ❌ 0 · ℹ️ 0*

| Tabela | Wrażl. | Docelowo | Obecnie (RLS) | Status / uwagi |
|---|---|---|---|---|
| `event_billing_contacts` | średnia | R: EVC(v)<br>W: EVC(m) | R: EVC · W: EVC · ogr.: zakres | ✅ |
| `event_cash_transactions` | wysoka | R: EVC(v) ∨ SALES(własne)<br>W: EVC(m) | R: P(finances_manage) ∨ sprzedawca(własne) · W: P(finances_manage) · ogr.: zakres, −sprzedawca | ⚠️ finances_manage widzi kasę wszystkich wydarzeń (brak EV(v)) |
| `event_commission_payouts` | wysoka | R: EVC(v) ∧ F≥finance_view ∨ sprzedawca (własne)<br>W: SVC/RPC | R: commission_settlement_can_access ∨ sales_commission_visible · W: ✗ · ogr.: zakres, prowizje | ⚠️* commission_settlement_can_access() opiera się na finance_can_view() |
| `event_commissions` | wysoka | R: EVC(v) ∨ SALES(własne)<br>W: EVC(m) ∨ SALES(własne, pending) | R: P(finances_manage) ∨ sprzedawca(własne) ∨ sales_commission_visible ∨ P(finances_manage,finances_view) · W: P(finances_manage) ∨ sprzedawca(własne) · ogr.: zakres, prowizje, −SP | ⚠️ P(finances_view/manage) bez EV(v) — widać prowizje wszystkich wydarzeń |
| `event_cost_categories` | niska | R: EMP<br>W: P(finances_manage) | R: P(finances_manage) ∨ AUTH · W: P(finances_manage) | ✅ słownik; czyta też portal sprzedawcy |
| `event_costs` | wysoka | R: EVC(v) ∨ SALES(własne)<br>W: EVC(m) ∨ SALES(własne) | R: ADM∨P(finances_manage) ∨ sprzedawca(własne) · W: P(finances_manage) ∨ sprzedawca(własne) · ogr.: zakres, −sprzedawca | ✅ węziej niż docelowo: finances_view nie widzi kosztów (ℹ️) |
| `event_invoice_settlements` *(widok)* | wysoka | R: EVC(v) ∧ F≥invoices<br>W: — | widok `security_invoker` — RLS tabel bazowych | ✅ widok security_invoker |
| `event_payment_milestones` | średnia | R: EVC(v)<br>W: EVC(m) | R: EVC · W: EVC · ogr.: zakres | ✅ |
| `event_settlement_group_members` | średnia | R: EVC(v)<br>W: RPC | R: EVC · W: ✗ · ogr.: zakres | ✅ |
| `event_settlement_groups` | średnia | R: EVC(v)<br>W: RPC | R: EVC · W: ✗ · ogr.: zakres | ✅ |
| `invoice_event_allocations` | średnia | R: EVC(v)<br>W: SVC/RPC | R: EVC · W: ✗ · ogr.: zakres, faktury | ✅ |
| `seller_owner_profit_reviews` | wysoka | R: ADM/F=finance_manage (RPC)<br>W: RPC | R: ✗ · W: ✗ · ogr.: zakres | ✅ tylko polityki restrykcyjne → dostęp wyłącznie przez RPC |

### 3.3 Kadry i wynagrodzenia

Docelowo: umowy, stawki, rozliczenia personelu — `personnel_can_access(false/true)` (personnel_view/manage) albo właściciel umowy (`personnel_owns_contract`, `personnel_can_read_contract`). Płace i stawki pracowników (D1, decyzja 01.11.2026): odczyt ADM ∨ personnel_view ∨ personnel_manage, zapis ADM ∨ personnel_manage, pracownik — własny wiersz; finances_* i employees_manage nic tu nie nadają (`20261101190000_security_p0`).

*15 obiektów: ✅ 13 · ⚠️ 1 · ❌ 0 · ℹ️ 1*

| Tabela | Wrażl. | Docelowo | Obecnie (RLS) | Status / uwagi |
|---|---|---|---|---|
| `compensation_settings` | wysoka | R: ADM ∨ PERS(v)<br>W: ADM | R: compensation_can_access (ADM ∨ PERS(v)) · W: compensation_can_access(admin_only) — ADM[U] · ogr.: −sprzedawca | ✅ D1 (`20261101190000_security_p0`) |
| `employee_compensation` | wysoka | R: OWN ∨ ADM ∨ PERS(v)<br>W: ADM ∨ PERS(m) | R: compensation_can_access (ADM ∨ PERS(v)) ∨ OWN · W: ✗ (RPC save_employee_compensation: ADM ∨ PERS(m)) · ogr.: −sprzedawca | ✅ D1 (`20261101190000_security_p0`); własny wiersz nie dla zakresu finansów „sales” (restrykcyjna sales_finance_private zostaje) |
| `personnel_contract_documents` | wysoka | R: PERS(v) ∨ OWN (umowa)<br>W: PERS(m) | R: personnel_can_read_contract · W: ✗ · ogr.: −sprzedawca | ✅ |
| `personnel_contract_payments` | wysoka | R: PERS(v) ∨ OWN<br>W: PERS(m) | R: can_manage_personnel_contracts ∨ can_view_personnel_contracts ∨ personnel_owns_contract · W: can_manage_personnel_contracts · ogr.: −sprzedawca | ✅ |
| `personnel_contract_rates` | wysoka | R: PERS(v) ∨ OWN<br>W: PERS(m) | R: personnel_can_read_contract · W: ✗ · ogr.: −sprzedawca | ✅ |
| `personnel_contract_templates` | średnia | R: PERS(v)<br>W: PERS(m) | R: personnel_can_access · W: personnel_can_access | ✅ |
| `personnel_contracts` | wysoka | R: PERS(v) ∨ OWN<br>W: PERS(m) | R: can_manage_personnel_contracts ∨ can_view_personnel_contracts ∨ personnel_owns_contract · W: can_manage_personnel_contracts · ogr.: zakres, −sprzedawca | ✅ |
| `personnel_number_counters` | niska | R: SVC<br>W: SVC | brak polityk → tylko SVC | ✅ |
| `personnel_people` | wysoka | R: PERS(v) ∨ OWN<br>W: PERS(m) | R: personnel_can_access ∨ personnel_can_access,self · W: personnel_can_access · ogr.: −sprzedawca | ✅ PESEL/konto — kolumny z ograniczonym UPDATE |
| `personnel_services` | średnia | R: PERS(v)<br>W: PERS(m) | R: personnel_can_access · W: personnel_can_access | ✅ |
| `personnel_settlement_balances` *(widok)* | wysoka | R: PERS(v) ∨ OWN<br>W: — | widok `security_invoker` — RLS tabel bazowych | ✅ widok security_invoker |
| `personnel_settlements` | wysoka | R: PERS(v) ∨ OWN<br>W: PERS(m) | R: personnel_can_read_contract · W: ✗ · ogr.: −sprzedawca | ✅ |
| `personnel_statutory_rates` | niska | R: PERS(v) ∨ OWN<br>W: SVC | R: personnel_can_access,self · W: ✗ | ✅ |
| `personnel_work_entries` | wysoka | R: PERS(v) ∨ OWN<br>W: PERS(m) | R: personnel_can_access ∨ personnel_can_read_contract · W: personnel_can_access · ogr.: zakres, −sprzedawca | ✅ |
| `personnel_work_items` *(widok)* | wysoka | R: PERS(v) ∨ OWN<br>W: — | widok `security_invoker` — RLS tabel bazowych | ✅ widok security_invoker |

### 3.4 Czas pracy i nieobecności

Docelowo: własne wpisy — każdy (reguły triggera `a_guard_time_entry_rules`); cudze — ADM, kadry (`personnel_can_access`) i kierownicy z `time_tracking_view`; stawka godzinowa tylko kadry/ADM. Nieobecności: rodzaj i powód tylko właściciel, `absences_manage`, ADM; reszta widzi wyłącznie zajętość terminu.

*11 obiektów: ✅ 8 · ⚠️ 0 · ❌ 3 · ℹ️ 0*

| Tabela | Wrażl. | Docelowo | Obecnie (RLS) | Status / uwagi |
|---|---|---|---|---|
| `admin_time_entries_history_view` *(widok)* | średnia | R: jak time_entries_history<br>W: — | widok `security_invoker` — RLS tabel bazowych | ✅ widok security_invoker (anon ma GRANT, ale RLS bazowej tabeli odcina) |
| `admin_time_entries_view` *(widok)* | wysoka | R: jak time_entries<br>W: — | widok `security_invoker` — RLS tabel bazowych | ❌ widok security_invoker → dziedziczy problem time_entries (hourly_rate) |
| `employee_absences` | wysoka | R: OWN ∨ P(absences_manage) ∨ ADM (inni: tylko dostępność bez rodzaju nieobecności)<br>W: OWN (oczekujące) ∨ P(absences_manage) | R: AUTH · W: OWN[UD] ∨ P(absences_manage)/OWN[I] | ❌ każdy zalogowany (także portal sprzedawcy) widzi rodzaj nieobecności (np. zwolnienie lekarskie); approve/reject_absence(p_absence_id,p_approved_by) wykonywalne przez anon; po `20261101190000_security_p0`: portal wykluczony (P0-4), przeciążenia approve/reject_absence(uuid,uuid) usunięte, wersje 3-argumentowe wiążą zatwierdzającego z sesją; zostaje P1-5 |
| `employee_overtime_alerts` | średnia | R: SVC<br>W: SVC | brak polityk → tylko SVC | ✅ |
| `employee_time_settlements` | średnia | R: OWN ∨ PERS(v) ∨ ADM<br>W: RPC | R: SP,personnel_can_access,self · W: ✗ | ✅ |
| `public_holiday_sync_runs` | niska | R: EMP<br>W: SVC | R: AUTH · W: ✗ | ✅ po wdrożeniu 20261101140000; czyta też portal sprzedawcy |
| `public_holidays` | niska | R: EMP<br>W: ADM (RPC save_public_holiday) | R: AUTH · W: ✗ | ✅ po wdrożeniu 20261101140000 |
| `time_entries` | wysoka | R: OWN ∨ PERS(v) ∨ ADM ∨ P(time_tracking_view) tylko dla kierowników; stawka tylko kadry/ADM<br>W: OWN (reguły a_guard_time_entry_rules) ∨ ADM ∨ PERS(m) | R: personnel_can_report_own_time ∨ personnel_can_read_contract ∨ ADM∨P(time_tracking_view) ∨ OWN · W: personnel_can_report_own_time ∨ ADM[UD] ∨ OWN · ogr.: zakres | ❌ P(time_tracking_view) = wszystkie wpisy wszystkich osób ze stawkami; uprawnienie jest w pakietach Technik/Realizator, Magazyn (oba), Freelancer, Event Manager; dziś ma je 6 aktywnych kont (m.in. technicy, magazyn) |
| `time_entries_history` | średnia | R: OWN ∨ ADM ∨ PERS(v)<br>W: SVC (triggery) | R: OWN ∨ ADM/personnel_can_report_own_time · W: ✗ | ✅ zapis z API odebrany w 20261101151000 |
| `time_entry_thread_messages` | średnia | R: OWN ∨ ADM (RPC)<br>W: RPC | brak polityk → tylko SVC | ✅ |
| `time_entry_threads` | średnia | R: OWN ∨ ADM (RPC)<br>W: RPC | brak polityk → tylko SVC | ✅ |

### 3.5 Dane osobowe pracowników

Docelowo: każdy pracownik widzi katalog (imię, nazwisko, avatar, służbowy telefon i e-mail, zespół); pełny profil (adres, telefon prywatny, NIP, notatki, uprawnienia) — sam pracownik, `employees_view/manage`, ADM; anon — tylko pola strony „Zespół”. Uprawnienia i przypisania konta zmienia tylko ADM (trigger `zzzz_guard_employee_privileged_columns`).

*15 obiektów: ✅ 7 · ⚠️ 7 · ❌ 1 · ℹ️ 0*

| Tabela | Wrażl. | Docelowo | Obecnie (RLS) | Status / uwagi |
|---|---|---|---|---|
| `calendar_feed_tokens` | średnia | R: OWN<br>W: OWN | R: OWN · W: OWN[ID] | ✅ |
| `certification_types` | niska | R: EMP<br>W: P(employees_manage) | R: AUTH · W: AUTH | ⚠️ zapis: każdy zalogowany |
| `driving_license_categories` | niska | R: EMP<br>W: P(employees_manage) | R: P(equipment_manage) ∨ AUTH · W: P(equipment_manage) | ✅ |
| `employee_certifications` | średnia | R: EMP ∨ OWN<br>W: P(employees_manage) ∨ OWN | R: AUTH · W: AUTH | ⚠️ odczyt i zapis: każdy zalogowany, także portal sprzedawcy; portal wykluczony (P0-4, `20261101190000_security_p0`) |
| `employee_driving_licenses` | średnia | R: EMP<br>W: P(employees_manage) ∨ OWN | R: P(employees_manage,equipment_manage)/OWN ∨ AUTH · W: P(employees_manage,equipment_manage)/OWN | ⚠️ odczyt: każdy zalogowany, także portal sprzedawcy; portal wykluczony (P0-4, `20261101190000_security_p0`) |
| `employee_notification_settings` | niska | R: OWN ∨ ADM<br>W: OWN ∨ ADM | R: can_manage_employee_notification_settings/OWN · W: can_manage_employee_notification_settings | ✅ |
| `employee_online_status` | niska | R: EMP<br>W: OWN | R: self · W: self/OWN | ✅ |
| `employee_signatures` | średnia | R: EMP<br>W: OWN | R: AUTH · W: OWN | ⚠️ odczyt: także portal sprzedawcy; portal wykluczony (P0-4, `20261101190000_security_p0`) |
| `employee_skills` | niska | R: EMP<br>W: P(employees_manage) | R: AUTH · W: AUTH | ⚠️ zapis: każdy zalogowany; portal wykluczony (P0-4, `20261101190000_security_p0`) |
| `employee_webhook_notification_settings` | niska | R: OWN ∨ ADM<br>W: ADM | R: can_manage_employee_notification_settings/OWN · W: can_manage_employee_notification_settings | ✅ |
| `employees` | wysoka | R: EMP: katalog (imię, nazwisko, avatar, służbowy tel./e-mail) przez widok/RPC; pełny rekord: OWN ∨ P(employees_view) ∨ ADM; PUB: tylko pola strony<br>W: OWN (pola zwykłe — trigger) ∨ ADM | R: is_admin ∨ AUTH ∨ warunek · W: is_admin[UD] ∨ current_employee_is_crm_admin,is_admin[I] ∨ warunek[U] · ogr.: −SP; PUB: widok website_team_members | ⚠️ anon: tylko widok `website_team_members` z polami strony (P0-6, `20261101190000_security_p0`); każdy pracownik nadal czyta pełne rekordy wszystkich (P1-9, ℹ️ D3 — osobny etap). Zapis naprawiony w 20261101150000 |
| `push_tokens` | średnia | R: OWN<br>W: OWN | R: OWN · W: OWN | ✅ |
| `sales_teams` | niska | R: EMP<br>W: ADM | R: ADM ∨ AUTH · W: ADM | ✅ |
| `skill_categories` | niska | R: EMP<br>W: P(employees_manage) | R: AUTH · W: AUTH | ⚠️ zapis: każdy zalogowany |
| `skills` | niska | R: EMP<br>W: P(employees_manage) | R: AUTH · W: AUTH | ⚠️ zapis: każdy zalogowany |

### 3.6 Klienci, kontakty, podwykonawcy

Docelowo: odczyt `contacts_view`/`clients_view` albo opiekun (owner_id, `crm_record_owned`) albo powiązanie z widocznym wydarzeniem (tylko dane potrzebne operacyjnie); zapis `contacts_manage`/`clients_manage` albo opiekun; PESEL/nr dowodu tylko `contacts_manage`/ADM; portal sprzedawcy — wyłącznie własni klienci przez `sales_partner_clients`/RPC.

*21 obiektów: ✅ 6 · ⚠️ 6 · ❌ 8 · ℹ️ 1*

| Tabela | Wrażl. | Docelowo | Obecnie (RLS) | Status / uwagi |
|---|---|---|---|---|
| `clients` | wysoka | R: P(clients_view) ∨ właściciel<br>W: P(clients_manage) ∨ właściciel | R: AUTH · W: AUTH | ❌ odczyt/zapis/usuwanie: każdy zalogowany, także portal sprzedawcy; portal wykluczony (P0-4, `20261101190000_security_p0`); dla pracowników — P1-1/P1-3 |
| `contact_history` | średnia | R: P(contacts_view) ∨ właściciel kontaktu<br>W: P(contacts_manage) | R: AUTH · W: AUTH · ogr.: zakres | ⚠️ każdy zalogowany; portal sprzedawcy nie jest wykluczony; portal wykluczony (P0-4, `20261101190000_security_p0`); dla pracowników — P1-1/P1-3 |
| `contact_organizations` | średnia | R: P(contacts_view)<br>W: P(contacts_manage) | R: AUTH · W: AUTH | ❌ każdy zalogowany, także portal sprzedawcy; portal wykluczony (P0-4, `20261101190000_security_p0`); dla pracowników — P1-1/P1-3 |
| `contact_persons` | wysoka | R: P(contacts_view)<br>W: P(contacts_manage) | R: AUTH · W: AUTH | ❌ każdy zalogowany, także portal sprzedawcy; portal wykluczony (P0-4, `20261101190000_security_p0`); dla pracowników — P1-1/P1-3 |
| `contact_reminders` | średnia | R: OWN ∨ P(contacts_manage)<br>W: OWN ∨ P(contacts_manage) | R: AUTH · W: AUTH | ⚠️ każdy zalogowany, także portal sprzedawcy; portal wykluczony (P0-4, `20261101190000_security_p0`); dla pracowników — P1-1/P1-3 |
| `contacts` | wysoka | R: P(contacts_view) ∨ właściciel (owner_id); PESEL/nr dowodu tylko P(contacts_manage)/ADM<br>W: P(contacts_manage) ∨ właściciel | R: AUTH · W: AUTH · ogr.: −SP | ❌ każdy pracownik (także DJ, freelancer) czyta i usuwa wszystkie kontakty, w tym PESEL (27 rekordów) i nr dowodu |
| `customer360_activity_links` | średnia | R: P(contacts_manage)<br>W: P(contacts_manage) | R: can_manage_customer360 · W: can_manage_customer360 | ✅ |
| `customer360_merge_log` | średnia | R: ADM<br>W: SVC | R: is_customer360_admin · W: ✗ | ✅ |
| `customer_marketing_consent_log` | średnia | R: P(contacts_manage)<br>W: SVC | R: can_manage_customer360 · W: ✗ | ✅ |
| `customer_marketing_profiles` | średnia | R: segmentacja<br>W: P(contacts_manage) | R: can_manage_customer360 ∨ can_view_customer_segmentation · W: can_manage_customer360 | ✅ |
| `customer_marketing_segment_members` | średnia | R: segmentacja<br>W: P(contacts_manage) | R: can_manage_customer360 ∨ can_view_customer_segmentation · W: can_manage_customer360 | ✅ |
| `event_contact_persons` | średnia | R: EV(v)<br>W: EV(m) | R: EV(v) · W: EV(m) · ogr.: zakres | ✅ P0-7 (`20261101190000_security_p0`) |
| `organization_decision_makers` | średnia | R: P(contacts_view)<br>W: P(contacts_manage) | R: AUTH · W: AUTH | ❌ każdy zalogowany, także portal sprzedawcy; portal wykluczony (P0-4, `20261101190000_security_p0`); dla pracowników — P1-1/P1-3 |
| `organization_notes` | średnia | R: P(contacts_view)<br>W: P(contacts_manage) ∨ OWN | R: AUTH · W: ADM/OWN[D] ∨ AUTH[I] | ⚠️ odczyt/dodawanie: każdy zalogowany, także portal sprzedawcy; portal wykluczony (P0-4, `20261101190000_security_p0`); dla pracowników — P1-1/P1-3 |
| `organization_roles` | niska | R: SVC<br>W: SVC | brak polityk → tylko SVC | ✅ |
| `organizations` | średnia | R: P(contacts_view) ∨ właściciel<br>W: P(contacts_manage) ∨ właściciel | R: AUTH · W: AUTH · ogr.: −SP | ❌ odczyt, zmiana i usuwanie: każdy pracownik (DJ, technik); portal sprzedawcy wykluczony |
| `subcontractor_rental_equipment` | średnia | R: P(subcontractors_manage/contacts_view)<br>W: P(subcontractors_manage) | R: P(contacts:view) · W: P(contacts:manage) | ℹ️ polityki na nieistniejących uprawnieniach „contacts:view/manage” — tabela martwa dla API (nawet admin) |
| `subcontractor_service_catalog` | średnia | R: P(subcontractors_manage) ∨ P(offers_view)<br>W: P(subcontractors_manage) | R: P(contacts_manage,subcontractors_manage) ∨ P(contacts:view) ∨ AUTH · W: P(contacts_manage,subcontractors_manage) ∨ P(contacts:manage) | ⚠️ odczyt (stawki, koszt ekonomiczny): każdy zalogowany |
| `subcontractor_services` | średnia | R: P(subcontractors_manage) ∨ P(offers_view)<br>W: P(subcontractors_manage) | R: P(contacts:view) ∨ AUTH · W: P(contacts:manage) ∨ P(contacts_manage,subcontractors_manage) | ⚠️ odczyt: każdy zalogowany |
| `subcontractor_transport_catalog` | średnia | R: P(subcontractors_manage) ∨ P(offers_view)<br>W: P(subcontractors_manage) | R: P(contacts_manage,subcontractors_manage) ∨ P(contacts:view) ∨ AUTH · W: P(contacts_manage,subcontractors_manage) ∨ P(contacts:manage) | ⚠️ odczyt: każdy zalogowany |
| `subcontractors` | wysoka | R: P(subcontractors_manage) ∨ EV(m) (przypisani)<br>W: P(subcontractors_manage) | R: AUTH · W: AUTH | ❌ NIP, konto, stawki: odczyt/zapis/usuwanie dla każdego zalogowanego, także portalu sprzedawcy; portal wykluczony (P0-4, `20261101190000_security_p0`); dla pracowników — P1-1/P1-3 |

### 3.7 Zapytania, zadania, przetargi, portal sprzedawców

Docelowo: zapytania — `can_view_inquiry()/can_manage_inquiry()` (własne/pula/zespół/wszystkie wg uprawnień inquiries_*); zadania — `tasks_view/manage` lub przypisanie; przetargi — `tenders_view`; portal sprzedawców — wyłącznie przez funkcje seller_* (konto widzi tylko swoje).

*47 obiektów: ✅ 46 · ⚠️ 1 · ❌ 0 · ℹ️ 0*

| Tabela | Wrażl. | Docelowo | Obecnie (RLS) | Status / uwagi |
|---|---|---|---|---|
| `crm_call_activities` | średnia | R: OWN ∨ P(contacts_view/inquiries_view)<br>W: OWN ∨ P(contacts_manage) | R: can_view_crm_call_activity · W: OWN[I] ∨ P(contacts_manage)/OWN[U] · ogr.: zakres | ✅ |
| `inquiry_activity` | średnia | R: INQ(v)<br>W: SVC | R: warunek · W: ✗ | ✅ |
| `inquiry_analyses` | średnia | R: INQ(v)<br>W: SVC | R: warunek · W: ✗ | ✅ |
| `inquiry_email_index` *(widok)* | średnia | R: INQ(v) ∧ dostęp do skrzynki<br>W: — | widok `security_invoker` — RLS tabel bazowych | ✅ widok security_invoker |
| `inquiry_email_links` | średnia | R: INQ(v)<br>W: INQ(m) | R: can_manage_inquiry ∨ warunek · W: can_manage_inquiry | ✅ |
| `inquiry_followup_schedule` | średnia | R: INQ(v)<br>W: SVC | R: can_view_inquiry · W: ✗ | ✅ |
| `inquiry_intake_reviews` | średnia | R: INQ admin<br>W: SVC | R: is_inquiry_admin,has_inquiry_permission · W: ✗ | ✅ |
| `inquiry_sla_settings` | niska | R: EMP<br>W: ADM (is_inquiry_admin) | R: is_inquiry_admin ∨ AUTH · W: is_inquiry_admin | ✅ |
| `inquiry_stage_history` | średnia | R: INQ(v)<br>W: SVC (trigger) | R: can_view_inquiry · W: ✗ | ✅ |
| `inquiry_team_members` | średnia | R: INQ(v)<br>W: RPC | R: warunek · W: ✗ | ✅ |
| `organization_offer_branding` | średnia | R: SP (własna marka) ∨ opiekun<br>W: RPC | R: seller_workspace_staff_access,seller_can_edit_organization_branding · W: ✗ | ✅ |
| `partner_offer_activities` | średnia | R: SP (własne) ∨ P(offers_view)<br>W: SVC | R: P(offers_view,offers_manage)/self ∨ current_sales_partner_id · W: ✗ · ogr.: zakres | ✅ |
| `sales_offer_guardrails` | średnia | R: EMP<br>W: ADM | R: EMP · W: current_employee_is_crm_admin[U] | ✅ |
| `sales_partner_brand_terms` | średnia | R: SP (własne) ∨ firma ∧ P(contacts_manage/finances_manage)<br>W: ADM ∨ P(contacts_manage) | R: ADM∨P(contacts_manage,finances_manage)/current_employee_can_access_company,self ∨ current_sales_partner_id ∨ current_employee_can_access_company · W: ADM∨P(contacts_manage,finances_manage)/current_employee_can_access_company,self | ✅ |
| `sales_partner_branding_profiles` | średnia | R: SP (własne) ∨ firma<br>W: RPC | R: current_employee_can_access_company ∨ current_sales_partner_id · W: ✗ | ✅ |
| `sales_partner_clients` | średnia | R: SP (własne)<br>W: RPC | R: current_sales_partner_id · W: ✗ · ogr.: sprzedawcy | ✅ |
| `sales_partner_component_prices` | średnia | R: SVC/RPC<br>W: RPC | brak polityk → tylko SVC | ✅ |
| `sales_partner_product_prices` | średnia | R: firma ∧ P(offers_manage/contacts_manage)<br>W: to samo | R: ADM∨P(contacts_manage,offers_manage,finances_manage)/current_employee_can_access_company,self · W: ADM∨P(contacts_manage,offers_manage,finances_manage)/current_employee_can_access_company,self | ✅ |
| `sales_partner_profiles` | średnia | R: SP (własny) ∨ opiekun ∨ P(contacts_view)<br>W: ADM ∨ P(contacts_manage) | R: ADM∨P(contacts_manage,finances_manage)/self ∨ current_sales_partner_id ∨ ADM∨P(contacts_view,contacts_manage,finances_view,finances_manage)/self ∨ seller_directory_crm_row_access · W: ADM∨P(contacts_manage,finances_manage)/self · ogr.: sprzedawcy | ✅ |
| `seller_configuration_quotes` | średnia | R: SVC/RPC<br>W: RPC | brak polityk → tylko SVC | ✅ |
| `seller_conversations` | średnia | R: SP (własne) ∨ opiekun marki<br>W: RPC | R: seller_workspace_brand_access · W: ✗ · ogr.: zakres | ✅ |
| `seller_demo_generations` | średnia | R: opiekun<br>W: RPC | R: can_view_brochure_employee · W: ✗ | ✅ |
| `seller_demo_sessions` | średnia | R: opiekun<br>W: RPC | R: can_view_brochure_employee · W: ✗ | ✅ |
| `seller_demo_visits` | średnia | R: opiekun<br>W: RPC | R: warunek · W: ✗ | ✅ |
| `seller_message_reads` | niska | R: uczestnik rozmowy<br>W: RPC | R: seller_conversation_access/OWN · W: ✗ | ✅ |
| `seller_messages` | średnia | R: uczestnik rozmowy<br>W: RPC | R: seller_conversation_access · W: ✗ | ✅ |
| `seller_offer_arrangement_audit` | średnia | R: RPC<br>W: RPC | R: ✗ · W: ✗ · ogr.: zakres | ✅ |
| `seller_offer_arrangements` | średnia | R: RPC<br>W: RPC | R: ✗ · W: ✗ · ogr.: zakres | ✅ |
| `seller_offer_client_acceptances` | średnia | R: RPC<br>W: RPC | R: ✗ · W: ✗ · ogr.: zakres | ✅ |
| `seller_offer_delivery_settings` | średnia | R: SVC<br>W: RPC | brak polityk → tylko SVC | ✅ |
| `seller_offer_documents` | średnia | R: SP (własne) ∨ opiekun<br>W: RPC | R: seller_portal_offer_access_allowed · W: ✗ · ogr.: zakres | ✅ |
| `seller_offer_email_deliveries` | średnia | R: SVC<br>W: RPC | brak polityk → tylko SVC | ✅ |
| `seller_offer_review_audit` | średnia | R: RPC<br>W: RPC | R: ✗ · W: ✗ · ogr.: zakres | ✅ |
| `seller_offer_reviews` | średnia | R: RPC<br>W: RPC | R: ✗ · W: ✗ · ogr.: zakres | ✅ |
| `seller_offer_save_requests` | średnia | R: RPC<br>W: RPC | R: ✗ · W: ✗ · ogr.: zakres | ✅ |
| `seller_realization_step_history` | średnia | R: SVC<br>W: RPC | brak polityk → tylko SVC | ✅ |
| `seller_realization_steps` | średnia | R: SVC<br>W: RPC | brak polityk → tylko SVC | ✅ |
| `seller_realization_submissions` | średnia | R: RPC<br>W: RPC | R: ✗ · W: ✗ · ogr.: zakres | ✅ |
| `seller_realization_workflows` | średnia | R: SVC<br>W: RPC | brak polityk → tylko SVC | ✅ |
| `seller_review_reads` | niska | R: OWN<br>W: RPC | R: OWN · W: ✗ · ogr.: zakres | ✅ |
| `task_assignees` | średnia | R: jak zadanie (tasks)<br>W: P(tasks_manage) ∨ zespół zapytania | R: inquiry_team_task_access ∨ AUTH · W: inquiry_team_task_access ∨ OWN[D] ∨ AUTH[IU] | ⚠️ odczyt i INSERT/UPDATE: każdy zalogowany, także portal sprzedawcy |
| `task_attachments` | średnia | R: jak zadanie<br>W: P(tasks_manage) ∨ OWN | R: inquiry_task_access_allowed ∨ P(tasks_view,tasks_manage,events_manage)/OWN ∨ P(tasks_view) · W: inquiry_task_access_allowed ∨ ADM/OWN[D] ∨ P(tasks_manage)/OWN[D] ∨ P(tasks_view)[I] ∨ P(tasks_manage,events_manage)/OWN[I] · ogr.: zapytania | ✅ |
| `task_comments` | średnia | R: jak zadanie<br>W: uczestnik zadania | R: inquiry_task_access_allowed ∨ P(tasks_view) ∨ P(tasks_view,tasks_manage,events_manage)/OWN · W: inquiry_task_access_allowed ∨ ADM/OWN[D] ∨ P(tasks_manage)/OWN[D] ∨ P(tasks_view)[I] ∨ P(tasks_manage,events_manage)/OWN[I] ∨ OWN[U] · ogr.: zapytania | ✅ |
| `tasks` | średnia | R: P(tasks_view) ∨ OWN/przypisane ∨ INQ(v)<br>W: P(tasks_manage) ∨ OWN ∨ INQ(m) | R: P(tasks_manage,tasks_view)/OWN ∨ can_view_inquiry ∨ is_inquiry_team_member · W: P(tasks_manage,tasks_view)/OWN ∨ self,can_work_inquiry_team[I] ∨ can_manage_inquiry[U] ∨ can_work_inquiry_team[U] · ogr.: zakres, −SP, zapytania | ✅ zawiera zapytania (is_inquiry) |
| `tender_filter_config` | niska | R: P(tenders_view)<br>W: ADM | R: current_employee_is_crm_admin ∨ current_employee_can_view_tenders · W: current_employee_is_crm_admin · ogr.: EMP | ✅ |
| `tender_import_logs` | niska | R: P(tenders_view)<br>W: SVC | R: current_employee_can_view_tenders · W: ✗ · ogr.: EMP | ✅ |
| `tenders` | średnia | R: P(tenders_view)<br>W: ADM; przypisanie: P(tenders_view) | R: current_employee_can_view_tenders · W: current_employee_is_crm_admin[ID] ∨ current_employee_can_view_tenders[U] · ogr.: EMP | ✅ |

### 3.8 Oferty, kalkulacje, umowy

Docelowo: oferty i kalkulacje należą do sprzedawcy (`sales_can_manage_document/offer/calculation`, zakres `offers_own_only`, firma), pełny dostęp `offers_view/manage`; umowy `contracts_view/manage` (`crm_contract_permission`) w zakresie firmy/own_only. Koszty i marże katalogu — tylko `offers_view`+ (ℹ️).

*35 obiektów: ✅ 28 · ⚠️ 7 · ❌ 0 · ℹ️ 0*

| Tabela | Wrażl. | Docelowo | Obecnie (RLS) | Status / uwagi |
|---|---|---|---|---|
| `contract_cancellation_audit` | średnia | R: ADM<br>W: SVC | R: is_crm_admin · W: ✗ · ogr.: zakres | ✅ |
| `contract_signed_files` | wysoka | R: EVC(v) (bridge)<br>W: bridge | R: ✗ · W: ✗ · ogr.: zakres | ✅ tylko polityka restrykcyjna → dostęp przez /bridge |
| `contract_templates` | średnia | R: P(contracts_view)<br>W: P(contracts_manage) | R: P(contracts_manage) ∨ PUB(filtr) ∨ crm_contract_permission · W: P(contracts_manage) · ogr.: zakres | ⚠️ anon czyta aktywne szablony umów (polityka „Wszyscy mogą czytać…” dla public) |
| `contract_versions` | średnia | R: EVC(v)<br>W: SVC | R: EVC · W: ✗ · ogr.: zakres | ✅ |
| `contracts` | wysoka | R: P(contracts_view) ∧ zakres (own_only, firma) ∨ SALES<br>W: P(contracts_manage) ∨ SALES | R: P(contracts_view,contracts_manage) ∨ crm_contract_permission · W: P(contracts_manage)[UD] ∨ crm_contract_permission ∨ P(contracts_create,contracts_manage,offers_manage)[I] · ogr.: zakres, −SP, firma | ✅ |
| `event_calculation_items` | wysoka | R: SALES ∨ INQ(v) ∨ EV(v)<br>W: SALES ∨ INQ(m) | R: can_work_inquiry_team,sales_can_manage_calculation ∨ warunek ∨ can_view_inquiry ∨ is_inquiry_team_member · W: can_work_inquiry_team,sales_can_manage_calculation ∨ warunek · ogr.: zapytania, sprzedaż | ✅ |
| `event_calculations` | wysoka | R: SALES ∨ INQ(v) ∨ EV(v)<br>W: SALES ∨ INQ(m) | R: can_work_inquiry_team,sales_can_manage_document ∨ warunek ∨ can_view_inquiry ∨ is_inquiry_team_member,current_employee_can_access_event_company · W: can_work_inquiry_team,sales_can_manage_document ∨ warunek ∨ can_manage_inquiry · ogr.: zakres, sprzedaż | ✅ |
| `offer_amendments` | średnia | R: SALES(oferta)<br>W: RPC | R: sales_can_manage_offer · W: ✗ | ✅ |
| `offer_draft_revisions` | średnia | R: SALES(oferta)<br>W: RPC | R: sales_can_manage_offer · W: ✗ | ✅ |
| `offer_english_content` | niska | R: SALES(oferta)<br>W: RPC | R: sales_can_manage_offer · W: ✗ | ✅ |
| `offer_equipment_conflicts` | niska | R: P(offers_view)<br>W: P(offers_manage) | R: ADM∨P(offers_view) · W: ADM[D] ∨ ADM∨P(offers_manage)[IU] · ogr.: zakres | ✅ |
| `offer_equipment_substitutions` | niska | R: jak oferta<br>W: SALES ∨ P(offers_manage) | R: sales_can_manage_document ∨ AUTH ∨ warunek · W: sales_can_manage_document ∨ AUTH · ogr.: zakres, sprzedaż | ⚠️ odczyt i zapis „true” — ograniczone tylko restrykcyjnym sales_document_* (wystarczy widzieć ofertę) |
| `offer_generation_snapshots` | średnia | R: P(offers_view)<br>W: SVC | R: P(offers_view,offers_manage) · W: ✗ · ogr.: zakres | ✅ |
| `offer_history` | średnia | R: P(offers_view)<br>W: SVC | R: ADM∨P(offers_view) · W: ✗ | ✅ |
| `offer_items` | średnia | R: jak oferta<br>W: P(offers_manage) ∨ SALES | R: P(offers_manage) ∨ sales_can_manage_document ∨ warunek ∨ current_sales_partner_id · W: P(offers_manage) ∨ sales_can_manage_document · ogr.: zakres, −SP, sprzedaż | ✅ |
| `offer_language_documents` | średnia | R: SALES(oferta)<br>W: RPC | R: sales_can_manage_offer · W: ✗ | ✅ |
| `offer_package_items` | średnia | R: jak oferta<br>W: P(offers_manage) ∨ SALES | R: P(offers_manage) ∨ sales_can_manage_offer ∨ warunek · W: P(offers_manage) ∨ sales_can_manage_offer · ogr.: sprzedaż | ✅ |
| `offer_packages` | średnia | R: jak oferta<br>W: P(offers_manage) ∨ SALES | R: P(offers_manage) ∨ sales_can_manage_document ∨ warunek · W: P(offers_manage) ∨ sales_can_manage_document · ogr.: zakres, sprzedaż | ✅ |
| `offer_page_template_content` | niska | R: EMP<br>W: P(website_edit) | R: AUTH · W: ADM∨P(website_edit) | ✅ czyta też portal sprzedawcy |
| `offer_page_templates` | niska | R: EMP<br>W: P(website_edit) | R: AUTH · W: ADM[D] ∨ ADM∨P(website_edit)[IU] | ✅ |
| `offer_product_equipment` | niska | R: EMP<br>W: P(offers_manage) | R: P(offers_manage) ∨ AUTH · W: P(offers_manage) · ogr.: −SP | ✅ |
| `offer_product_mavinci_live_modules` | niska | R: EMP<br>W: ADM/katalog LIVE | R: can_manage_mavinci_live_catalog ∨ AUTH · W: can_manage_mavinci_live_catalog | ✅ |
| `offer_product_staff` | średnia | R: P(offers_view) (stawki)<br>W: P(offers_manage) | R: P(offers_manage) ∨ AUTH · W: P(offers_manage) · ogr.: −SP | ⚠️ stawki godzinowe obsługi widzi każdy pracownik |
| `offer_product_staff_skills` | niska | R: EMP<br>W: P(offers_manage) | R: AUTH · W: AUTH | ⚠️ zapis: każdy zalogowany |
| `offer_product_variants` | średnia | R: EMP (bez kosztów)<br>W: P(offers_manage) | R: P(offers_manage) ∨ AUTH · W: P(offers_manage) · ogr.: −SP | ⚠️ koszty wariantów widzi każdy pracownik |
| `offer_products` | średnia | R: EMP: nazwa/cena; koszty (cost_*, staff_cost, subcontractor_economic_cost): P(offers_view)<br>W: P(offers_manage) | R: P(offers_manage) ∨ AUTH · W: P(offers_manage) · ogr.: −SP | ⚠️ koszty i marże produktów widzi każdy pracownik (DJ, technik); portal sprzedawcy ukryty |
| `offer_products_with_subcontractor` *(widok)* | średnia | R: jak offer_products<br>W: — | widok `security_invoker` — RLS tabel bazowych | ⚠️ widok security_invoker |
| `offer_template_categories` | niska | R: EMP<br>W: P(offers_manage) | R: PUB · W: ADM∨P(website_edit,offers_manage) | ✅ anon czyta nazwy kategorii — nieszkodliwe |
| `offer_templates` | niska | R: EMP<br>W: P(offers_manage) | R: P(offers_manage) ∨ AUTH · W: P(offers_manage) | ✅ |
| `offers` | wysoka | R: P(offers_view) ∧ zakres ∨ SALES(własne) ∨ SP(własne)<br>W: P(offers_manage) ∨ SALES | R: sales_can_manage_document ∨ P(offers_manage) ∨ ADM∨P(offers_view,offers_manage,events_manage)/OWN ∨ P(offers_create)/self,crm_record_owned ∨ P(offers_view,offers_create,offers_manage)/self,crm_record_owned ∨ warunek ∨ current_sales_partner_id · W: sales_can_manage_document ∨ P(offers_manage)[ID] ∨ ADM∨P(offers_manage,events_manage,events_create)/OWN[I] ∨ ADM∨P(offers_manage)[U] ∨ ADM∨P(offers_manage,events_manage)/OWN[U] · ogr.: zakres, firma, zapytania, −SP | ✅ |
| `sales_brochure_deliveries` | średnia | R: opiekun<br>W: RPC | R: can_view_brochure_employee · W: ✗ | ✅ |
| `sales_brochure_generations` | średnia | R: opiekun<br>W: RPC | R: can_view_brochure_employee · W: ✗ | ✅ |
| `sales_brochure_items` | niska | R: P(offers_view)<br>W: P(offers_manage) | R: can_manage_sales_brochures ∨ can_view_sales_brochures · W: can_manage_sales_brochures | ✅ |
| `sales_brochures` | niska | R: P(offers_view)<br>W: P(offers_manage) | R: can_manage_sales_brochures ∨ can_view_sales_brochures · W: can_manage_sales_brochures | ✅ |
| `sales_document_files` | średnia | R: jak oferta<br>W: SVC | R: warunek · W: ✗ · ogr.: zakres | ✅ |

### 3.9 Wydarzenia i operacje

Docelowo: `current_employee_can_view_event()` (autor, sprzedawca, przypisany ze statusem accepted, kierownik realizacji, magazyn, events_view_planning/operational, events_manage/calendar_manage = wszystkie, zakres firm i own_only) i `current_employee_can_manage_event()`; dane handlowe wydarzenia — EVC.

*74 obiektów: ✅ 60 · ⚠️ 9 · ❌ 5 · ℹ️ 0*

| Tabela | Wrażl. | Docelowo | Obecnie (RLS) | Status / uwagi |
|---|---|---|---|---|
| `employee_assignments` | średnia | R: EV(v) zespołu ∨ OWN ∨ P(calendar_view); token zaproszenia tylko anon-RPC<br>W: EV(m) ∨ OWN (status) | R: AUTH ∨ prywatneEV,is_event_participant/OWN ∨ ADM∨P(events_manage,calendar_view) · W: AUTH[ID] ∨ OWN[U] ∨ P(events_manage)[U] · ogr.: zakres, −SP | ❌ INSERT/DELETE „true”: każdy zalogowany (także portal sprzedawcy) dodaje/usuwa ludzi z dowolnego wydarzenia; tokeny zaproszeń widoczne dla wszystkich; po `20261101190000_security_p0`: anon bez dostępu do zaproszeń (P0-10 — token obsługuje serwer kluczem service_role), portal wykluczony (P0-4); INSERT/DELETE „true” dla pracowników — P1-2 |
| `event_agenda_items` | średnia | R: EV(v)<br>W: EV(m) | R: EV(m) ∨ ADM∨P(events_view) ∨ EV(v) · W: EV(m) ∨ ADM∨P(events_manage) | ⚠️ P(events_view) bez przypisania widzi agendy wszystkich wydarzeń |
| `event_agenda_notes` | średnia | R: EV(v)<br>W: EV(m) | R: EV(m) ∨ ADM∨P(events_view) ∨ EV(v) · W: EV(m) ∨ ADM∨P(events_manage) | ⚠️ jak wyżej |
| `event_agendas` | średnia | R: EV(v)<br>W: EV(m) | R: EV(m) ∨ ADM∨P(events_view) ∨ EV(v) · W: EV(m) ∨ ADM∨P(events_manage) · ogr.: zakres | ⚠️ jak wyżej |
| `event_audit_log` | wysoka | R: EV(v); zmiany pól finansowych tylko EVC(v)<br>W: SVC (triggery) | R: AUTH ∨ P(events_manage) · W: AUTH[I] ∨ P(events_manage)[I] | ❌ każdy zalogowany (także portal sprzedawcy) czyta historię wszystkich wydarzeń — 130 wpisów zmian budżetu; INSERT „true”; portal wykluczony (P0-4, `20261101190000_security_p0`) |
| `event_audit_log_with_user_id` *(widok)* | wysoka | R: jak event_audit_log<br>W: — | widok `security_invoker` — RLS tabel bazowych | ❌ widok security_invoker |
| `event_categories` | niska | R: EMP<br>W: P(event_categories_manage) | R: P(events_manage,event_categories_manage) ∨ AUTH · W: P(event_categories_manage) | ✅ |
| `event_checklists` | średnia | R: EV(v)<br>W: EV(m) | R: P(events_manage)/OWN · W: P(events_manage)/OWN · ogr.: zakres | ✅ |
| `event_closeouts` | średnia | R: EV(v) (workflow)<br>W: EV(m) | R: can_manage_event_workflows ∨ can_view_event_workflows · W: can_manage_event_workflows · ogr.: zakres | ✅ |
| `event_employee_conflict_acceptances` | niska | R: P(events_manage)<br>W: P(events_manage) | R: ADM∨P(events_manage) · W: ADM∨P(events_manage)[IU] | ✅ |
| `event_employees` | średnia | R: EV(v)<br>W: EV(m) | R: P(events_manage)/OWN · W: P(events_manage)/OWN · ogr.: zakres | ✅ |
| `event_equipment` | niska | R: EV(v)<br>W: EV(m) | R: ADM∨P(events_manage,calendar_view) ∨ P(events_manage)/OWN · W: P(events_manage)/OWN[UD] ∨ ADM∨P(events_manage)/OWN[I] · ogr.: zakres | ✅ |
| `event_equipment_component_reviews` | niska | R: EV(v)<br>W: EV(m) | R: ADM∨P(events_manage) ∨ ADM∨P(events_manage,calendar_view) · W: ADM∨P(events_manage) · ogr.: zakres | ✅ |
| `event_equipment_units` | niska | R: EV(v)<br>W: P(equipment_manage) | R: AUTH · W: P(equipment:manage)[ID] | ✅ polityki zapisu na nieistniejącym „equipment:manage” |
| `event_files` | średnia | R: EV(v); dokumenty wrażliwe: prywatneEV/EVC<br>W: EV(m) | R: prywatneEV,is_sensitive_event_document,is_event_participant ∨ invoice_finance_scope,sales_finance_file_access · W: prywatneEV,is_sensitive_event_document,can_edit_operational_event_files · ogr.: zakres, faktury | ✅ plik w publicznym buckecie event-files jest jednak dostępny po URL (sekcja storage); pliki w folderze „Faktury” (`required_permission = 'finance:invoices'`) tylko przy poziomie finansów działalności wydarzenia ≥ invoices albo dla sprzedawcy wydarzenia z poziomem sales (`20261101190000_security_p0`) |
| `event_folders` | średnia | R: EV(v)<br>W: EV(m) | R: prywatneEV · W: prywatneEV · ogr.: zakres | ✅; folder „Faktury” — poziom finansów działalności wydarzenia (RESTRICTIVE `event_folders_required_permission`, `20261101190000_security_p0`) |
| `event_loading_checklist` | niska | R: EV(v)<br>W: EV(m) | R: P(events_manage) ∨ P(events_view) · W: P(events_manage) · ogr.: zakres | ⚠️ P(events_view) bez zakresu wydarzenia |
| `event_logistics_timeline` | niska | R: EV(v)<br>W: EV(m) | R: P(events_manage) ∨ P(events_view) · W: P(events_manage) · ogr.: zakres | ⚠️ jak wyżej |
| `event_operational_alert_log` | niska | R: EV(v)<br>W: SVC | R: can_view_event_workflows · W: ✗ · ogr.: zakres | ✅ |
| `event_operational_alert_settings` | niska | R: ADM<br>W: ADM | R: is_crm_admin · W: is_crm_admin | ✅ |
| `event_partner_arrangements` | średnia | R: EV(v)<br>W: EV(m) | R: ADM∨P(events_manage)/SP ∨ warunek · W: ADM∨P(events_manage)/SP · ogr.: zakres | ✅ |
| `event_phase_assignments` | średnia | R: EV(v)<br>W: EV(m) | R: EMP · W: ADM∨P(events_manage) | ⚠️ każdy pracownik widzi przypisania do faz wszystkich wydarzeń |
| `event_phase_equipment` | niska | R: EV(v)<br>W: EV(m) | R: ADM∨P(events_manage,equipment_manage) ∨ PUB(warunek) · W: ADM∨P(events_manage,equipment_manage) | ✅ |
| `event_phase_resource_summary` *(widok)* | niska | R: EV(v)<br>W: — | widok `security_invoker` — RLS tabel bazowych | ✅ widok security_invoker |
| `event_phase_types` | niska | R: EMP<br>W: ADM | R: ADM∨P(events_manage) ∨ PUB(filtr) · W: ADM∨P(events_manage) | ✅ |
| `event_phase_vehicles` | niska | R: EV(v)<br>W: EV(m) | R: ADM∨P(events_manage,fleet_manage) ∨ PUB(warunek) · W: ADM∨P(events_manage,fleet_manage) | ✅ |
| `event_phases` | niska | R: EV(v)<br>W: EV(m) | R: ADM∨P(events_manage)/OWN ∨ PUB(warunek) · W: ADM∨P(events_manage)/OWN · ogr.: zakres | ✅ |
| `event_realizations` | średnia | R: EV(v)<br>W: RPC | R: is_realization_manager,EV(v) · W: ✗ | ✅ |
| `event_routes` | niska | R: EV(v)<br>W: EV(m) | R: P(events_manage) ∨ P(events_view) · W: P(events_manage) | ⚠️ P(events_view) bez zakresu wydarzenia |
| `event_timeline_bounds` *(widok)* | niska | R: EV(v)<br>W: — | widok `security_invoker` — RLS tabel bazowych | ✅ widok security_invoker |
| `event_vehicles` | średnia | R: EV(v) ∨ kierowca<br>W: EV(m) | R: is_event_manager · W: AUTH ∨ P(events_manage)/OWN ∨ warunek[U] · ogr.: zakres, realizacja | ❌ INSERT/UPDATE/DELETE „true”: każdy zalogowany, także portal sprzedawcy; portal wykluczony (P0-4, `20261101190000_security_p0`) |
| `event_warehouse_handoffs` | niska | R: EV(v)<br>W: RPC | R: warunek · W: ✗ | ✅ |
| `event_workflow_activity` | niska | R: EV(v)<br>W: SVC | R: can_view_event_workflows · W: ✗ · ogr.: zakres | ✅ |
| `event_workflow_instances` | niska | R: EV(v)<br>W: EV(m) | R: can_manage_event_workflows ∨ can_view_event_workflows · W: can_manage_event_workflows · ogr.: zakres | ✅ |
| `event_workflow_requirement_overrides` | niska | R: EV(v)<br>W: EV(m) | R: can_manage_event_workflows ∨ can_view_event_workflows · W: can_manage_event_workflows | ✅ |
| `event_workflow_requirements` | niska | R: EMP<br>W: ADM | R: can_manage_event_workflows ∨ can_view_event_workflows · W: can_manage_event_workflows | ✅ |
| `event_workflow_stages` | niska | R: EMP<br>W: ADM | R: can_manage_event_workflows ∨ can_view_event_workflows · W: can_manage_event_workflows | ✅ |
| `event_workflow_tasks` | niska | R: EV(v)<br>W: SVC | R: can_view_event_workflows · W: ✗ | ✅ |
| `event_workflow_template_categories` | niska | R: EMP<br>W: ADM | R: can_manage_event_workflows ∨ can_view_event_workflows · W: can_manage_event_workflows | ✅ |
| `event_workflow_templates` | niska | R: EMP<br>W: ADM | R: can_manage_event_workflows ∨ can_view_event_workflows · W: can_manage_event_workflows | ✅ |
| `events` | wysoka | R: EV(v) (właściciel, przypisany-zaakceptowany, events_manage/calendar_manage = wszystkie, own_only, firma); kolumny finansowe tylko EVC(v)<br>W: EV(m) | R: is_event_driver ∨ EV(v) ∨ ADM∨P(events_manage,calendar_manage,events_view,calendar_view)/OWN ∨ ADM∨P(events_manage,calendar_manage,events_view,calendar_view,events_create)/OWN · W: ADM∨P(events_manage)[D] ∨ P(events_manage)/OWN[UD] ∨ P(calendar_manage)[I] ∨ ADM∨P(events_manage,events_create,calendar_manage)[I] ∨ ADM∨P(events_manage)/OWN[U] ∨ EV(m)[U] · ogr.: zakres, −SP, firma, realizacja | ⚠️ budżet, przychody i koszty w wierszu events widzi każdy, kto widzi wydarzenie (np. przypisany technik) — ukrywa tylko UI |
| `locations` | niska | R: EMP<br>W: P(locations_manage) | R: ADM∨P(locations_view,locations_manage,calendar_view,calendar_manage) ∨ AUTH · W: ADM∨P(locations_manage) | ✅ czyta też portal sprzedawcy; po `20261101190000_security_p0` portal wykluczony (P0-4) |
| `mavinci_desktop_sessions` | niska | R: OWN ∨ hub<br>W: hub | R: self,can_use_mavinci_hub · W: can_use_mavinci_hub[D] · ogr.: zakres | ✅ |
| `mavinci_event_module_access` | niska | R: EV(m)<br>W: EV(m) | R: can_manage_mavinci_event ∨ self,can_manage_mavinci_event · W: can_manage_mavinci_event · ogr.: zakres | ✅ |
| `mavinci_event_project_revisions` | niska | R: EV(v)<br>W: EV(m) | R: can_access_mavinci_event · W: can_manage_mavinci_event[I] | ✅ |
| `mavinci_event_projects` | niska | R: EV(v)<br>W: EV(m) | R: can_manage_mavinci_event ∨ can_access_mavinci_event · W: can_manage_mavinci_event · ogr.: zakres | ✅ |
| `mavinci_familiada_game_questions` | niska | R: P(mavinci_live_*)<br>W: P(mavinci_live_*) | R: can_use_mavinci_global_module,can_use_mavinci_hub,can_use_mavinci_module ∨ PUB(warunek) · W: can_use_mavinci_global_module,can_use_mavinci_hub,can_use_mavinci_module | ✅ |
| `mavinci_familiada_games` | niska | R: P(mavinci_live_*)<br>W: P(mavinci_live_*) | R: can_use_mavinci_global_module,can_use_mavinci_hub,can_use_mavinci_module · W: can_use_mavinci_global_module,can_use_mavinci_hub,can_use_mavinci_module · ogr.: zakres | ✅ |
| `mavinci_familiada_questions` | niska | R: P(mavinci_live_*)<br>W: P(mavinci_live_*) | R: can_use_mavinci_global_module,can_use_mavinci_hub,can_use_mavinci_module · W: can_use_mavinci_global_module,can_use_mavinci_hub,can_use_mavinci_module · ogr.: zakres | ✅ |
| `mavinci_light_magic_presets` | niska | R: P(mavinci_live_*)<br>W: P(mavinci_live_*) | R: can_use_mavinci_hub,self,can_use_mavinci_module · W: can_use_mavinci_hub,self,can_use_mavinci_module · ogr.: zakres | ✅ |
| `mavinci_live_modules` | niska | R: EMP<br>W: ADM/katalog LIVE | R: can_manage_mavinci_live_catalog ∨ AUTH · W: can_manage_mavinci_live_catalog | ✅ |
| `mavinci_quiz_show_categories` | niska | R: P(mavinci_live_*)<br>W: P(mavinci_live_*) | R: can_use_mavinci_global_module,can_use_mavinci_hub · W: can_use_mavinci_global_module,can_use_mavinci_hub | ✅ |
| `mavinci_quiz_show_event_setups` | niska | R: P(mavinci_live_*)<br>W: P(mavinci_live_*) | R: can_use_mavinci_global_module,can_use_mavinci_hub,can_use_mavinci_module · W: can_use_mavinci_global_module,can_use_mavinci_hub,can_use_mavinci_module · ogr.: zakres | ✅ |
| `mavinci_quiz_show_game_categories` | niska | R: P(mavinci_live_*)<br>W: P(mavinci_live_*) | R: can_use_mavinci_global_module,can_use_mavinci_hub,can_use_mavinci_module ∨ PUB(warunek) · W: can_use_mavinci_global_module,can_use_mavinci_hub,can_use_mavinci_module | ✅ |
| `mavinci_quiz_show_games` | niska | R: P(mavinci_live_*)<br>W: P(mavinci_live_*) | R: can_use_mavinci_global_module,can_use_mavinci_hub,can_use_mavinci_module · W: can_use_mavinci_global_module,can_use_mavinci_hub,can_use_mavinci_module · ogr.: zakres | ✅ |
| `mavinci_quiz_show_participants` | średnia | R: P(mavinci_live_*)<br>W: P(mavinci_live_*) | R: can_use_mavinci_global_module,can_use_mavinci_hub,can_use_mavinci_module ∨ PUB(warunek) · W: can_use_mavinci_global_module,can_use_mavinci_hub,can_use_mavinci_module | ✅ |
| `mavinci_quiz_show_rosters` | niska | R: P(mavinci_live_*)<br>W: P(mavinci_live_*) | R: can_use_mavinci_global_module,can_use_mavinci_hub,can_use_mavinci_module · W: can_use_mavinci_global_module,can_use_mavinci_hub,can_use_mavinci_module · ogr.: zakres | ✅ |
| `mavinci_view_commands` | niska | R: OWN<br>W: OWN | R: OWN · W: OWN | ✅ |
| `mavinci_view_device_access_log` | niska | R: OWN<br>W: SVC | R: OWN · W: ✗ | ✅ |
| `mavinci_view_devices` | niska | R: OWN<br>W: OWN | R: OWN · W: OWN | ✅ |
| `mavinci_view_media` | niska | R: OWN<br>W: OWN | R: OWN · W: OWN | ✅ |
| `meeting_events` | niska | R: uczestnik<br>W: twórca | R: warunek · W: is_meeting_creator | ✅ |
| `meeting_participants` | niska | R: uczestnik<br>W: twórca ∨ P(calendar_manage) | R: ADM∨P(calendar_manage,calendar_view)/OWN ∨ is_current_meeting_participant ∨ is_meeting_creator ∨ OWN · W: P(calendar_manage)[UD] ∨ is_meeting_creator[ID] ∨ P(calendar_manage,calendar_view)[I] · ogr.: uczestnicy | ✅ |
| `meeting_reminder_deliveries` | niska | R: SVC<br>W: SVC | brak polityk → tylko SVC | ✅ |
| `meeting_series` | niska | R: SVC<br>W: SVC | brak polityk → tylko SVC | ✅ |
| `meetings` | średnia | R: uczestnik ∨ twórca<br>W: twórca ∨ P(calendar_manage) | R: ADM∨P(calendar_manage,events_manage)/OWN ∨ is_current_meeting_participant ∨ OWN · W: P(calendar_manage)[D] ∨ OWN ∨ P(calendar_view,calendar_manage)/OWN[I] ∨ is_admin[U] ∨ P(calendar_manage)/OWN[U] · ogr.: uczestnicy | ✅ |
| `subcontractor_contracts` | średnia | R: EV(m) ∨ P(subcontractors_manage)<br>W: to samo | R: AUTH · W: AUTH · ogr.: zakres | ⚠️ odczyt/zapis „true” (tabela pusta); portal wykluczony (P0-4, `20261101190000_security_p0`); dla pracowników — P1-1/P1-3 |
| `subcontractor_tasks` | średnia | R: EV(v) bez stawek; stawki EVC(v)<br>W: EV(m) | R: AUTH · W: AUTH · ogr.: zakres, realizacja | ❌ stawki i zadania podwykonawców: odczyt/zapis/usuwanie dla każdego zalogowanego, także portalu sprzedawcy; portal wykluczony (P0-4, `20261101190000_security_p0`); dla pracowników — P1-1/P1-3 |
| `wedding_attraction_choices` | średnia | R: EV(v)<br>W: EV(m) | R: can_user_edit_event ∨ warunek · W: can_user_edit_event | ✅ |
| `wedding_card_answers` | średnia | R: EV(v)<br>W: EV(m) | R: can_user_edit_event ∨ warunek · W: can_user_edit_event | ✅ |
| `wedding_card_people` | średnia | R: EV(v)<br>W: EV(m) | R: can_user_edit_event ∨ warunek · W: can_user_edit_event | ✅ dane gości; replace_wedding_card_people() wykonywalna przez anon (sekcja 4) |
| `wedding_cards` | średnia | R: EV(v)<br>W: EV(m) | R: can_user_edit_event ∨ warunek · W: can_user_edit_event · ogr.: zakres | ✅ |
| `wedding_music_tracks` | niska | R: EV(v)<br>W: EV(m) | R: can_user_edit_event ∨ warunek · W: can_user_edit_event | ✅ |
| `wedding_schedule_items` | niska | R: EV(v)<br>W: EV(m) | R: can_user_edit_event ∨ warunek · W: can_user_edit_event | ✅ |

### 3.10 Sprzęt, flota, magazyn

Docelowo: katalog sprzętu czyta każdy pracownik (bez portalu sprzedawcy), zmienia `equipment_manage` (`can_write_equipment_catalog()`); flota — `fleet_view/manage`, kierowca widzi swoje pojazdy i przekazania.

*48 obiektów: ✅ 40 · ⚠️ 7 · ❌ 1 · ℹ️ 0*

| Tabela | Wrażl. | Docelowo | Obecnie (RLS) | Status / uwagi |
|---|---|---|---|---|
| `cable_categories` | niska | R: EMP<br>W: P(equipment_manage) | R: P(equipment_manage,equipment:manage) ∨ AUTH · W: P(equipment_manage,equipment:manage) | ✅ |
| `cable_stock_movements` | niska | R: EMP<br>W: SVC/RPC | R: AUTH · W: ✗ · ogr.: zakres | ✅ |
| `cable_units` | niska | R: EMP<br>W: P(equipment_manage) | R: P(equipment:manage) ∨ AUTH ∨ EMP · W: P(equipment:manage) | ✅ zapis na nieistniejącym „equipment:manage” |
| `cables` | niska | R: EMP<br>W: P(equipment_manage) | R: P(equipment_manage,equipment:manage) ∨ AUTH(filtr) ∨ AUTH ∨ EMP · W: P(equipment_manage,equipment:manage) ∨ P(equipment_manage) | ✅ |
| `connector_types` | niska | R: EMP<br>W: P(equipment_manage) | R: PUB(filtr) ∨ AUTH ∨ EMP · W: AUTH · ogr.: katalogSprzętu | ✅ zapis „true” zawężony restrykcyjnym equipment_catalog_* |
| `equipment_bookings` | niska | R: EMP<br>W: EV(m) ∨ P(equipment_manage) | R: AUTH · W: AUTH · ogr.: zakres | ⚠️ zapis „true” (dowolny zalogowany) |
| `equipment_compatible_items` | niska | R: P(equipment_view)<br>W: P(equipment_manage) | R: ADM∨P(equipment_manage) ∨ ADM∨P(equipment_view) · W: ADM∨P(equipment_manage) | ✅ |
| `equipment_components` | niska | R: EMP<br>W: P(equipment_manage) | R: ADM∨P(equipment_manage) ∨ P(equipment_manage) ∨ ADM∨P(equipment_view) ∨ AUTH · W: ADM∨P(equipment_manage) ∨ P(equipment_manage) | ✅ |
| `equipment_edit_history` | niska | R: P(equipment_manage)<br>W: SVC | R: ADM∨P(equipment_manage) · W: EMP[I] ∨ P(equipment_manage)[I] | ✅ |
| `equipment_external_rentals` *(widok)* | niska | R: EV(v)<br>W: — | widok `security_invoker` — RLS tabel bazowych | ✅ widok security_invoker |
| `equipment_files` | niska | R: EMP<br>W: P(equipment_manage) | R: AUTH · W: AUTH · ogr.: katalogSprzętu | ✅ zawężone equipment_catalog_* |
| `equipment_images` | niska | R: EMP<br>W: P(equipment_manage) | R: AUTH · W: ADM∨P(equipment_manage) · ogr.: katalogSprzętu | ✅ |
| `equipment_items` | niska | R: EMP<br>W: P(equipment_manage) | R: AUTH ∨ ADM∨P(equipment_manage,equipment_view,calendar_view) ∨ EMP · W: P(equipment_manage) · ogr.: −SP | ✅ portal sprzedawcy ukryty |
| `equipment_kit_cables` | niska | R: EMP<br>W: P(equipment_manage) | R: P(equipment:manage) ∨ AUTH · W: P(equipment:manage) | ✅ |
| `equipment_kit_items` | niska | R: EMP<br>W: P(equipment_manage) | R: AUTH · W: AUTH · ogr.: katalogSprzętu | ✅ zawężone equipment_catalog_* |
| `equipment_kits` | niska | R: EMP<br>W: P(equipment_manage) | R: AUTH ∨ EMP · W: AUTH · ogr.: katalogSprzętu | ✅ zawężone equipment_catalog_* |
| `equipment_skill_requirements` | niska | R: EMP<br>W: P(equipment_manage) | R: AUTH · W: AUTH · ogr.: katalogSprzętu | ✅ zawężone equipment_catalog_* |
| `equipment_stock` | niska | R: EMP<br>W: P(equipment_manage) | R: AUTH · W: P(equipment_manage) | ✅ |
| `equipment_stock_history` | niska | R: EMP<br>W: SVC | R: AUTH · W: EMP[I] | ✅ |
| `equipment_unit_events` | niska | R: EMP<br>W: P(equipment_manage) | R: AUTH · W: AUTH | ⚠️ zapis „true” |
| `equipment_units` | niska | R: EMP<br>W: P(equipment_manage) | R: AUTH ∨ EMP · W: AUTH | ⚠️ zapis „true” |
| `fleet_overview` *(widok)* | niska | R: P(fleet_view)<br>W: — | widok `security_invoker` — RLS tabel bazowych | ✅ widok security_invoker |
| `fleet_vehicles_view` *(widok)* | niska | R: P(fleet_view)<br>W: — | widok `security_invoker` — RLS tabel bazowych | ✅ widok security_invoker |
| `fuel_entries` | średnia | R: OWN ∨ P(fleet_view)<br>W: OWN ∨ P(fleet_manage) | R: ADM∨P(fleet_manage) ∨ OWN ∨ ADM∨P(fleet_manage,fleet_view) · W: ADM∨P(fleet_manage) ∨ OWN[I] | ✅ |
| `insurance_policies` | średnia | R: P(fleet_view)<br>W: P(fleet_manage) | R: ADM∨P(fleet_manage) ∨ ADM∨P(fleet_manage,fleet_view) · W: ADM∨P(fleet_manage) | ✅ |
| `maintenance_records` | średnia | R: P(fleet_view)<br>W: P(fleet_manage) | R: ADM∨P(fleet_manage) ∨ ADM∨P(fleet_manage,fleet_view) · W: ADM∨P(fleet_manage) | ✅ |
| `mileage_logs` | niska | R: OWN ∨ P(fleet_manage)<br>W: OWN ∨ P(fleet_manage) | R: ADM∨P(fleet_manage) ∨ OWN · W: ADM∨P(fleet_manage) ∨ OWN[I] · ogr.: zakres | ✅ |
| `oil_change_parts` | niska | R: P(fleet_manage)<br>W: P(fleet_manage) | R: P(fleet_manage) · W: ADM[D] ∨ P(fleet_manage)[IU] | ✅ |
| `oil_changes` | niska | R: P(fleet_manage)<br>W: P(fleet_manage) | R: P(fleet_manage) · W: ADM[D] ∨ P(fleet_manage)[IU] | ✅ |
| `periodic_inspections` | niska | R: P(fleet_manage)<br>W: P(fleet_manage) | R: P(fleet_manage) · W: ADM[D] ∨ P(fleet_manage)[IU] | ✅ |
| `storage_locations` | niska | R: EMP<br>W: P(equipment_manage) | R: PUB(filtr) ∨ AUTH ∨ EMP · W: AUTH · ogr.: katalogSprzętu | ✅ zawężone equipment_catalog_* |
| `timing_belt_changes` | niska | R: P(fleet_manage)<br>W: P(fleet_manage) | R: P(fleet_manage) · W: ADM[D] ∨ P(fleet_manage)[IU] | ✅ |
| `vehicle_alerts` | niska | R: P(fleet_manage)<br>W: SVC | R: P(fleet_manage) · W: P(fleet_manage) ∨ AUTH[ID] | ⚠️ INSERT/DELETE „true” |
| `vehicle_assignments` | niska | R: OWN ∨ P(fleet_manage)<br>W: P(fleet_manage) | R: ADM∨P(fleet_manage) ∨ OWN · W: ADM∨P(fleet_manage) | ✅ |
| `vehicle_attribute_certification_requirements` | niska | R: EMP<br>W: P(fleet_manage) | R: AUTH · W: AUTH | ⚠️ zapis „true” |
| `vehicle_attribute_types` | niska | R: EMP<br>W: P(fleet_manage) | R: AUTH · W: AUTH | ⚠️ zapis „true” |
| `vehicle_attributes` | niska | R: EMP<br>W: P(fleet_manage) | R: AUTH · W: AUTH | ⚠️ zapis „true” |
| `vehicle_compliance_reminder_log` | niska | R: P(fleet_view)<br>W: SVC | R: ADM∨P(fleet_manage,fleet_view) · W: ✗ | ✅ |
| `vehicle_documents` | średnia | R: P(fleet_view)<br>W: P(fleet_manage) | R: ADM∨P(fleet_manage) ∨ P(fleet_manage,fleet_documents) ∨ ADM∨P(fleet_manage,fleet_view) · W: ADM∨P(fleet_manage) ∨ P(fleet_manage,fleet_documents) | ✅ |
| `vehicle_handover_history` *(widok)* | niska | R: P(fleet_view) ∨ kierowca<br>W: — | widok `security_invoker` — RLS tabel bazowych | ✅ widok security_invoker |
| `vehicle_handovers` | niska | R: P(fleet_view) ∨ kierowca<br>W: kierowca ∨ P(fleet_manage) | R: P(fleet_manage) ∨ is_event_manager ∨ P(fleet_view,fleet_manage) · W: P(fleet_manage) ∨ warunek[I] | ✅ |
| `vehicle_images` | niska | R: P(fleet_view)<br>W: P(fleet_manage) | R: ADM∨P(fleet_manage,fleet_view)/OWN · W: ADM∨P(fleet_manage) | ✅ |
| `vehicle_issues` | niska | R: P(fleet_manage)<br>W: P(fleet_manage) | R: P(fleet_manage) · W: ADM[D] ∨ P(fleet_manage)[IU] | ✅ |
| `vehicle_license_requirements` | niska | R: EMP<br>W: P(fleet_manage) | R: P(equipment_manage) ∨ AUTH · W: P(equipment_manage) | ✅ zapis wymaga equipment_manage (nielogiczne, ale nie za szeroko) |
| `vehicle_reports` | niska | R: P(fleet_view)<br>W: P(fleet_manage) | R: P(fleet_view,fleet_manage) · W: P(fleet_manage)[UD] ∨ ✗[I] | ✅ |
| `vehicle_reservation_conflicts` *(widok)* | niska | R: P(fleet_view)<br>W: — | widok `security_invoker` — RLS tabel bazowych | ✅ widok security_invoker |
| `vehicles` | niska | R: P(fleet_view) ∨ kierowca<br>W: P(fleet_manage) | R: ADM∨P(fleet_manage) ∨ warunek ∨ OWN ∨ ADM∨P(fleet_manage,fleet_view,calendar_view) · W: ADM∨P(fleet_manage) | ✅ P0-7 (`20261101190000_security_p0`): usunięte vehicles_insert dla public |
| `warehouse_categories` | niska | R: EMP<br>W: P(equipment_manage) | R: AUTH ∨ EMP ∨ PUB(filtr) · W: P(equipment_manage)[UD] ∨ P(equipment_manage,equipment_create)[I] | ✅ |

### 3.11 Komunikacja (e-mail, czat, powiadomienia)

Docelowo: skrzynki — właściciel, przypisani (`employee_email_account_assignments`), `messages_manage` (kontrola korespondencji); czat — uczestnicy; powiadomienia — tylko odbiorca (`notification_recipients.user_id`), tworzone wyłącznie funkcjami serwera.

*24 obiektów: ✅ 16 · ⚠️ 5 · ❌ 2 · ℹ️ 1*

| Tabela | Wrażl. | Docelowo | Obecnie (RLS) | Status / uwagi |
|---|---|---|---|---|
| `contact_messages` | średnia | R: P(messages_view)<br>W: PUB: INSERT (formularz); zmiana P(messages_manage) | R: ADM∨P(messages_manage,messages_view) · W: P(messages_manage)[UD] ∨ PUB[I] ∨ EMP[U] · ogr.: −SP | ⚠️ UPDATE: każdy pracownik |
| `crm_business_notification_outbox` | niska | R: SVC<br>W: SVC | brak polityk → tylko SVC | ✅ |
| `email_accounts` | wysoka | R: SVC<br>W: SVC | brak polityk → tylko SVC | ℹ️ stara tabela z hasłami SMTP/IMAP — usunąć lub przenieść do Vault |
| `email_ai_qualifications` | średnia | R: dostęp do skrzynki<br>W: SVC | R: can_view_email_sales_context · W: ✗ | ✅ |
| `email_attachments` | średnia | R: dostęp do wiadomości<br>W: SVC | R: warunek · W: ✗ | ✅ |
| `email_body_template_assignments` | niska | R: EMP<br>W: ADM ∨ P(messages_manage) | R: AUTH · W: AUTH | ⚠️ odczyt/zapis: każdy zalogowany, także portal sprzedawcy |
| `email_body_templates` | niska | R: EMP<br>W: ADM ∨ P(messages_manage) | R: AUTH · W: AUTH | ⚠️ jak wyżej |
| `email_drafts` | średnia | R: OWN<br>W: OWN | R: ADM∨P(messages_manage)/OWN · W: ADM∨P(messages_manage)/OWN[UD] ∨ OWN[I] | ✅ |
| `email_sales_conversation_messages` | średnia | R: dostęp do skrzynki<br>W: SVC | R: can_view_email_sales_context · W: ✗ | ✅ |
| `email_sales_conversations` | średnia | R: dostęp do skrzynki<br>W: SVC | R: can_view_email_sales_context · W: ✗ | ✅ |
| `email_templates` | niska | R: EMP<br>W: ADM ∨ P(messages_manage) | R: EMP ∨ AUTH · W: EMP | ⚠️ odczyt: także portal sprzedawcy; zapis: każdy pracownik |
| `employee_conversation_participants` | średnia | R: uczestnik<br>W: twórca/uczestnik | R: current_employee_is_conversation_participant,current_employee_created_conversation · W: self,current_employee_created_conversation/OWN[D] ∨ current_employee_created_conversation[I] ∨ self/OWN[U] | ✅ |
| `employee_conversations` | średnia | R: uczestnik<br>W: uczestnik | R: self,current_employee_is_conversation_participant/OWN · W: self/OWN | ✅ |
| `employee_email_account_assignments` | średnia | R: ADM ∨ OWN<br>W: ADM | R: ADM ∨ ADM/OWN · W: ADM | ✅ |
| `employee_email_accounts` | wysoka | R: OWN ∨ P(messages_manage) (bez haseł)<br>W: P(messages_manage) | R: P(messages_manage)/OWN · W: P(messages_manage) | ⚠️ hasła SMTP/IMAP czytelne z API dla właściciela i messages_manage — przenieść do Vault/Edge Function |
| `employee_messages` | średnia | R: uczestnik<br>W: uczestnik | R: current_employee_is_conversation_participant · W: self,current_employee_is_conversation_participant/OWN | ✅ |
| `employee_shared_account_access` | średnia | R: ADM ∨ OWN<br>W: ADM | R: ADM ∨ ADM/OWN · W: ADM | ✅ |
| `mailbox_control_access_log` | średnia | R: P(messages_manage)<br>W: SVC | R: current_employee_can_control_mailboxes · W: ✗ | ✅ |
| `notification_push_deliveries` | niska | R: SVC<br>W: SVC | brak polityk → tylko SVC | ✅ |
| `notification_recipients` | średnia | R: OWN<br>W: SVC (funkcje) | R: OWN · W: OWN[U: tylko is_read, read_at; D] · ogr.: skrzynki | ✅ P0-5 (`20261101190000_security_p0`): odbiorców dopisują wyłącznie funkcje serwera/service_role; odbiorca nie przepnie wpisu na cudze powiadomienie |
| `notifications` | średnia | R: odbiorca (notification_recipients)<br>W: SVC (funkcje enqueue) | R: odbiorca · W: ✗ (funkcje serwera, service_role) · ogr.: skrzynki | ✅ P0-5 (`20261101190000_security_p0`): odczyt tylko odbiorca; bez INSERT/UPDATE/DELETE z API (wcześniej anon mógł utworzyć powiadomienie i odbiorcę — trigger wysyłał push na telefon) |
| `received_emails` | średnia | R: dostęp do skrzynki<br>W: dostęp do skrzynki | R: P(messages_manage,messages_view)/OWN · W: P(messages_manage)[D] ∨ P(messages_manage,messages_view)/OWN[U] | ✅ |
| `scheduled_emails` | średnia | R: OWN<br>W: RPC | R: OWN · W: ✗ | ✅ |
| `sent_emails` | średnia | R: dostęp do skrzynki<br>W: P(messages_manage) | R: P(messages_view)/OWN ∨ current_employee_can_control_mailboxes · W: P(messages_manage)[D] | ✅ |

### 3.12 Marketing i analityka strony

Docelowo: kampanie — `can_view/manage_marketing_campaigns()` + firma; analityka — anon tylko INSERT, odczyt `page_view`.

*18 obiektów: ✅ 15 · ⚠️ 3 · ❌ 0 · ℹ️ 0*

| Tabela | Wrażl. | Docelowo | Obecnie (RLS) | Status / uwagi |
|---|---|---|---|---|
| `active_sessions` | niska | R: ADM (analityka)<br>W: PUB: tylko INSERT/UPDATE własnej sesji | R: PUB · W: PUB | ⚠️ anon czyta, zmienia i usuwa wszystkie sesje (2985) |
| `click_events` | niska | R: P(page_view)<br>W: PUB: INSERT | R: AUTH · W: PUB[I] | ✅ odczyt: każdy zalogowany |
| `contact_form_submissions` | średnia | R: EMP (bez portalu)<br>W: PUB: INSERT | R: PUB(warunek) ∨ EMP · W: PUB[I] ∨ EMP[U] | ✅ naprawione w 20261101150000 (wcześniej odczyt/zmiana dla każdego, także anon) |
| `form_interactions` | niska | R: P(page_view)<br>W: PUB: INSERT | R: AUTH · W: PUB[I] | ✅ |
| `mailing_campaign_approval_log` | niska | R: P(marketing_campaigns_view)<br>W: SVC | R: can_view_marketing_campaigns · W: ✗ | ✅ |
| `mailing_campaign_events` | niska | R: P(marketing_campaigns_view)<br>W: SVC | R: can_view_marketing_campaigns · W: ✗ | ✅ |
| `mailing_campaigns` | średnia | R: P(marketing_campaigns_view)<br>W: P(marketing_campaigns_manage) | R: can_manage_marketing_campaigns ∨ can_view_marketing_campaigns · W: can_manage_marketing_campaigns | ✅ |
| `mailing_recipients` | średnia | R: P(marketing_campaigns_view)<br>W: SVC | R: can_view_marketing_campaigns · W: ✗ | ✅ |
| `marketing_ai_insights` | niska | R: P(marketing)+firma<br>W: to samo | R: can_access_marketing_company · W: can_access_marketing_company | ✅ |
| `marketing_campaigns` | średnia | R: P(marketing)+firma<br>W: to samo | R: can_access_marketing_company · W: can_access_marketing_company | ✅ |
| `marketing_company_settings` | niska | R: P(marketing)+firma<br>W: to samo | R: can_access_marketing_company · W: can_access_marketing_company | ✅ |
| `marketing_integrations` | wysoka | R: P(marketing_campaigns_manage)+firma (bez credentials)<br>W: to samo | R: can_access_marketing_company · W: can_access_marketing_company | ✅ kolumna credentials_encrypted bez SELECT dla authenticated |
| `marketing_messages` | średnia | R: P(marketing)+firma<br>W: to samo | R: can_access_marketing_company · W: can_access_marketing_company | ✅ |
| `marketing_metrics_daily` | niska | R: P(marketing)+firma<br>W: to samo | R: can_access_marketing_company · W: can_access_marketing_company | ✅ |
| `marketing_segments` | średnia | R: segmentacja<br>W: P(contacts_manage) | R: can_manage_customer360 ∨ can_view_customer_segmentation · W: can_manage_customer360 | ✅ |
| `marketing_suppression_list` | średnia | R: P(marketing_campaigns_view)<br>W: P(marketing_campaigns_manage) | R: can_manage_marketing_campaigns ∨ can_view_marketing_campaigns · W: can_manage_marketing_campaigns | ✅ |
| `page_analytics` | niska | R: P(page_view)<br>W: PUB: INSERT | R: PUB · W: PUB[I] | ⚠️ anon czyta całą analitykę (ścieżki, sesje) |
| `scroll_depth` | niska | R: P(page_view)<br>W: PUB: INSERT | R: AUTH · W: PUB[IU] | ⚠️ anon może zmieniać dowolne wiersze (UPDATE „true”) |

### 3.13 Strona publiczna (treści WWW)

Docelowo dla wszystkich tabel poniżej: anon czyta opublikowane wiersze, zapis tylko `website_edit` (lub `can_manage_quiz_website()` dla sekcji quizów). Wrażliwość: niska.

*89 obiektów: ✅ 48 · ⚠️ 24 · ❌ 17 · ℹ️ 0*

| Tabela | Obecnie (RLS) | Status |
|---|---|---|
| `casino_content_items` | R: PUB ∨ PUB(filtr) · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |
| `casino_content_sections` | R: PUB ∨ PUB(filtr) · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |
| `casino_content_separators` | R: PUB ∨ PUB(filtr) · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |
| `city_pages_seo` | R: PUB(filtr) · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `conferences_advantages` | R: AUTH ∨ PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `conferences_case_studies` | R: AUTH ∨ PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `conferences_faq` | R: AUTH ∨ PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `conferences_gallery` | R: AUTH ∨ PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `conferences_hero` | R: AUTH ∨ PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `conferences_images` | R: AUTH ∨ PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `conferences_packages` | R: AUTH ∨ PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `conferences_pricing` | R: AUTH ∨ PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `conferences_problems` | R: AUTH ∨ PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `conferences_related_services` | R: PUB(filtr) · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |
| `conferences_service_gallery` | R: PUB(filtr) · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `conferences_services` | R: AUTH ∨ PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `dj_related_services` | R: PUB(filtr) · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |
| `footer_templates` | R: PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `integracje_page_images` | R: PUB · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |
| `kasyno_page_images` | R: PUB · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |
| `konferencje_page_images` | R: PUB · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |
| `naglosnienie_applications` | R: PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `naglosnienie_content` | R: PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `naglosnienie_features` | R: PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `naglosnienie_gallery_images` | R: PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `naglosnienie_page_images` | R: PUB · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |
| `polish_city_cases` | R: PUB(filtr) ∨ AUTH · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `portfolio_page_images` | R: PUB(filtr) · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `portfolio_project_features` | R: PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `portfolio_projects` | R: AUTH ∨ PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `quizy-teleturnieje_page_images` | R: PUB ∨ can_manage_quiz_website · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |
| `seo_city_content` | R: PUB ∨ PUB(filtr) · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |
| `service_hero_images` | R: PUB(filtr) ∨ can_manage_quiz_website · W: AUTH ∨ can_manage_quiz_website[IU] | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `site_images` | R: PUB · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |
| `streaming_page_images` | R: PUB · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |
| `symulatory-vr_page_images` | R: PUB · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |
| `team_page_images` | R: PUB(filtr) · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `technical_stage_related_services` | R: PUB(filtr) · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |
| `technika-sceniczna_page_images` | R: PUB · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |
| `techstage_benefits` | R: PUB · W: AUTH | ⚠️ zapis: każdy zalogowany (także portal sprzedawcy), nie tylko website_edit |
| `wieczory-tematyczne_page_images` | R: PUB · W: website_edit (can_edit_website) | ✅ P0-3 (`20261101190000_security_p0`): zapis tylko redaktor strony (website_edit / page_manage / administrator) |

✅ Zgodne (48): `about_page_images`, `casino_content_blocks`, `casino_features`, `casino_features_section`, `casino_gallery`, `casino_game_rules`, `casino_legal_popup`, `casino_page_settings`, `casino_tables`, `conferences_cities`, `conferences_process`, `conferences_service_categories`, `conferences_service_items`, `dj_benefits`, `dj_features`, `dj_gallery`, `dj_hero_page_images`, `dj_intro`, `dj_packages`, `dj_page_images`, `dj_themes`, `polish_cities`, `quiz_popular_packages`, `quiz_related_services`, `quiz_show_formats`, `quiz_show_gallery`, `schema_org_business`, `schema_org_global`, `schema_org_page_metadata`, `schema_org_page_offers`, `schema_org_places`, `service_slug_aliases`, `services_catalog`, `technical_brochure_content`, `technical_brochure_images`, `technical_stage_equipment`, `technical_stage_features`, `technical_stage_gallery`, `technical_stage_packages`, `technical_stage_service_items`, `technical_stage_services`, `techstage_city_content`, `vr_benefits`, `vr_equipment_types`, `vr_experiences`, `vr_features`, `vr_gallery`, `vr_simulators_intro`.

### 3.14 System i konfiguracja

*21 obiektów: ✅ 17 · ⚠️ 2 · ❌ 0 · ℹ️ 2*

| Tabela | Wrażl. | Docelowo | Obecnie (RLS) | Status / uwagi |
|---|---|---|---|---|
| `_backup_equipment_items` | niska | R: SVC<br>W: SVC | brak polityk → tylko SVC | ℹ️ kopia zapasowa — usunąć |
| `_backup_equipment_units` | niska | R: SVC<br>W: SVC | brak polityk → tylko SVC | ℹ️ kopia zapasowa — usunąć |
| `access_levels` | niska | R: EMP<br>W: ADM | R: AUTH · W: ADM | ✅ czyta też portal sprzedawcy; po `20261101190000_security_p0` portal wykluczony (P0-4) |
| `available_icons` | niska | R: PUB<br>W: ADM ∨ P(website_edit) | R: PUB · W: AUTH | ⚠️ zapis: każdy zalogowany |
| `company_brandbook_colors` | niska | R: EMP<br>W: ADM ∨ marketing | R: AUTH · W: ADM∨P(invoices_manage) | ✅ zapis wymaga invoices_manage (nielogiczne) |
| `company_brandbook_fonts` | niska | R: EMP<br>W: ADM ∨ marketing | R: AUTH · W: ADM∨P(invoices_manage) | ✅ |
| `company_brandbook_logos` | niska | R: EMP<br>W: ADM ∨ marketing | R: AUTH · W: ADM∨P(invoices_manage) | ✅ |
| `company_brandbook_styles` | niska | R: EMP<br>W: ADM ∨ marketing | R: AUTH · W: ADM∨P(invoices_manage) | ✅ |
| `custom_database_columns` | średnia | R: P(databases_view)<br>W: P(databases_manage) | R: ADM∨P(databases_manage) ∨ ADM∨P(databases_manage)/OWN · W: ADM∨P(databases_manage) | ✅ |
| `custom_database_records` | średnia | R: P(databases_view)<br>W: P(databases_manage) | R: ADM∨P(databases_manage) ∨ ADM∨P(databases_manage)/OWN · W: ADM∨P(databases_manage) ∨ ADM∨P(databases_manage)/OWN | ✅ |
| `custom_databases` | średnia | R: P(databases_view)<br>W: P(databases_manage) | R: ADM∨P(databases_manage,databases_view)/OWN · W: ADM[D] ∨ ADM∨P(databases_view,databases_manage)[I] ∨ ADM∨P(databases_manage)[U] | ✅ |
| `custom_icons` | niska | R: PUB/EMP<br>W: P(event_categories_manage) | R: PUB(filtr) ∨ can_manage_quiz_website ∨ AUTH · W: P(event_categories_manage) | ✅ |
| `database_shares` | niska | R: OWN ∨ P(databases_manage)<br>W: P(databases_manage) | R: OWN ∨ ADM∨P(databases_manage) · W: ADM∨P(databases_manage)[ID] | ✅ |
| `inbound_events` | średnia | R: P(webhooks)<br>W: SVC | R: can_view_webhooks · W: can_manage_webhooks[UD] ∨ ✗[I] | ✅ |
| `mac_sync_bindings` | średnia | R: SVC<br>W: SVC | R: ✗ · W: ✗ · ogr.: zakres | ✅ |
| `mac_sync_file_versions` | średnia | R: SVC<br>W: SVC | brak polityk → tylko SVC | ✅ |
| `mac_sync_files` | średnia | R: SVC<br>W: SVC | R: ✗ · W: ✗ · ogr.: zakres | ✅ |
| `my_companies` | średnia | R: EMP: nazwa, logo, marka; konta bankowe: F≥invoices<br>W: ADM | R: ADM∨P(invoices_manage,invoices_view) ∨ can_access_marketing_company · W: ADM[D] ∨ ADM∨P(invoices_manage)[IU] · ogr.: firma | ⚠️ osoby z marketingiem widzą wszystkie konta bankowe firm (także prywatne); zwykły pracownik nie widzi nawet nazwy firmy (UI może potrzebować widoku publicznego) |
| `system_email_config` | wysoka | R: ✗ (SVC)<br>W: ADM przez RPC | R: ADM · W: ADM | ✅ hasło SMTP czytelne dla administratora — docelowo Vault |
| `system_health_alert_log` | niska | R: ADM<br>W: SVC | R: is_crm_admin · W: ✗ | ✅ |
| `webhook_sources` | średnia | R: P(webhooks)<br>W: P(webhooks_manage) | R: can_view_webhooks · W: can_manage_webhooks | ✅ |

### 3.15 Storage (buckety)

*30 bucketów: ✅ 14 · ⚠️ 10 (w tym 2 ⚠️*) · ❌ 6.* Bucket „publiczny” udostępnia każdy plik pod stałym adresem `/storage/v1/object/public/<bucket>/<ścieżka>` bez logowania i bez RLS — polityki SELECT dotyczą tylko listowania i pobierania przez API.

| Bucket | Publ. | Obiekty | Zawartość | Docelowo | Obecnie | Status |
|---|---|---|---|---|---|---|
| `event-files` | **tak** | 710 | pliki wydarzeń: umowy, faktury, dokumenty, załączniki zadań | prywatny; odczyt EV(v) + reguły `event_files`; dokumenty finansowe EVC/F | publiczny URL dla każdego; API: zalogowani (RESTRICTIVE tylko dla sprzedawcy i wymóg logowania przy listowaniu); INSERT/UPDATE/DELETE: każdy zalogowany, dowolna ścieżka; wiersze `event_files` folderu „Faktury” — poziom finansów (`20261101190000_security_p0`) | ❌ (P1-12) |
| `chat-attachments` | **tak** | 119 | załączniki komunikatora | prywatny; uczestnicy rozmowy | publiczny URL; SELECT: każdy zalogowany (także portal sprzedawcy) | ❌ |
| `external-invoices` | nie | 64 | faktury kosztowe (PDF) | F≥invoices dla firmy dokumentu | R: F≥invoices działalności dokumentu (`read_external_invoice_files`); W: finance_manage | ✅ (20261101165000) |
| `generated-offers` | nie | 146 | PDF ofert (ceny, dane klienta) | jak oferta (SALES, P(offers_view), SP — swoje) | SELECT: kto widzi ofertę (RLS `offers`, `storage_generated_offer_id`), pliki bez oferty — ADM; zapis/usunięcie: `sales_can_manage_offer` ∨ ADM; portal — brak; generowanie i wysyłka — service_role | ✅ P0-9 (`20261101190000_security_p0`) |
| `site-images` | tak | 896 | obrazy strony WWW | odczyt PUB; zapis P(website_edit) | zapis: pracownik CRM bez konta portalu (bucket służy też CRM: zdjęcia sprzętu i zestawów, avatary skrzynek); anon: tylko INSERT do `cv-uploads/` (CV z formularza „Dołącz do zespołu”) | ⚠️ P0-3 (`20261101190000_security_p0`): anon nie zmienia i nie usuwa obrazów strony; ℹ️ CV (dane osobowe) w publicznym buckecie — do przeniesienia do prywatnego bucketu; zdjęcia CRM do osobnego bucketu, wtedy zapis tylko website_edit |
| `conferences-gallery` | tak | 4 | galeria konferencji (WWW) | odczyt PUB; zapis P(website_edit) | zapis: `can_edit_website()` | ✅ P0-3 (`20261101190000_security_p0`) |
| `bank-statements` | nie | 36 | wyciągi bankowe | F≥finance_view (odczyt), F=finance_manage (zapis) | odczyt/usuwanie: `admin`, `ksef_manage`, `invoices_manage` (bez zakresu firm); INSERT: każdy zalogowany | ⚠️ |
| `bank-supporting-documents` | nie | 0 | dokumenty do transakcji | j.w. | `finance_can_view/manage()` + firma | ⚠️* |
| `finance-declarations` | nie | 0 | deklaracje ZUS/US | F≥finance_view / F=finance_manage | `finance_can_view/manage()` + firma | ⚠️* |
| `offer-product-pages` | nie | 155 | strony PDF produktów | odczyt EMP/SP przez generator; zapis P(offers_manage) | ALL: każdy zalogowany | ⚠️ |
| `offer-template-pages` | nie | 28 | strony szablonów ofert | j.w. | polityki `offers_manage` znoszone przez „Authenticated can manage offer template pages” (ALL dla każdego) | ⚠️ |
| `equipment-files` | tak | 28 | instrukcje sprzętu | odczyt PUB/EMP; zapis P(equipment_manage) | INSERT/UPDATE/DELETE: każdy zalogowany | ⚠️ |
| `company-logos` | tak | 12 | loga firm | odczyt PUB; zapis ADM | INSERT/UPDATE/DELETE: każdy zalogowany | ⚠️ |
| `connector-thumbnails` | tak | 29 | miniatury złączy | zapis P(equipment_manage) | zapis: każdy zalogowany | ⚠️ |
| `rental-equipment-images` | tak | 1 | sprzęt podwykonawców | zapis P(subcontractors_manage) | zapis: każdy zalogowany | ⚠️ |
| `service-catalog-images` | tak | 0 | katalog usług | zapis P(subcontractors_manage) | zapis: każdy zalogowany | ⚠️ |
| `email-attachments` | nie | 197 | załączniki e-maili | dostęp do wiadomości | przez RLS `email_attachments` | ✅ |
| `employee-assets` | tak | 2 | avatary, tła | odczyt PUB; zapis OWN | zapis tylko we własnym folderze | ✅ |
| `equipment-images` | tak | 333 | zdjęcia sprzętu | zapis P(equipment_manage) | j.w. | ✅ |
| `vehicle-images` | tak | 18 | zdjęcia pojazdów | zapis P(fleet_manage) | j.w. | ✅ |
| `vehicle-documents` | nie | 0 | dokumenty pojazdów | P(fleet_manage) | j.w. | ✅ |
| `fuel-receipts` | nie | 1 | paragony paliwowe | kierowca ∨ P(fleet_manage) | `can_record_vehicle_operation()` | ✅ |
| `generated-brochures` | nie | 27 | broszury | widoczny wiersz generacji | j.w. | ✅ |
| `location-materials` | nie | 1 | materiały lokalizacji | EMP; zapis P(locations_manage) | j.w. + portal hotelowy przez funkcję | ✅ |
| `mac-crm-sync` | nie | 0 | synchronizacja Mac | SVC | brak polityk | ✅ |
| `mavinci-view` | nie | 5 | media Mavinci View | OWN | własny folder | ✅ |
| `seller-brand-assets` | nie | 6 | materiały marki sprzedawcy | SP (swoje) ∨ opiekun | `seller_brand_asset_access()` | ✅ |
| `seller-demo-pdfs` | nie | 8 | PDF demo dla sprzedawców | opiekun | widoczny wiersz generacji | ✅ |
| `seller-offer-documents` | nie | 14 | dokumenty ofert portalu | SP (swoje) ∨ opiekun | `seller_portal_offer_access_allowed()` | ✅ |
| `signed-contracts` | nie | 1 | podpisane umowy | EVC(v) przez `/bridge` | brak polityk → tylko serwer | ✅ |

## 4. Funkcje (RPC)

Schemat `public`: 1332 funkcje, z czego **868 `SECURITY DEFINER`** (działają z prawami właściciela i **omijają RLS** — muszą same sprawdzać, kto je woła). Z nich:

| Grupa | Liczba | Kto może wywołać |
|---|---|---|
| Funkcje triggerów (nie da się ich wywołać przez API) | 250 | — (159 ma zbędne EXECUTE dla anon — kosmetyka) |
| Bez EXECUTE dla klientów API (tylko triggery, pg_cron, service_role) | 95 | — |
| Wywoływalne przez API | 523 | **319 także anon**, 204 tylko authenticated |

Domyślne uprawnienia Supabase nadawały EXECUTE roli `anon` każdej nowej funkcji — stąd tak duża liczba. Funkcje z `private.*` nie są wystawione przez API. **Po `20261101190000_security_p0`:** anon wykonuje tylko 6 funkcji `SECURITY DEFINER` (wyjątki w 4.5), nowe funkcje nie dostają EXECUTE dla PUBLIC/anon (authenticated i service_role — jak dotąd).

### 4.1 Naprawione w `20261101150000_security_hotfixes` (i `20261101140000`)

| Funkcja | Zmiana |
|---|---|
| `update_monthly_summary` | odebrane EXECUTE |
| `recalculate_bank_transaction_match_state` | odebrane EXECUTE |
| `recalculate_external_invoice_bank_payment` | odebrane EXECUTE |
| `recalculate_local_invoice_bank_payment` | odebrane EXECUTE |
| `employee_work_minutes_for_day` | odebrane EXECUTE |
| `create_employee_overtime_alert` | odebrane EXECUTE |
| `check_all_employee_overtime` | odebrane EXECUTE |
| `delete_employee_hard` | odebrane EXECUTE (było: anon, bez kontroli) |
| `get_active_timer` | dodana kontrola private.can_read_employee_time, bez anon |
| `get_time_summary` | dodana kontrola private.can_read_employee_time, bez anon |
| `seed_statutory_holidays`, `process_public_holiday_responses` (`20261101140000`) | tylko service_role |
| `save_public_holiday`, `delete_manual_public_holiday`, `request_public_holiday_refresh` (`20261101140000`) | tylko authenticated, zapis dni wolnych tylko administrator |

### 4.1a Naprawione w `20261101190000_security_p0`

| Funkcje | Zmiana |
|---|---|
| Wszystkie `SECURITY DEFINER` w `public` (w tym funkcje triggerów) | REVOKE EXECUTE FROM PUBLIC, anon poza wyjątkami z 4.5; `ALTER DEFAULT PRIVILEGES` — nowe funkcje bez EXECUTE dla PUBLIC/anon. Polityki modułów Mavinci LIVE z rolą public → authenticated (predykaty sesji, anon i tak nic nie widział) |
| `match_bank_transaction_to_documents`, `…_with_review` | kontrola `private.require_finance_manage_for_transaction` (finance_manage działalności wyciągu) |
| `approve_absence(uuid,uuid,text)`, `reject_absence(uuid,uuid,text)` | zatwierdzający/odrzucający = pracownik zalogowanej sesji; przeciążenia `(uuid,uuid)` usunięte |
| `get_contact_full_details`, `get_business_clients`, `check_employee_availability` (3), `generate_vehicle_alerts`, `update_vehicle_status_from_alerts`, `get_employee_timeline_data`, `get_calendar_timeline_resources`, `get_vehicle_timeline`, `suggest_employees_for_event`, `get_product_required_skills`, `employees_public_list`, `reserve_selected_equipment` (2), `sync_offer_equipment_to_event`, `sync_equipment_bookings_for_event` | `private.require_crm_employee()` — tylko pracownik CRM (bez anon i konta portalu); wywołanie z triggera i bez sesji API bez zmian. ⚠️ zakres według modułu/wydarzenia — P2-9 |
| `get_event_financial_summary` | `can_view_event_commercials(p_event_id, false)` — ta sama reguła co zakładka Finanse (CRM, mobile, macOS) |
| `get_or_create_documents_subfolder` | pracownik CRM widzący wydarzenie; dawne `invoices_manage` zapisywane jako `finance:invoices` |
| `delete_offer_with_cleanup`, `persist_ksef_send_result_atomic`, `reconcile_local_invoice_with_ksef_atomic`, `confirm_equipment_reservation`, `replace_wedding_card_people`, `create_event_operational_notification`, `create_fleet_compliance_notification`, `get_organization_invoices`, `get_event_invoices`, `get_event_cash_summary`, `get_employee_conflicts`, `get_employee_phase_conflicts`, `claim_email_ai_qualification`, `process_crm_system_health_alerts`, `process_event_operational_alerts`, `process_due_inquiry_followups`, `notify_overdue_event_workflows`, `check_fleet_notifications`, `check_unreturned_vehicles`, `refresh_vehicle_compliance`, `invoke_ai_email_qualification`, `invoke_scheduled_tender_scan`, `update_overdue_invoices`, `reserve_invoice_number_atomic`, `reserve_equipment_for_event`, `reserve_equipment_from_offer`, `unreserve_equipment_from_offer`, `sync_event_equipment_from_offer`, `override_event_equipment`, `remove_event_equipment_from_offer`, `restore_event_equipment_to_offer`, `restore_event_equipment_from_offer`, `save_offer_conflicts`, `resolve_conflict_with_external_rental`, `resolve_conflict_with_substitution`, `pickup_vehicle`, `return_vehicle` (2), `sync_event_vehicle_to_phases`, `create_product_from_subcontractor_service`, `claim_seller_offer_email`, `record_seller_offer_document`, `mark_bank_ai_reports_stale_for_statement_period`, `ensure_contracts_folder`, `ensure_event_workflow_instance`, `get_or_create_documents_folder`, `refresh_event_mavinci_live_modules`, `get_employee_timeline`, `get_event_preflight_core`, `find_employees_with_skills`, `check_event_skill_requirements`, `get_event_required_skills`, `employees_public_by_ids`, `calculate_product_staff_costs`, `resolve_seller_product_price`, `get_vehicle_cost_report`, `check_absence_overlap` | tylko service_role (wołają je Edge Functions kluczem service_role, triggery, pg_cron jako właściciel lub inne funkcje `SECURITY DEFINER`; migracja sprawdza, że nie woła ich żadna funkcja `SECURITY INVOKER` ani polityka) |
| `compensation_can_access` | D1: odczyt ADM ∨ personnel_view ∨ personnel_manage, zapis ADM ∨ personnel_manage (admin_only bez zmian) |
| nowe: `can_edit_website()`, `event_folder_permission_allows()`, `event_folder_id_allows()`, `storage_generated_offer_id()`, `private.crm_employee_allowed()`, `private.require_crm_employee()` | predykaty polityk i kontroli (tylko authenticated/service_role) |

### 4.2 Z kontrolą w treści

390 funkcji (388 nazw). Kryterium: funkcja sprawdza tożsamość/uprawnienia wywołującego (`auth.uid()`, `current_*_employee_id()`, `current_sales_partner_id()`, helpery `can_*`/`is_*`/`finance_can_*`/`personnel_can_*`, `private.require_*`) i przerywa albo filtruje wynik. Ręcznie zweryfikowano wszystkie zapisujące i wykonywalne przez anon; pozostałe — heurystycznie. Do tej grupy należą też predykaty używane w politykach RLS (zwracają `boolean` dla bieżącej sesji). EXECUTE dla anon zdjęte w `20261101190000_security_p0` (P0-1).

`accept_bank_reconciliation_proposal`, `accept_inquiry_offer`, `accept_seller_offer_review`, `accept_warehouse_event`, `acknowledge_accounting_document_followup`, `add_finance_declaration_file`, `add_inquiry_note`, `add_personnel_rate`, `adjust_cable_stock`, `admin_set_employee_section_permissions`, `advance_realization`, `advance_warehouse_event`, `appoint_realization_manager`, `approve_absence`, `approve_mailing_campaign`, `approve_personnel_settlement`, `archive_inquiry`, `assign_personnel_time`, `assign_tender`, `auto_link_vat_account_transfers_for_period`, `begin_ksef_send_with_snapshot_atomic`, `begin_offer_amendment`, `book_seller_owner_profit_commission`, `can_access_marketing_company`, `can_access_mavinci_desktop`, `can_access_mavinci_event`, `can_approve_marketing_campaigns`, `can_assign_inquiry_owner`, `can_contact_event_warehouse`, `can_direct_realization`, `can_edit_operational_event_files`, `can_manage_customer360`, `can_manage_employee_notification_settings`, `can_manage_event_workflows`, `can_manage_external_invoices`, `can_manage_inquiry`, `can_manage_invoice`, `can_manage_invoice_company`, `can_manage_invoices`, `can_manage_marketing_campaigns`, `can_manage_mavinci_event`, `can_manage_mavinci_live_catalog`, `can_manage_personnel_contracts`, `can_manage_quiz_website`, `can_manage_sales_brochures`, `can_manage_webhooks`, `can_read_external_invoices`, `can_receive_warehouse_event`, `can_record_vehicle_operation`, `can_use_event_invoice_source`, `can_use_mavinci_global_module`, `can_use_mavinci_hub`, `can_use_mavinci_module`, `can_user_edit_event`, `can_user_view_event`, `can_view_all_brochure_results`, `can_view_all_employees`, `can_view_brochure_employee`, `can_view_crm_call_activity`, `can_view_customer_segmentation`, `can_view_email_sales_context`, `can_view_event_commercials`, `can_view_event_workflows`, `can_view_inquiry`, `can_view_invoice`, `can_view_invoice_company`, `can_view_invoice_row`, `can_view_invoices`, `can_view_marketing_campaigns`, `can_view_personnel_contracts`, `can_view_private_event_content`, `can_view_sales_brochures`, `can_view_webhooks`, `can_work_inquiry_team`, `can_write_equipment_catalog`, `cancel_mailing_campaign`, `cancel_scheduled_email`, `change_event_contract_template`, `check_equipment_inventory_for_event`, `check_my_overtime_timer`, `check_single_equipment_availability_for_event`, `claim_accounting_delivery`, `claim_inquiry`, `clear_bank_transaction_explanation`, `commission_settlement_can_access`, `compensation_can_access`, `complete_accounting_delivery`, `complete_inquiry_followup`, `complete_seller_event_handoff`, `configure_seller_offer_delivery`, `configure_seller_offer_manager`, `confirm_bank_statement_sources`, `confirm_client_and_request_seller_review`, `confirm_seller_offer_realization`, `convert_proforma_atomic`, `create_event_from_seller_offer`, `create_event_from_seller_offer_at_location`, `create_final_invoice_atomic`, `create_hotel_brochure_campaign`, `create_inquiry_from_tender`, `create_invoice_atomic`, `create_private_meeting`, `crm_contract_permission`, `crm_record_id_scope_allows`, `crm_record_owned`, `crm_record_scope_allows`, `crm_record_scope_limited`, `current_brochure_employee_id`, `current_crm_employee_id`, `current_employee_can_access_company`, `current_employee_can_access_event_company`, `current_employee_can_approve_offers`, `current_employee_can_control_mailboxes`, `current_employee_can_manage_event`, `current_employee_can_view_event`, `current_employee_can_view_tenders`, `current_employee_id`, `current_employee_is_crm_admin`, `current_employee_sells_event`, `current_invoice_employee_id`, `current_marketing_employee_id`, `current_mavinci_employee_id`, `current_sales_partner_id`, `current_session_is_seller_portal`, `current_user_mailbox_notification_allowed`, `current_workflow_employee_id`, `decide_offer_approval`, `delete_employee_completely`, `delete_finance_declaration`, `delete_finance_declaration_line`, `delete_manual_public_holiday`, `delete_meeting_occurrences`, `delete_personnel_collaborator`, `delete_seller_portal_contact`, `dissolve_event_settlement_group`, `duplicate_sales_calculation`, `duplicate_sales_offer`, `eligible_event_vehicle_drivers`, `employee_can_access_company`, `ensure_invoice_ksef_recipient_snapshot`, `finance_can_manage`, `finance_can_view`, `finance_company_visible`, `finish_crm_call_activity`, `flag_bank_match_for_explanation`, `generate_personnel_document`, `get_active_timer`, `get_bank_match_candidates`, `get_bank_reconciliation_month`, `get_bank_transaction_document_picker_items`, `get_chat_unread_counts`, `get_commission_settlements`, `get_crm_data_quality`, `get_crm_health_details`, `get_crm_offer_branding`, `get_crm_security_health`, `get_crm_seller_workspace`, `get_crm_system_health`, `get_current_vehicle_usages`, `get_employee_realization_conflicts`, `get_employee_time_settlement_preview`, `get_event_client_info`, `get_event_details_for_user`, `get_event_finance_access`, `get_event_financial_info`, `get_event_list_invoice_budgets`, `get_event_preflight`, `get_event_realization_assignment`, `get_event_required_mavinci_live_modules`, `get_event_responsibility_team`, `get_event_seller_correspondence`, `get_event_shared_invoice_summary`, `get_event_warehouse_recipients`, `get_event_workflow_attention_count`, `get_event_workflow_readiness`, `get_events_list`, `get_finance_declarations`, `get_financial_report`, `get_inquiry_handoff_candidates`, `get_inquiry_team`, `get_invoice_finance_access`, `get_invoice_settings_for_creation`, `get_mailbox_control_overview`, `get_marketing_eligible_recipients`, `get_my_sales_day`, `get_my_sales_financial_report`, `get_offer_guardrail_status`, `get_or_create_calendar_feed_token`, `get_realization_workspace`, `get_related_invoices`, `get_sales_partner_price_list`, `get_seller_delivery_progress`, `get_seller_event_draft`, `get_seller_hotel_context`, `get_seller_inbox`, `get_seller_messages`, `get_seller_offer_arrangements`, `get_seller_offer_delivery_states`, `get_seller_offer_editor_context`, `get_seller_offer_manager`, `get_seller_organization_branding`, `get_seller_owner_profit`, `get_seller_portal_catalog`, `get_seller_portal_catalog_v2`, `get_seller_portal_commissions`, `get_seller_portal_context`, `get_seller_portal_product`, `get_seller_realization_wizard`, `get_seller_realizations`, `get_time_summary`, `get_vat_transfer_candidates`, `has_inquiry_permission`, `inquiry_task_access_allowed`, `inquiry_team_task_access`, `invoice_finance_is_admin`, `invoice_finance_scope`, `invoice_sales_event_owned`, `is_admin`, `is_crm_admin`, `is_current_meeting_participant`, `is_customer360_admin`, `is_event_manager`, `is_inquiry_admin`, `is_mavinci_live_admin`, `is_meeting_creator`, `is_realization_manager`, `link_bank_transaction_to_declaration`, `link_customer360_activity`, `link_invoice_to_event_settlement`, `link_offer_context`, `link_personnel_employee`, `link_vat_account_transactions`, `list_inquiry_intake_reviews`, `list_seller_conversations`, `list_time_entry_discussions`, `log_mailbox_control_access`, `mark_chat_delivered`, `mark_chat_read`, `mark_inquiry_contacted`, `mark_seller_conversation_read`, `mark_seller_portal_offer_activity`, `mark_seller_review_read`, `match_bank_transaction_to_document`, `mavinci_desktop_access`, `mavinci_desktop_disconnect`, `mavinci_desktop_events`, `mavinci_desktop_heartbeat`, `mavinci_hub_desktop_sessions`, `mavinci_hub_projects`, `mavinci_quiz_show_events`, `mavinci_view_claim_device`, `mavinci_view_delete_device`, `mavinci_view_device_claim_command`, `mavinci_view_device_finish_command`, `mavinci_view_device_pending_commands`, `mavinci_view_device_sync`, `mavinci_view_register_device`, `mavinci_view_set_device_access`, `merge_customer360_contacts`, `open_seller_conversation`, `pause_mailing_campaign`, `personnel_can_access`, `personnel_can_read_contract`, `personnel_can_report_own_time`, `personnel_event_cost`, `personnel_owns_contract`, `personnel_picker_companies`, `personnel_picker_employees`, `personnel_picker_subcontractors`, `post_time_entry_discussion`, `prefill_finance_declaration_lines`, `prepare_inquiry_realization`, `preview_customer360_contact_merge`, `publish_mavinci_event_project`, `qualified_vehicle_drivers`, `realization_operational_only`, `reassign_inquiry`, `reconcile_bank_month`, `reconcile_external_invoice_with_bank_transaction`, `reconcile_external_invoice_with_bank_transaction_with_review`, `reconcile_paid_ksef_invoice_with_bank_transaction`, `reconcile_personnel_payment_with_bank_transaction`, `record_ad_hoc_vehicle_handover`, `record_assigned_vehicle_handover`, `record_commission_settlement`, `record_mailing_campaign_test`, `record_vehicle_fuel_entry`, `refresh_event_payment_plan`, `refresh_mailing_campaign_audience`, `refresh_seller_offer_identity`, `reject_absence`, `reject_bank_reconciliation_proposal`, `remove_finance_declaration_file`, `remove_inquiry`, `remove_personnel_rate`, `reopen_accepted_offer_draft`, `reopen_inquiry_negotiation`, `replace_wedding_people_and_schedule`, `report_vehicle_issue`, `request_offer_approval`, `request_public_holiday_refresh`, `request_seller_offer_review`, `request_seller_offer_review_with_notification`, `reset_analytics_data`, `resolve_inquiry_intake_review`, `resolve_time_entry_discussion`, `resume_mailing_campaign`, `retry_local_sales_ksef`, `review_seller_offer_and_accept`, `review_seller_offer_and_confirm`, `review_seller_offer_in_crm`, `review_seller_offer_resources`, `review_seller_portal_offer`, `revoke_realization_manager`, `sales_can_manage_calculation`, `sales_can_manage_document`, `sales_can_manage_offer`, `sales_commission_visible`, `sales_employee_id`, `sales_finance_file_access`, `sales_finance_is_lead`, `sales_lead_owns_event`, `save_employee_compensation`, `save_employee_time_settlement`, `save_event_settlement_group`, `save_finance_declaration`, `save_finance_declaration_line`, `save_inquiry_ai_turn`, `save_inquiry_analysis`, `save_inquiry_brief`, `save_meeting`, `save_offer_draft_revision`, `save_public_holiday`, `save_sales_partner_price_list`, `save_seller_offer_arrangements`, `save_seller_organization_branding`, `save_seller_owner_profit_review`, `save_seller_portal_client`, `save_seller_portal_contact`, `save_seller_portal_offer`, `save_seller_portal_offer_for_organization`, `save_seller_portal_offer_v2`, `save_seller_portal_offer_v3`, `save_seller_portal_offer_v4`, `save_seller_portal_offer_v5`, `save_seller_portal_offer_with_recommendations`, `save_seller_portal_offer_with_request`, `save_seller_portal_settings`, `schedule_mailing_campaign`, `select_inquiry_calculation`, `seller_arrangements_access`, `seller_brand_asset_access`, `seller_can_edit_organization_branding`, `seller_conversation_access`, `seller_conversation_summary`, `seller_directory_crm_row_access`, `seller_hotel_material_read_access`, `seller_hotel_read_access`, `seller_offer_can_configure`, `seller_offer_can_create_event`, `seller_offer_can_manage`, `seller_offer_workflow_state`, `seller_portal_offer_access_allowed`, `seller_workspace_brand_access`, `seller_workspace_offers_access`, `seller_workspace_staff_access`, `send_event_warehouse_message`, `send_seller_message`, `set_chat_message_reaction`, `set_event_equipment_loaded`, `set_event_workflow_requirement_override`, `set_inquiry_team_member`, `set_mavinci_module_access`, `snooze_inquiry_followup`, `submit_mailing_campaign_for_approval`, `submit_seller_realization_information`, `sync_event_workflow_tasks`, `test_auth_context`, `time_discussion_actor`, `time_entry_audit_actor`, `undo_bank_declaration_payment`, `undo_bank_match`, `undo_bank_personnel_payment`, `unmatch_bank_transaction`, `update_accepted_offer_items`, `update_invoice_draft_atomic`, `update_seller_realization_wizard`, `void_employee_time_settlement`.

### 4.3 Bez kontroli, nieszkodliwe

45 funkcji — obliczenia, sprawdzanie dostępności sprzętu/pojazdów, predykaty dla podanego identyfikatora, podgląd numeru faktury, stuby i funkcje publiczne strony. Zostawić; EXECUTE dla anon zdjęte w `20261101190000_security_p0` poza `get_public_brand_theme` i `update_page_analytics_duration`.

`can_event_be_ready_for_execution`, `can_prepare_warehouse_event`, `can_vehicle_tow_trailer`, `check_employee_vehicle_compatibility`, `check_equipment_availability_for_event`, `check_offer_cart_equipment_conflicts`, `check_offer_cart_equipment_conflicts_v2`, `check_offer_product_equipment_conflicts`, `check_vehicle_availability`, `crm_record_base_owned`, `employee_is_eligible_customer_owner`, `event_workflow_requirement_is_met`, `finance_detect_category`, `find_rental_alternatives`, `generate_offer_number`, `get_alternative_equipment`, `get_available_equipment_quantity`, `get_available_equipment_quantity_for_dates`, `get_available_icons`, `get_available_vehicles_for_event`, `get_cable_availability_for_event`, `get_employee_notification_preferences`, `get_equipment_details`, `get_equipment_list`, `get_equipment_phase_conflicts`, `get_my_realizations`, `get_offer_equipment_for_reservation`, `get_public_brand_theme`, `get_unread_messages_count`, `is_conversation_participant`, `is_event_driver`, `is_event_participant`, `is_inquiry_team_member`, `is_vehicle_available`, `lookup_company_by_nip`, `peek_next_invoice_number`, `preview_invoice_number`, `save_crm_offer_branding`, `save_seller_default_offer_organization`, `seller_offer_source_key`, `should_notify_employee`, `time_discussion_admin`, `update_page_analytics_duration`, `working_time_norm`.

### 4.4 Bez kontroli, zapisujące lub ujawniające dane — do naprawy

Stan z audytu (przed P0). **Wszystkie wiersze tej tabeli są zamknięte** — w 20261101165000 (`delete_local_invoice_and_repair_numbering`, `finish_ksef_send_attempt_failure_atomic`, `import_costs_from_accepted_offer`, `generate_invoice_number`, `refresh_invoice_settlement_allocations`, `check_and_notify_invoice_payments`), 20261101180000 (`process_due_crm_call_followups`) i `20261101190000_security_p0` (pozostałe — szczegóły w 4.1a). Funkcje oznaczone tam ⚠️ P2-9 mają kontrolę „pracownik CRM”, ale jeszcze nie regułę modułu.

| Funkcje | Co robi | Waga |
|---|---|---|
| `delete_local_invoice_and_repair_numbering` | usuwa dowolną fakturę niewysłaną do KSeF i cofa licznik numeracji | ❌ |
| `delete_offer_with_cleanup` | usuwa dowolną ofertę razem z pozycjami, umowami, historią i sprzętem wydarzenia | ❌ |
| `persist_ksef_send_result_atomic` | zapisuje na fakturze wynik wysyłki do KSeF (numer KSeF, XML, status przyjęcia) | ❌ |
| `finish_ksef_send_attempt_failure_atomic` | ustawia fakturze status błędu/oczekiwania KSeF i wpis historii (p_actor z klienta) | ❌ |
| `reconcile_local_invoice_with_ksef_atomic` | wiąże lokalną fakturę z dokumentem KSeF | ❌ |
| `match_bank_transaction_to_documents`, `match_bank_transaction_to_documents_with_review` | rozlicza transakcję bankową z fakturami/dokumentami (zmienia status płatności) | ❌ |
| `import_costs_from_accepted_offer` | dopisuje koszty wydarzenia na podstawie oferty | ❌ |
| `confirm_equipment_reservation` | ustawia ofertę jako zaakceptowaną i rezerwuje sprzęt | ❌ |
| `approve_absence(p_absence_id uuid, p_approved_by uuid)`, `reject_absence(p_absence_id uuid, p_approved_by uuid)` | zatwierdza/odrzuca dowolną nieobecność, z dowolnym „zatwierdzającym” (druga wersja z kontrolą istnieje obok) | ❌ |
| `replace_wedding_card_people` | nadpisuje dane osobowe gości karty weselnej (imiona, telefony, e-maile, Instagram) | ❌ |
| `create_event_operational_notification`, `create_fleet_compliance_notification` | tworzy powiadomienia z dowolnym tytułem i treścią do pracowników (ryzyko phishingu) | ❌ |
| `get_contact_full_details` | zwraca pełny rekord kontaktu/organizacji (m.in. PESEL, nr dowodu, NIP, adres) z powiązaniami | ❌ |
| `get_business_clients` | lista klientów z NIP, e-mailem, telefonem i adresem | ❌ |
| `get_organization_invoices`, `get_event_invoices`, `get_event_cash_summary`, `get_event_financial_summary` | faktury, kasa, przychody, koszty i zysk organizacji/wydarzenia — blokada dotyczy tylko kierownika realizacji, anon przechodzi | ❌ |
| `check_employee_availability (3 wersje)`, `get_employee_conflicts`, `get_employee_phase_conflicts` | nieobecności pracownika z rodzajem (np. „Zwolnienie lekarskie”) i jego wydarzenia | ❌ |
| `claim_email_ai_qualification` | pobiera i blokuje kolejkę kwalifikacji e-maili przez AI (zwraca wiersze analizy) | ❌ |
| `generate_invoice_number (2 wersje)`, `reserve_invoice_number_atomic` | zwiększają liczniki numeracji faktur (luki w numeracji) | ⚠️ |
| `reserve_equipment_for_event`, `reserve_equipment_from_offer`, `reserve_selected_equipment`, `unreserve_equipment_from_offer`, `sync_equipment_bookings_for_event`, `sync_event_equipment_from_offer`, `sync_offer_equipment_to_event`, `override_event_equipment`, `remove_event_equipment_from_offer`, `restore_event_equipment_to_offer`, `restore_event_equipment_from_offer`, `save_offer_conflicts`, `resolve_conflict_with_external_rental`, `resolve_conflict_with_substitution` | zmieniają rezerwacje i listy sprzętu dowolnych wydarzeń/ofert | ⚠️ |
| `pickup_vehicle`, `return_vehicle (2 wersje)`, `sync_event_vehicle_to_phases` | rejestrują wydanie/zwrot pojazdu w imieniu dowolnego pracownika | ⚠️ |
| `create_product_from_subcontractor_service` | tworzy produkt w katalogu ofert | ⚠️ |
| `claim_seller_offer_email`, `record_seller_offer_document` | kontrola oparta na identyfikatorze konta podanym przez wywołującego (p_actor) | ⚠️ |
| `refresh_invoice_settlement_allocations`, `mark_bank_ai_reports_stale_for_statement_period`, `update_overdue_invoices` | przeliczenia finansowe na żądanie dowolnej osoby | ⚠️ |
| `invoke_ai_email_qualification`, `invoke_scheduled_tender_scan` | wywołują Edge Functions z kluczem z Vault (koszty AI/HTTP) | ⚠️ |
| `process_crm_system_health_alerts`, `process_due_crm_call_followups`, `process_event_operational_alerts`, `process_due_inquiry_followups`, `notify_overdue_event_workflows`, `check_and_notify_invoice_payments`, `check_fleet_notifications`, `check_unreturned_vehicles`, `refresh_vehicle_compliance`, `generate_vehicle_alerts`, `update_vehicle_status_from_alerts` | zadania harmonogramu (powiadomienia, alerty, przeliczenia) — może je wyzwolić każdy | ⚠️ |
| `ensure_contracts_folder`, `ensure_event_workflow_instance`, `get_or_create_documents_folder`, `get_or_create_documents_subfolder`, `refresh_event_mavinci_live_modules` | tworzą foldery/instancje w dowolnym wydarzeniu | ⚠️ |
| `get_employee_timeline`, `get_employee_timeline_data`, `get_calendar_timeline_resources`, `get_vehicle_timeline`, `get_event_preflight_core` | grafik ludzi i pojazdów z nazwami wydarzeń, stan przygotowania wydarzenia | ⚠️ |
| `find_employees_with_skills`, `suggest_employees_for_event`, `check_event_skill_requirements`, `get_event_required_skills`, `get_product_required_skills` | nazwiska i kompetencje pracowników | ⚠️ |
| `employees_public_list`, `employees_public_by_ids` | imię, nazwisko, avatar wszystkich aktywnych pracowników (nie tylko ze strony WWW) | ⚠️ |
| `calculate_product_staff_costs`, `resolve_seller_product_price`, `get_vehicle_cost_report` | koszty obsługi produktu, ceny sprzedawcy, koszty floty | ⚠️ |
| `check_absence_overlap` | czy pracownik ma nieobecność w terminie (bez rodzaju) | ⚠️ |

### 4.5 Zasady dla funkcji `SECURITY DEFINER`

- Pierwsza linia: kontrola tożsamości i uprawnień (`current_employee_is_crm_admin()`, `finance_can_*`/poziom firmy, `current_employee_can_view_event()`, `sales_can_manage_*`, `personnel_can_access()` …) zakończona `RAISE EXCEPTION … USING ERRCODE='42501'`.
- Nigdy nie ufaj parametrom typu `p_actor`, `p_employee_id`, `p_approved_by` jako tożsamości — bierz ją z `auth.uid()`.
- `SET search_path = pg_catalog, public` (lub pusty) w definicji.
- Funkcje wołane tylko przez triggery/pg_cron/Edge Functions: `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated; GRANT … TO service_role`.
- Funkcje wykonywalne przez anon (lista zamknięta, sprawdzana przez kontrolę końcową `20261101190000_security_p0`): `get_public_brand_theme`, `update_page_analytics_duration` (strona WWW) oraz `mavinci_view_device_sync`, `mavinci_view_device_pending_commands`, `mavinci_view_device_claim_command`, `mavinci_view_device_finish_command` (urządzenia Mavinci View uwierzytelniane sekretem urządzenia). Formularze kontaktowe i zaproszenia nie używają funkcji (INSERT do tabel / serwer z service_role). Nowa funkcja dla anon: jawne `GRANT EXECUTE … TO anon` i wpis na tę listę (oraz w tablicy wyjątków migracji P0, jeśli migracja ma być uruchamiana ponownie).
- Od `20261101190000_security_p0` nowe funkcje (właściciel `postgres`) nie dostają EXECUTE dla PUBLIC ani anon; w `public` authenticated i service_role dostają je domyślnie. Funkcja pomocnicza w `private` używana w polityce RLS lub w funkcji `SECURITY INVOKER` wymaga jawnego `GRANT EXECUTE … TO authenticated`.
- Polityka nadana rolom `public`/`anon` nie może wołać funkcji `SECURITY DEFINER` bez EXECUTE dla anon (zapytanie anon skończy się błędem „permission denied for function”) — politykę dla zalogowanych nadawaj `TO authenticated`.
- Funkcja wołana z CRM i jednocześnie z triggera: kontrola przez `private.require_crm_employee()` / `private.crm_employee_allowed()` — sprawdza sesję API (anon/authenticated), a w triggerze (`pg_trigger_depth() > 0`) i bez sesji (pg_cron, service_role) przepuszcza. Funkcji wołanej przez funkcję `SECURITY INVOKER` (także trigger) nie odbieraj authenticated.
- Funkcje zwracające dane muszą filtrować wiersze tak samo jak RLS tabeli (najprościej: `SECURITY INVOKER`, jeśli nie trzeba omijać RLS).

## 5. Interfejs

### 5.1 CRM (Next.js)

| Mechanizm | Plik | Co robi | Uwagi |
|---|---|---|---|
| Layout CRM | `src/app/(crm)/crm/layout.tsx`, `CRMClientLayout.tsx` | wymaga sesji i rekordu pracownika (`getCurrentEmployeeServerCached`) | konta portalu sprzedawcy nie wejdą do UI CRM; **brak centralnej blokady tras wg uprawnień** |
| Menu | `src/lib/CRM/navigation/registry.server.ts` + `getNavigationForUser.server.ts` | ukrywa pozycje bez uprawnień: `manage ⇒ view`; `contracts/offers/events_create ⇒ view`; `equipment_manage ⇒ events/calendar`; `time_tracking_view` zawsze; kierownik realizacji (`get_my_realizations`) ⇒ wydarzenia i kalendarz | tylko ukrywa link — wejście z adresu działa |
| `PermissionGuard` | `src/components/crm/PermissionGuard.tsx` | sprawdza `canView(module)` lub konkretne uprawnienie po stronie klienta | użyty tylko w: `settings/ksef`, `invoices` (lista, szczegóły), `contacts`, `subcontractors/layout`, `event-categories` |
| `canViewModule/canManageModule/canCreateInModule` | `src/hooks/useCurrentEmployee.ts` → `src/lib/permissions.ts` | przyciski i sekcje (sprzęt ×15, faktury ×9, finanse ×9, pracownicy, umowy, lokalizacje, kontakty…) | logika UI, nie ochrona danych |
| Zakładki wydarzenia | `EventDetailPageClient.tsx` (`visibleEventTabs` z `event_tabs`, `canViewCommercials`, `hasLimitedAccess`) | ukrywa zakładki per profil; finanse — twórca, admin, `finances_*`, `offers_*`, `invoices_*` | baza: `can_view_event_commercials` = admin, twórca, `finances_*`, **`contracts_*`**, `invoices_*` (bez `offers_*`) — rozjazd (ℹ️ D8) |
| Strony bez kontroli na poziomie strony/layoutu | 49 plików `page.tsx`, m.in. `/crm/clients`, `/crm/employees`, `/crm/employees/contracts`, `/crm/employees/collaborators`, `/crm/campaigns`, `/crm/mailing`, `/crm/settings/my-companies`, `/crm/settings/email-accounts/control`, `/crm/tenders/config`, `/crm/page/analytics`, `/crm/admin/site-images` | ochrona danych zależy od RLS (i ewentualnych sprawdzeń w komponentach) | tam, gdzie RLS jest otwarte (klienci, pracownicy, analityka, obrazy strony) — strona pokaże wszystko każdemu pracownikowi |
| Trasy serwerowe `/bridge/*` z kluczem service_role | `src/app/bridge/**` | sprawdzają sesję i uprawnienia przez RPC (`can_manage_invoice`, `crm_contract_permission`, `finance_can_manage`, `sales_can_manage_calculation`…) | ✅ (sprawdzone heurystycznie: tenders/recalculate, tasks/sync, brochures, invoices/invoice-pdf, saldeo, reset-employee-password, ksef/send, events/*-pdf, contracts/generate, seller-demo) |

### 5.2 Aplikacja mobilna (`mobile/`)

| Mechanizm | Plik | Co robi |
|---|---|---|
| Uprawnienia | `mobile/src/lib/permissions.ts` | `isAdmin`, `hasPermission`, `canView` (+ `has_realizations` ⇒ wydarzenia/kalendarz), `canManage`, `canCreate`, `canCreateInquiry`, `canViewEventFinances`, `MENU_ITEMS` |
| `PermissionGate` | `mobile/src/components/PermissionGate.tsx` | stosy: Sprzęt, Wydarzenia, Zapytania, Zadania, Komunikator; ekrany: Wiadomości, Kalendarz, Przetargi, Flota, Czas pracy, Pracownicy |
| Kontakty | `ClientsScreen.tsx` | `canView('contacts')` w ekranie |
| Finanse wydarzenia | `EventDetailScreen.tsx` | pobiera `budget`, `expected_revenue`, `billing_*` tylko gdy `canViewEventFinances` (admin, `finances_*`, `offers_*`, `invoices_*`) |
| Moduły tylko w CRM | `openInCrmWeb` | oferty, faktury, finanse, ustawienia — otwierane w przeglądarce |

### 5.3 Rozjazdy CRM ↔ mobile ↔ baza

| # | Temat | CRM | Mobile | Baza | Ocena |
|---|---|---|---|---|---|
| 1 | Zakładki wydarzenia wg profilu (`event_tabs`) | ukrywa (np. DJ: tylko Przegląd i Pliki) | **ignoruje** — pokazuje Szczegóły, Zespół, Agendę, Flotę, Checklistę, Pliki | nie zna `event_tabs` | ⚠️ mobile pokazuje więcej niż CRM — P1 |
| 2 | Finanse wydarzenia | twórca ∨ admin ∨ finances/offers/invoices | admin ∨ finances/offers/invoices (bez twórcy) | admin ∨ twórca ∨ finances/contracts/invoices; kolumny `events.budget…` czyta każdy, kto widzi wydarzenie | ⚠️ ujednolicić (D8); kolumny finansowe chronione tylko w UI |
| 3 | `*_create ⇒ view` (oferty, umowy, wydarzenia) | tak | nie | zależnie od polityki | mobile węziej — OK, ale funkcjonalnie niespójne |
| 4 | Poziomy finansów per firma | w toku (`EmployeePermissionsTab`, `useInvoiceFinanceAccess`) | w toku (`mobile/src/lib/permissions.ts`); moduły finansowe tylko w CRM | `20261101165000` + `20261101171000` ✅ | do domknięcia w tym samym PR |
| 5 | Czas pracy | widoczny zawsze, zakres z RLS | to samo | `time_tracking_view` = wszyscy + stawki | spójne, ale za szeroko (❌ `time_entries`) |
| 6 | Pracownicy | menu `employees_view` | `PermissionGate employees`; ekran pobiera `permissions`, `role`, telefony | każdy zalogowany czyta wszystkie kolumny | ❌ ochrona tylko w UI |
| 7 | Kontakty / klienci | `PermissionGuard contacts` | `canView('contacts')` | każdy zalogowany (klienci: także portal sprzedawcy) | ❌ ochrona tylko w UI |
| 8 | Powiadomienia | lista z `notification_recipients` | to samo | odczyt i oznaczanie tylko przez odbiorcę; tworzą funkcje serwera (`20261101190000_security_p0`) | ✅ |

### 5.4 Ochrony tylko w interfejsie (baza ich nie wymusza)

1. Kolumny finansowe wydarzenia (`events.budget`, `expected_revenue`, `actual_revenue`, `estimated_costs`, `actual_costs`, `cash_budget`, `final_cost`) — widzi je przez API każdy, kto widzi wydarzenie (np. przypisany technik); historia zmian budżetu w `event_audit_log` — każdy zalogowany.
2. Zakładki wydarzenia/kontaktu z profilu (`event_tabs`, `contact_tabs`).
3. Wrażliwe kolumny pracowników (`phone_private`, `address_*`, `nip`, `personal_email`, `notes`, `permissions`, `history`) — UI pokazuje je tylko uprawnionym.
4. Koszty i marże katalogu ofert (`offer_products.cost_*`, `staff_cost*`, `subcontractor_economic_cost`, `offer_product_staff.hourly_rate`).
5. Stawki godzinowe w ewidencji czasu (`time_entries.hourly_rate`) dla osób z `time_tracking_view`.
6. Menu i strony modułów: klienci, kontakty, organizacje, podwykonawcy, szablony e-maili, analityka strony — RLS otwarte.
7. ~~Lista powiadomień (UI filtruje po odbiorcy, baza zwraca wszystkie).~~ ✅ `20261101190000_security_p0` — baza zwraca tylko powiadomienia odbiorcy.
8. Portal sprzedawcy (✅ częściowo w `20261101190000_security_p0`: RESTRICTIVE na tabelach bez logiki portalu, powiadomienia — tylko własne): blokada wejścia do CRM tylko w layoucie — przez API konto portalu czyta m.in. `clients`, `contact_*`, `notifications`, `employee_absences`, `event_audit_log`, `subcontractors`, `employee_assignments`.

## 6. Lista poprawek

Priorytety: **P0** — natychmiast (dostęp anonimowy, portal sprzedawcy, możliwość usuwania/fałszowania danych finansowych); **P1** — w najbliższym wydaniu (pracownicy widzą/zmieniają za dużo); **P2** — porządki. „Ryzyko” = szansa, że poprawka zepsuje istniejącą funkcję. ℹ️ = wymaga decyzji właściciela (sekcja 6.4).

### 6.1 P0

| # | Obiekt | Zmiana | Kogo dotyczy | Ryzyko |
|---|---|---|---|---|
| ✅ P0-1 | Wszystkie funkcje `SECURITY DEFINER` w `public` | `REVOKE EXECUTE … FROM PUBLIC, anon` dla wszystkich poza listą publiczną (`get_public_brand_theme`, `update_page_analytics_duration`, funkcje zaproszeń/formularzy z tokenem); `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon` — **✅ `20261101190000_security_p0`**: odebrane EXECUTE PUBLIC/anon na 462 funkcjach `SECURITY DEFINER` (303 wywoływalne + 159 funkcji triggerów; 2 przeciążenia usunięte); wyjątki — 6 funkcji (4.5: motyw strony, czas na stronie, 4 funkcje urządzeń Mavinci View z sekretem urządzenia); `ALTER DEFAULT PRIVILEGES` (globalnie dla PUBLIC + w `public` dla anon); 25 polityk Mavinci LIVE `public` → `authenticated` | anon | niskie — strona publiczna woła tylko funkcje `seller_*` portalu (po zalogowaniu) i 2 publiczne; sprawdzić `grep .rpc(` w `src/app/(public)` |
| ✅ P0-2 | Funkcje ❌ z sekcji 4.3 (`delete_local_invoice_and_repair_numbering`, `delete_offer_with_cleanup`, `persist_ksef_send_result_atomic`, `finish_ksef_send_attempt_failure_atomic`, `reconcile_local_invoice_with_ksef_atomic`, `match_bank_transaction_to_documents*`, `import_costs_from_accepted_offer`, `confirm_equipment_reservation`, `approve/reject_absence(uuid,uuid)`, `replace_wedding_card_people`, `create_*_notification`, `get_contact_full_details`, `get_business_clients`, `get_*_invoices`, `get_event_cash_summary`, `get_event_financial_summary`, `check_employee_availability`, `claim_email_ai_qualification`) | dodać kontrolę na początku (`can_manage_invoice()`/poziom F, `sales_can_manage_offer()`, `can_view_event_commercials()`, `absences_manage`, `can_user_edit_event()`, `can_view_crm_call_activity`/`contacts_view`…); funkcje wołane tylko przez Edge Functions/triggery (KSeF persist/finish, `claim_email_ai_qualification`, `create_*_notification`, zadania cron) — `REVOKE … FROM authenticated`, `GRANT … TO service_role`; usunąć przeciążenia `approve/reject_absence(uuid,uuid)` — **✅ `20261101190000_security_p0`**: kontrola dodana w 23 wersjach funkcji wołanych z CRM/mobile/macOS (4.1a), 59 funkcji tylko dla service_role (Edge Functions, triggery, pg_cron, inne funkcje SECURITY DEFINER), usunięte `approve/reject_absence(uuid,uuid)`; `advance_realization` miała już kontrolę (`is_realization_manager`) — bez zmian | anon, wszyscy zalogowani | średnie — sprawdzić wywołania w `src/` i `supabase/functions` (KSeF wysyła przez Edge Function z service_role) |
| ✅ P0-3 | 17 tabel WWW z zapisem dla public (`casino_content_items/sections/separators`, `conferences_related_services`, `dj_related_services`, `seo_city_content`, `site_images`, `technical_stage_related_services`, `*_page_images` ×9) + buckety `site-images`, `conferences-gallery` | polityki zapisu → `TO authenticated` z `P(website_edit)` (lub `can_manage_quiz_website()`); usunąć polityki storage dla anon/public — **✅ `20261101190000_security_p0`**: 17 tabel — usunięte polityki zapisu public/anon, zapis `website_editors_write` (`can_edit_website()` = administrator ∨ website_edit ∨ page_manage, bez konta portalu); `conferences-gallery` — zapis redaktor strony; `site-images` — zapis pracownik CRM (bucket używają też ekrany sprzętu, zestawów i skrzynek), anon tylko INSERT do `cv-uploads/` (CV z formularza) | anon | niskie — CRM edytuje treści jako zalogowany z `website_edit` |
| ✅ P0-4 | Globalna blokada portalu sprzedawcy | dodać RESTRICTIVE `NOT current_session_is_seller_portal()` (FOR ALL TO authenticated) na każdej tabeli bez logiki portalu: m.in. `clients`, `contact_history/organizations/persons/reminders`, `organization_decision_makers`, `organization_notes`, `subcontractor*`, `employee_absences`, `employee_certifications`, `employee_driving_licenses`, `employee_signatures`, `employee_skills`, `employee_assignments`, `event_vehicles`, `event_audit_log`, `notifications`, `notification_recipients`, `email_*templates*`, `task_assignees`, `equipment_*`, `locations`, `access_levels`, `public_holidays` — **✅ `20261101190000_security_p0`**: `seller_portal_deny_<tabela>` na 44 tabelach (lista + wszystkie `subcontractor*`, `email_*template*`, `equipment_*`; `equipment_items` miała już blokadę). Pominięte `notifications`/`notification_recipients` — portal czyta i oznacza własne powiadomienia (P0-5 zawęża je do odbiorcy) | konta portalu (3) | niskie — portal korzysta z funkcji `seller_*`; sprawdzić ekrany portalu czytające `locations`/katalog |
| ✅ P0-5 | `notifications`, `notification_recipients` | usunąć „Everyone can view notifications”, „Authenticated users can create/update/delete notifications”, polityki anon; zostawić odczyt/aktualizację przez odbiorcę; `notification_recipients` INSERT tylko funkcje serwera — **✅ `20261101190000_security_p0`**: usunięte 6 polityk `notifications` i 2 polityki INSERT `notification_recipients`; odbiorca zmienia tylko `is_read`/`read_at` (uprawnienia kolumn); bez uprawnień anon do obu tabel. Kod CRM/mobile/Edge nie wstawia bezpośrednio (nieużywane `useNotifications.ts` i `mobile/src/services/assignmentNotifications.ts` opisane komentarzem) | wszyscy zalogowani, anon | niskie — kod CRM/mobile nie wstawia powiadomień bezpośrednio (tylko przykład w `NOTIFICATION_EMAIL_USAGE.md`) |
| ✅ P0-6 | `employees` (anon) | zamiast „Public can view website employees” — widok `public_website_employees` (imię, nazwisko, nick, avatar, bio, linki, kolejność) z GRANT dla anon; usunąć politykę anon z tabeli — **✅ `20261101190000_security_p0`**: widok `website_team_members` (security_invoker = false, stała lista pól, `show_on_website`) z GRANT dla anon; usunięta „Public can view website employees”; `/bridge/team-members` czyta widok, martwe zapytanie anon w `/zespol` usunięte | anon (2 osoby na stronie) | niskie — strona czyta zespół serwerowo (`getTeamMembers`, service_role) |
| ✅ P0-7 | `event_contact_persons`, `vehicles` | `event_contact_persons`: R EV(v), W EV(m); `vehicles`: usunąć `vehicles_insert` dla public — **✅ `20261101190000_security_p0`** | anon | niskie |
| ✅ P0-8 | `ksef_credentials` | brak SELECT dla authenticated; zapis przez RPC admina; status połączenia przez widok bez tokenów; Edge Function `ksef-api` czyta przez service_role — **✅ 20261101165000 + `20261101190000_security_p0`**: odczyt tylko finance_manage działalności i tylko kolumn bez sekretów; token czyta `/bridge/ksef/auth/token` kluczem service_role po kontroli; CRM (`KSeFConfigForm`, `KSeFIntegrationPanel`) wybiera jawne kolumny, certyfikat po `certificate_uploaded_at` | konto z `invoices_manage` | średnie — `settings/ksef` musi czytać status z widoku/RPC |
| ✅ P0-9 | Storage `external-invoices`, `generated-offers` | usunąć „Authenticated users can view/upload/delete invoice files” (zostają `can_read/manage_external_invoices()` → docelowo poziom F); `generated-offers` — odczyt wg widoczności oferty (ścieżka z `offer_id`), zapis SALES/`offers_manage` — **✅ 20261101165000 (external-invoices) + `20261101190000_security_p0` (generated-offers)** | wszyscy zalogowani, portal | średnie — sprawdzić ścieżki plików w generatorze PDF |
| ✅ P0-10 | `employee_assignments` (anon) — znalezione | usunięte „Allow public to read invitations by token” / „… update invitation status by token” (strona `/invitation/*` obsługuje token kluczem service_role) — **✅ `20261101190000_security_p0`** | anon (lista tokenów zaproszeń) | niskie |
| ✅ P0-11 | Folder „Faktury” w plikach wydarzenia — znalezione | `required_permission` `invoices_manage` (od 20261101165000 nic nie nadaje, baza go nie sprawdzała) → `finance:invoices`; RESTRICTIVE na `event_folders`/`event_files`: poziom finansów działalności wydarzenia ≥ invoices albo sprzedawca wydarzenia z poziomem sales; trasa `invoice-pdf` tworzy folder z nowym oznaczeniem — **✅ `20261101190000_security_p0`** | rola manager i autor wydarzenia bez finansów działalności (tracą wgląd w PDF-y faktur w plikach) | niskie — plik nadal pobieralny po publicznym URL (P1-12) |

### 6.2 P1

| # | Obiekt | Zmiana | Kogo dotyczy | Ryzyko |
|---|---|---|---|---|
| P1-1 | `contacts`, `clients`, `organizations`, `contact_persons`, `contact_organizations`, `organization_decision_makers`, `contact_history`, `contact_reminders`, `organization_notes` | R: `contacts_view`/`clients_view` ∨ opiekun ∨ powiązanie z widocznym wydarzeniem (przez RPC tylko nazwa/telefon kontaktu); W: `*_manage` ∨ opiekun; PESEL/nr dowodu/konto — tylko `contacts_manage`/ADM (widok bez tych kolumn albo osobna tabela) | DJ, Technik, Magazyn, Freelancer, Pracownik tracą wgląd w bazę klientów | średnie — ekrany wydarzenia pokazujące klienta technikom muszą korzystać z RPC/widoku |
| P1-2 | `employee_assignments` | INSERT/DELETE: EV(m) ∨ `events_manage`; SELECT: zespół widocznego wydarzenia, własne, `calendar_view`; `invitation_token` ukryty (osobna tabela lub brak SELECT kolumny dla authenticated); akceptacja przez token — RPC | wszyscy zalogowani, portal | średnie — zaproszenia e-mail i strona `/crm/events/invitation/*` |
| P1-3 | `event_vehicles`, `subcontractor_tasks`, `subcontractor_contracts`, `subcontractors`, `equipment_bookings`, `equipment_units`, `equipment_unit_events` | usunąć polityki „Allow/Authenticated users can … (true)”; zostają polityki z EV(m)/`fleet_manage`/`equipment_manage`/`subcontractors_manage`; stawki podwykonawców tylko EVC | wszyscy zalogowani | średnie — sprawdzić zapisy z mobile (Flota, Sprzęt) |
| P1-4 | `event_audit_log` (+ widok) | SELECT: EV(v); wpisy pól finansowych (`budget` …) tylko EVC(v); INSERT tylko triggery (REVOKE INSERT) | wszyscy zalogowani | niskie — zakładka Historia w CRM |
| P1-5 | `employee_absences` | SELECT: OWN ∨ `absences_manage` ∨ ADM; reszta — funkcja dostępności bez rodzaju; `check_employee_availability` bez rodzaju nieobecności dla nieuprawnionych | wszyscy zalogowani | średnie — kalendarz i planowanie zespołu |
| P1-6 | `time_entries` (+ `admin_time_entries_view`), pakiety | pakiety Technik/Realizator, Magazyn ×2, Freelancer: `time_tracking_view` → `time_tracking_view_own` (ℹ️ D5 dla Event Managera); `hourly_rate` widoczna tylko kadrom/ADM (widok bez stawki lub uprawnienia kolumn) | 6 osób traci wgląd w cudzy czas i stawki | niskie |
| P1-7 | ✅ Finanse firmy — wdrożone w `20261101165000` (produkcja 01.11.2026) i `20261101171000` | przepisać `finance_can_view/manage()`, `finance_company_visible()`, `can_view_invoice_row()`, `can_manage_invoice_company()`, `can_read/manage_external_invoices()`, `compensation_can_access()`, `commission_settlement_can_access()` na poziomy; usunąć stare polityki z `bank_statements_*`, `ksef_manage`, globalnym `invoices_*` (`bank_statements`, `bank_transactions`, `ksef_invoices`, `ksef_credentials`, `ksef_sync_log`, `monthly_financial_summaries`, `my_companies`, bucket `bank-statements`); `ksef_sync_log` INSERT tylko SVC | Manager, Zarząd, Finanse, sprzedawca | średnie — prowadzi to inny wątek; po wdrożeniu ⚠️* → ✅ |
| P1-8 | `event_commissions`, `event_cash_transactions` | dodać EV(v) ∧ firma do polityk `finances_*` | posiadacze `finances_*` | niskie |
| P1-9 | `employees` (zalogowani) | dla pozostałych pracowników widok/RPC „katalog” (ℹ️ D3); pełne kolumny: OWN ∨ `employees_view` ∨ ADM (uprawnienia kolumn lub osobna tabela `employee_private`) | wszyscy zalogowani | wysokie — wiele zapytań CRM/mobile pobiera `employees.*`, `permissions`, `role` |
| P1-10 | Mobile: zakładki wydarzenia | `EventDetailScreen` filtruje zakładki wg `event_tabs` (pracownik → pakiet) i `hasLimitedAccess` jak CRM; wspólna kopia `eventTabs` w `check-shared-copies.mjs` | DJ, Technik, Pracownik, Freelancer | niskie |
| ✅ P1-11 | `compensation_settings`, `employee_compensation` | ℹ️ D1: ADM ∨ `personnel_manage` (bez globalnego `finances_view`); pracownik widzi własną — **✅ D1 w `20261101190000_security_p0`** (odczyt także personnel_view) | posiadacze `finances_*`, `employees_manage` | niskie |
| P1-12 | Storage `event-files`, `chat-attachments` | buckety prywatne + podpisane URL (`createSignedUrl`); polityki zapisu wg EV(m)/uczestnika rozmowy | wszyscy (link publiczny) | wysokie — 10 miejsc w kodzie używa `getPublicUrl` dla tych bucketów; stare linki przestaną działać |

### 6.3 P2

| # | Obiekt | Zmiana | Ryzyko |
|---|---|---|---|
| P2-1 | 24 tabele WWW z zapisem dla każdego zalogowanego (sekcja 3.13) + `available_icons`, `footer_templates` | zapis tylko `website_edit` | niskie |
| P2-2 | Słowniki: `skills`, `skill_categories`, `certification_types`, `employee_skills`, `employee_certifications`, `employee_driving_licenses`, `vehicle_attribute*`, `vehicle_alerts`, `offer_product_staff_skills`, `email_templates`, `email_body_template*`, `task_assignees`, `offer_equipment_substitutions` | zapis wg uprawnienia modułu zamiast `true` | niskie |
| P2-3 | Uprawnienia z dwukropkiem (`equipment:manage`, `contacts:view`, `contacts:manage`) w politykach `cable_units`, `equipment_kit_cables`, `event_equipment_units`, `subcontractor_*` | zamienić na `equipment_manage`, `contacts_view/manage`/`subcontractors_manage` (dziś nikt ich nie ma — część tabel martwa dla API) | niskie |
| P2-4 | `event_agenda*`, `event_loading_checklist`, `event_logistics_timeline`, `event_routes`, `event_phase_assignments` | zastąpić globalne `events_view`/„każdy pracownik” warunkiem EV(v) | niskie |
| P2-5 | `employee_email_accounts`, `system_email_config`, `email_accounts` | hasła SMTP/IMAP do Vault (odczyt tylko Edge Functions); usunąć `email_accounts` (ℹ️ D10) | średnie |
| P2-6 | `page_analytics`, `active_sessions`, `scroll_depth`, `click_events`, `form_interactions` | anon: tylko INSERT (aktualizacja czasu przez `update_page_analytics_duration`); odczyt `page_view` | niskie |
| P2-7 | `contract_templates` | usunąć „Wszyscy mogą czytać aktywne szablony” (public) — ℹ️ D12 | niskie |
| P2-8 | `my_companies` | widok publiczny (nazwa, logo, marka) dla EMP; konta bankowe tylko F≥invoices; marketing bez kont | średnie |
| P2-9 | Funkcje ⚠️ z sekcji 4.3 | kontrola (EV(m), `equipment_manage`, `fleet_manage`, `employees_view`) lub REVOKE dla authenticated, gdy wołają je tylko serwer/cron | średnie — częściowo w `20261101190000_security_p0` (tylko serwer lub „pracownik CRM”, 4.1a); zostaje reguła modułu dla funkcji ⚠️ |
| P2-10 | CRM: centralna blokada tras | w layoucie CRM sprawdzać trasę wg `ACCESS_SECTIONS`/rejestru menu i przekierować bez uprawnień (zamiast polegać na komponentach) | niskie |
| P2-11 | Pakiety | scalić `mag` z `warehouse`; uporządkować stare pakiety (`employee`, `dj`, `technician`, `contractor`, `manager`); włączyć `role_permissions_inherited` tam, gdzie to możliwe | niskie (ℹ️) |
| P2-12 | `_backup_equipment_items`, `_backup_equipment_units`, `subcontractor_rental_equipment` | usunąć lub naprawić (ℹ️ D9, D10) | niskie |
| ✅ P2-13 | Funkcje triggerów z EXECUTE dla anon (159) | REVOKE (kosmetyka, porządek w audycie) — **✅ `20261101190000_security_p0`** (funkcje triggerów `SECURITY DEFINER`) | brak |

### 6.4 Decyzje właściciela

| # | Pytanie | Rekomendacja | Decyzja (data) |
|---|---|---|---|
| D1 | Czy dział finansów (globalne `finances_view/manage`) ma widzieć płace i stawki pracowników (`employee_compensation`, `compensation_settings`)? | Nie — płace: ADM ∨ `personnel_manage`; finanse widzą je zbiorczo w księgowości (poziom finance_view) | **TAK — tylko kadry** (01.11.2026): odczyt ADM ∨ personnel_view ∨ personnel_manage, zapis ADM ∨ personnel_manage, pracownik widzi własny wiersz. **✅ zrealizowane w `20261101190000_security_p0`** (UI: `EmployeeCompensationCard`) |
| D2 | Kolumny finansowe wydarzenia: wydzielić do osobnej tabeli/widoku (duża zmiana) czy zaakceptować, że przypisany technik może je odczytać przez API? | Wydzielić `event_financials` (RLS EVC) — zgodne z zasadą 3 | **TAK**, osobny późniejszy etap (01.11.2026) — nie realizowane w P0 |
| D3 | Jakie pola pracownika widzi każdy pracownik (katalog)? | imię, nazwisko, nick, avatar, służbowy telefon i e-mail, stanowisko, zespół | **imię, nazwisko, pseudonim, zdjęcie, służbowy telefon i e-mail, stanowisko, zespół**; adres, PESEL, prywatny telefon, uprawnienia — tylko sam pracownik, kadry i administrator (01.11.2026); osobny etap. Anon: tylko pola strony (P0-6) |
| D4 | Kto widzi koszty i marże katalogu ofert oraz stawki podwykonawców? | `offers_view`+ (sprzedaż, zarząd, finanse) | oczekuje |
| D5 | `time_tracking_view` w pakiecie Event Managera — kierownik widzi czas zespołu? | tak, ale bez stawek; pozostałe pakiety → `time_tracking_view_own` | oczekuje |
| D6 | Konto z profilem „Wykonawca zewnętrzny” z 22 indywidualnymi uprawnieniami (klienci, oferty, wydarzenia, flota, czas pracy) oraz konto Managera z `invoices_manage` — świadome? | zmienić profil na właściwy (np. Event Manager) albo odebrać; Managerowi nadać poziom F per firma | **Manager zostaje bez dostępu do finansów Mavinci (świadomie); konto contractor — finanse już zdjęte** (01.11.2026) |
| D7 | Czy `finances_view` (bez manage) ma widzieć koszty wydarzeń (`event_costs`)? | tak (model docelowy) — dodać EVC(v) do SELECT | oczekuje |
| D8 | Zakładka finansów wydarzenia: `offers_*` (UI) czy `contracts_*` (baza)? | jedna funkcja `can_view_event_commercials()` używana przez CRM i mobile | oczekuje |
| D9 | `subcontractor_rental_equipment` — tabela niedostępna z API (polityki na nieistniejących uprawnieniach) | naprawić polityki albo usunąć tabelę | oczekuje |
| D10 | `email_accounts` (stare hasła), `_backup_equipment_*` | usunąć | oczekuje |
| D11 | `employees_public_list()` — publiczna lista wszystkich aktywnych pracowników (anon) | tylko pracownicy z `show_on_website` | oczekuje |
| D12 | Publiczny odczyt aktywnych szablonów umów (`contract_templates`) | zamknąć, jeśli nie korzysta z niego strona/portal | oczekuje |

## 7. Jak dodawać nowe dane

Lista kontrolna dla każdej nowej tabeli, kolumny, funkcji, bucketu, uprawnienia lub ekranu:

1. **RLS włączone** (`ALTER TABLE … ENABLE ROW LEVEL SECURITY`) i polityki dla każdej operacji osobno; brak polityki = tylko service_role (to dobra wartość domyślna dla tabel technicznych).
2. **Nigdy `USING (true)` / `WITH CHECK (true)` dla danych średniej i wysokiej wrażliwości.** `TO public`/`TO anon` tylko dla treści strony (odczyt opublikowanych wierszy) i formularzy (sam INSERT).
3. **Używaj funkcji pomocniczych zamiast kopiować warunki:** `current_employee_is_crm_admin()`, `current_employee_id()`, `current_employee_can_view_event()/…_manage_event()`, `can_view_event_commercials()`, poziom finansów firmy (`20261101165000`: `finance_company_level*`, `finance_company_manageable`), `sales_can_manage_*()`, `can_view_inquiry()/can_manage_inquiry()`, `personnel_can_access()`, `can_write_equipment_catalog()`, `current_employee_can_access_company()`. Nowe uprawnienie dopisz do `src/lib/permissionCatalog.ts` (z polską etykietą) i do pakietów w `access_levels`, jeśli dotyczy.
4. **Polityki RESTRICTIVE dla zakresów**: `NOT current_session_is_seller_portal()` na każdej tabeli, której portal nie używa; `crm_parent_scope_*` (`*_own_only`) dla tabel podrzędnych wydarzeń/ofert/umów; zakres firm dla danych per działalność.
5. **Kolumny wrażliwe** (stawki, koszty, PESEL, konta, hasła, tokeny) — osobna tabela lub widok z RLS albo uprawnienia kolumn (`REVOKE SELECT (kolumna) ON … FROM authenticated`); sekrety tylko w Vault.
6. **Widoki** zawsze `WITH (security_invoker = true)`; nie nadawaj anon SELECT na widoki z danymi wewnętrznymi. Jedyny wyjątek: `website_team_members` (pola publiczne strony „Zespół”, prawa właściciela, stała lista kolumn i warunek).
7. **Funkcje `SECURITY DEFINER`**: kontrola w pierwszej linii, `SET search_path`, bez EXECUTE dla PUBLIC/anon (domyślnie od `20261101190000_security_p0`; funkcja dla strony — jawny GRANT i lista w 4.5), `REVOKE … FROM authenticated` + `GRANT … TO service_role`, jeśli wołają ją tylko triggery/cron/Edge Functions (i nie woła jej funkcja `SECURITY INVOKER`). Tożsamość z `auth.uid()`, nie z parametru. Pomocnicza funkcja w `private` używana w polityce — `GRANT EXECUTE … TO authenticated`.
8. **Storage**: bucket prywatny, chyba że to treść strony; polityki per ścieżka (`foldername(name)`), pliki dokumentów przez podpisane URL.
9. **Parytet mobile**: ta sama reguła w bazie i obsługa w `mobile/` w tym samym PR (`AGENTS.md`, `docs/mobile-parity.md`); ekran, który nie obsługuje ustawienia, ukrywa dane. Logika wspólna — identyczne kopie w `scripts/ci/check-shared-copies.mjs`.
10. **UI to nie ochrona**: `PermissionGuard`/`canViewModule` tylko ukrywają; wpis w rejestrze menu (`registry.server.ts`) i `ACCESS_SECTIONS` dla nowej sekcji.
11. **Test**: sprawdź zapytaniem jako `anon`, jako konto portalu sprzedawcy, jako technik/DJ i jako sprzedawca (np. `SET LOCAL role authenticated; SET LOCAL request.jwt.claims …`), że widzą tylko to, co w tabeli profili (sekcja 2).
12. **Zaktualizuj ten plik** (`docs/access-model.md`): wiersz w domenie (wrażliwość, reguła docelowa, stan, status), funkcja w sekcji 4, bucket w 3.15, zmiana pakietu w sekcji 2.



### macOS — natywny klient 0.2

`desktop/mac/` używa publicznego klucza Supabase z sesją pracownika (bez service_role). Karta wydarzenia potwierdza EV(v/m) istniejącymi RPC; ustawienia zakładek, przypisanie, EVC i uprawnienia kosztów są odczytywane przed pobraniem danego obszaru. Budżet, przychód i dane handlowe są pobierane tylko przy `get_event_finance_access.canViewCommercials`; koszty przy `canViewCosts`, zapis oczekujących kosztów przy `canManageCosts` i z kontrolą RLS. Profil obejmuje `finance_company_access`, więc jego zmiana unieważnia szyfrowaną kopię konta. Aplikacja nie przelicza samodzielnie poziomów finansowych.

Kalendarz pokazuje dostępne przez RLS wydarzenia oraz własne / zaproszone spotkania. Wyraźnie włączane, ręczne powiązanie z EventKit kopiuje nazwy, terminy i miejsca do wskazanego kalendarza Apple (może należeć do iCloud); nie importuje prywatnych danych do CRM i nie nadaje uprawnień CRM. Kopia Apple pozostaje po wylogowaniu. Podstawowe dane wydarzenia i zakładek trafiają do szyfrowanej kopii oddzielonej per konto / serwer, offline tylko do odczytu, z limitem 24 godzin. Niewykonana migracja `20261101170000_native_calendar_sync.sql` rozszerza wyłącznie odczytowy, invokerowy transport `native_workspace_sync`, bez zmiany polityk.
