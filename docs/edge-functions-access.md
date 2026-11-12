# Dostęp do Supabase Edge Functions — Mavinci CRM

> **Stan na 2026-11-01.** Źródła: 40 funkcji wdrożonych w projekcie `fuuljhhuhfojtmmfmskq` (`list_edge_functions`, treść wybranych przez `get_edge_function`), kod w `supabase/functions/`, `supabase/config.toml`, zadania `cron.job`, funkcje SQL wywołujące `net.http_post` oraz nazwy (bez wartości) sekretów w Vault. Uzupełnia [`docs/access-model.md`](access-model.md), który opisuje tabele, RPC i buckety — tutaj są wyłącznie Edge Functions.

## Spis treści
1. [Dlaczego `verify_jwt` nie wystarcza](#1-dlaczego-verify_jwt-nie-wystarcza) · 2. [Podsumowanie](#2-podsumowanie) · 3. [Tabela funkcji](#3-tabela-funkcji) · 4. [Wywołania z bazy](#4-wywołania-z-bazy-pg_cron-triggery) · 5. [Rozbieżności repo ↔ produkcja](#5-rozbieżności-repo--produkcja) · 6. [Sekret `INTERNAL_FUNCTION_SECRET`](#6-sekret-wywołań-wewnętrznych-internal_function_secret) · 7. [Zmiany w bazie](#7-zmiany-wymagane-w-bazie) · 8. [Jak pisać nową funkcję](#8-jak-pisać-nową-funkcję) · 9. [Lista do wdrożenia](#9-lista-do-wdrożenia)

## 1. Dlaczego `verify_jwt` nie wystarcza

- `verify_jwt = true` sprawdza tylko, czy nagłówek `Authorization` zawiera poprawnie podpisany JWT projektu. **Publiczny klucz anon** (jest w kodzie strony WWW, CRM i aplikacji mobilnej) jest takim JWT — bramka go przepuszcza.
- `verify_jwt = false` przepuszcza wszystko, także żądanie bez żadnego klucza.
- Funkcja, która tworzy klienta z `SUPABASE_SERVICE_ROLE_KEY`, **omija RLS**. Jeśli sama nie sprawdzi, kto ją woła, robi to, o co poprosi ktokolwiek znający adres i klucz anon.
- Dlatego każda funkcja musi mieć własną kontrolę wywołującego (sekcja 8). Reguła dostępu ma być ta sama co w bazie: RPC wywołane z tożsamością użytkownika albo odczyt klientem użytkownika (RLS) — nie kopia warunków w TypeScript.

Legenda ryzyka: ❌ dostęp dla anon/każdego z zapisem lub ujawnieniem danych (albo wysyłką w imieniu firmy) · ⚠️ za szeroko / do domknięcia · ✅ zgodne z modelem · ℹ️ uwaga porządkowa.

## 2. Podsumowanie

| | ❌ | ⚠️ | ✅ |
|---|---|---|---|
| Produkcja dziś (wdrożony kod) | 6 | 8 | 26 |
| Repo po tej zmianie (po wdrożeniu) | 0 | 5 (z czego 3 → ✅ po ustawieniu `INTERNAL_FUNCTION_SECRET`) | 35 |

**Najpoważniejsze (produkcja, do czasu wdrożenia):**

1. `create-employee` i `create-auth-for-employee` — każdy z kluczem anon mógł założyć konto pracownika, także administratora, albo konto logowania dla istniejącego pracownika z własnym hasłem. Poprawione w repo w `342c514a`, **wdrożone wersje są starsze** (v20 z 23.08, v17 z 10.06).
2. `send-email` z polem `smtpConfig` — wysyłka bez żadnej kontroli: otwarty przekaźnik poczty przez nasz SMTP relay (dowolny serwer SMTP, dowolny nadawca i treść, adres IP relaya).
3. `send-push-notification` — push o dowolnym tytule, treści i linku do telefonów dowolnych pracowników (phishing).
4. `generate-contract-pdf`, `generate-agenda-pdf` — pełny rekord umowy / agenda z kontaktem klienta dla każdego, kto zna identyfikator.

## 3. Tabela funkcji

Kolumna `verify_jwt` — wartość wdrożona (✔ true, ✘ false). „Wdrożyć” — czy funkcja wymaga wdrożenia, żeby poprawka zadziałała. „TS” — reguła uprawnień zapisana w TypeScript zamiast RPC z bazy (do ujednolicenia przy okazji, bez luki).

| Funkcja | verify_jwt | Wywołujący | Co robi kluczem service_role | Kontrola: przed → po | Ryzyko: przed → po | Wdrożyć |
|---|---|---|---|---|---|---|
| `analyze-bank-reconciliation` | ✔ | CRM `BankAiAnalysisPanel` | OpenAI (koszt); transakcje czytane klientem użytkownika | sesja + `finance_can_manage()`, transakcje przez RLS | ✅ | — |
| `analyze-financial-report` | ✔ | CRM `CanonicalFinancialDashboard` | bez service_role; `get_financial_report` jako użytkownik, OpenAI | sesja + `finance_can_view()` | ✅ | — |
| `annotate-saldeo-document` | ✔ | CRM `saldeoDocumentAnnotation` | bez service_role (klient użytkownika) | `finance_can_manage()` + `finance_company_visible()` | ✅ | — |
| `assist-inquiry` | ✔ | CRM: zapytania, oferty, produkty, wysyłka oferty/broszury | OpenAI; katalog produktów; zapytania przez RLS; zapis `save_inquiry_ai_turn` jako użytkownik | sesja + aktywny pracownik; zapytania: RLS + `sales_can_manage_document()`; akcje ofertowe: `offers_manage`/admin (TS) | ✅ ℹ️ TS | — |
| `audit-contract` | ✔ | CRM: umowa wydarzenia | OpenAI (zanonimizowane bloki) | sesja + `contracts_manage`/admin (TS) + RLS `events`/`contracts` | ✅ ℹ️ TS | — |
| `create-auth-for-employee` | ✔ | brak w obecnym kodzie | `auth.admin.createUser` dla dowolnego pracownika, hasło z żądania | **produkcja: brak** → `current_employee_is_crm_admin()` (repo, `342c514a`) | ❌ → ✅ | **tak, pilne** |
| `create-employee` | ✔ | CRM `AddEmployeeModal` | konto logowania + rekord `employees` z dowolnym poziomem (także admin) | **produkcja: brak** → `current_employee_is_crm_admin()` (repo, `342c514a`) | ❌ → ✅ | **tak, pilne** |
| `delete-event-safe` | ✔ | CRM `deleteEventSafely` | trwałe usunięcie wydarzenia (po sprawdzeniu rozliczeń) | sesja + admin (TS) | ✅ ℹ️ TS | — |
| `extract-external-invoice` | ✔ | CRM `InvoiceScanAssistant` | OpenAI (odczyt dokumentu) | `finance_can_manage()` + `can_manage_invoice_company()` | ✅ | — |
| `fetch-emails` | ✘ | CRM: Wiadomości (token sesji) | `sent_emails`, `received_emails` skrzynki | sesja + skrzynka widoczna w RLS `employee_email_accounts` | ✅ | — |
| `fetch-tenders` | ✘ (w `config.toml` teraz ✔) | pg_cron `scan-new-tenders` → `invoke_scheduled_tender_scan()` (klucz anon z Vault); CRM `ImportControls` (dotąd klucz anon, teraz token sesji) | HTTP do BZP/TED/Bazy Konkurencyjności, zapis `tenders`, `tender_import_logs`, powiadomienia | **brak — działała nawet bez klucza** → service_role / `X-Internal-Function-Secret` / sesja z `current_employee_can_view_tenders()`; klucz anon tylko dopóki `INTERNAL_FUNCTION_SECRET` nie jest ustawiony | ⚠️ → ⚠️ (✅ po sekrecie) | tak + CRM |
| `generate-agenda-pdf` | ✔ | brak w obecnym kodzie | agenda z punktami, notatkami i kontaktem klienta | **brak** → sesja + agenda widoczna w RLS `event_agendas` (`current_employee_can_view_event`, zakres rekordów) | ❌ → ✅ | tak |
| `generate-contract-pdf` | ✔ | brak w obecnym kodzie | zwracała cały rekord umowy | **brak** → odczyt klientem użytkownika: RLS `contracts` (`crm_contract_permission('view')`, marki, zakres rekordów, blokada portalu) | ❌ → ✅ | tak |
| `generate-offer-pdf` | ✔ | starsze karty CRM (zgodność) | bez service_role — przekazuje żądanie z nagłówkiem użytkownika do `/bridge/offers/generate-pdf` | wymaga nagłówka; kontrola w bridge | ✅ | — |
| `generate-subcontractor-guidelines` | ✔ | CRM `EventSubcontractorsPanel` | OpenAI (klient użytkownika) | sesja + `events_manage`/`subcontractors_manage`/admin (TS) + RLS `events` | ✅ ℹ️ TS | — |
| `ksef-api` | ✔ | brak w obecnym kodzie (KSeF idzie przez `/bridge/ksef/*`) | operacje KSeF z tokenami firmy | `get_invoice_finance_access()` + `can_manage_invoice_company()` | ✅ | — |
| `process-marketing-campaigns` | ✘ | pg_cron `process-marketing-campaigns` (anon + `X-Marketing-Worker-Secret`); CRM `CampaignsPageClient` (sesja) | wysyłka partii kampanii przez relay SMTP | `MARKETING_WORKER_SECRET` albo `marketing_campaigns_manage`/admin (TS, = `can_manage_marketing_campaigns()`) | ✅ | — |
| `process-scheduled-emails` | ✘ | pg_cron `process-scheduled-emails` (`X-Scheduled-Email-Worker-Secret`) | wysyłka zaplanowanych wiadomości (przez `send-email`/`send-offer-email` z service_role) | `verify_scheduled_email_worker_secret()` (Vault); przy wysyłce ponowna kontrola nadawcy i dokumentu | ✅ | — |
| `process-subcontractor-reminders` | ✔ (`config.toml`: ✘) | pg_cron `process-subcontractor-reminders` — **nie wysyła: brak `subcontractor_reminder_secret` w Vault** | przypomnienia e-mail do podwykonawców | `SUBCONTRACTOR_REMINDER_SECRET` | ✅ | — |
| `qualify-incoming-email` | ✔ | pg_cron `qualify-incoming-sales-emails` co minutę (klucz anon z Vault) | OpenAI; zapytania, rozmowy sprzedażowe, organizacje, powiadomienia | wystarczał dowolny nagłówek `Authorization` (klucz anon) → service_role / `X-Internal-Function-Secret`; klucz anon tylko dopóki sekret nie jest ustawiony | ⚠️ → ⚠️ (✅ po sekrecie) | tak* |
| `receive-webhook` | ✘ | integracje (Event Rulers), test w CRM `settings/webhooks` | zapytania z webhooków; odczyt/zapis kart weselnych (dane osobowe) | klucz API źródła (SHA-256 w `webhook_sources`), dozwolone typy zdarzeń | ✅ ℹ️ klucz źródła widzi wszystkie wesela | — |
| `respond-subcontractor-assignment` | ✔ (`config.toml`: ✘) | publiczna strona `/subcontractor-confirmation` (link w e-mailu) | odczyt i zapis odpowiedzi na zlecenie | token z linku (SHA-256 w bazie, 30 dni, tylko status `sent`) | ✅ | — |
| `schedule-email` | ✔ | CRM `emailScheduling` | `scheduled_emails`, załączniki w Storage | sesja + skrzynka (własna / `can_send`); oferta: `sales_actor_can_manage()` | ✅ | — |
| `send-chat-push` | ✔ | CRM `ChatConversationView` i mobile `ChatScreen` (klucz anon); trigger `notify_chat_message_push` (nieaktywny — brak `service_role_key`/`supabase_url` w Vault) | push do uczestników rozmowy | brak kontroli wywołującego; treść, nadawca i odbiorcy z bazy, tylko wiadomości < 5 min | ⚠️ → ⚠️ (bez zmian, sekcja 7) | — |
| `send-crm-notification-push` | ✘ | trigger `dispatch_notification_recipient_push` (pg_net, bez nagłówka); `receive-webhook`, `send-task-assignment-push` (service_role) | push z treścią powiadomienia z bazy, jednorazowo (`notification_push_deliveries`) | brak (wystarczy id odbiorcy) → service_role / `X-Internal-Function-Secret` po ustawieniu sekretu | ⚠️ → ⚠️ (✅ po sekrecie i zmianie triggera) | tak |
| `send-email` | ✔ | CRM (wiadomości, kontakty, umowy, zapytania, Saldeo), `/bridge` (broszury, Saldeo, dostęp do portalu), `send-event-*`, `send-subcontractor-assignment`, `process-*` | wysyłka przez relay SMTP hasłami skrzynek, `sent_emails`, archiwum załączników | skrzynka: `messages_*`/admin + właściciel lub `can_send`; Saldeo/serwer: service_role; **`smtpConfig`: brak** → `smtpConfig` tylko z kluczem service_role | ❌ → ✅ | tak* |
| `send-event-confirmation` | ✔ | CRM `EventDetailsAction`, `ReserveEquipmentModal` (sesja) | wydarzenie, klient, oferta z kwotami; e-mail do klienta (przez `send-email`), `event_audit_log` | brak (wysyłkę bez sesji blokował dopiero `send-email`) → `current_employee_can_manage_event()` | ⚠️ → ✅ | tak |
| `send-event-invitation` | ✔ | CRM `AddMembersList`, `eventsApi` (sesja) | przypisanie i dane pracownika, e-mail (przez `send-email`), flagi przypisania | brak (anon zmieniał flagi wysyłki i poznawał preferencje) → `current_employee_can_view_event()` + nie portal | ⚠️ → ✅ | tak |
| `send-invoice-email` | ✔ | CRM `SendInvoiceEmailModal` | faktura PDF e-mailem | `can_manage_invoice()` + skrzynka | ✅ | — |
| `send-marketing-campaign-test` | ✔ | CRM `CampaignsPageClient` | test kampanii na wskazany adres | `marketing_campaigns_manage`/admin (TS) + skrzynka | ✅ ℹ️ TS | — |
| `send-offer-email` | ✔ | CRM `SendOfferEmailModal`, `process-scheduled-emails` | oferta PDF e-mailem | `sales_actor_can_manage()` + `offer_send_guardrail()` + skrzynka | ✅ | — |
| `send-push-notification` | ✔ | brak w obecnym kodzie | push o dowolnym tytule, treści i danych do dowolnych pracowników | **brak** → tylko serwer: service_role / `X-Internal-Function-Secret` | ❌ → ✅ | tak |
| `send-subcontractor-assignment` | ✔ | CRM `EventSubcontractorsPanel` | e-mail z wytycznymi i linkiem do podwykonawcy | `events_manage`/`subcontractors_manage`/admin (TS), bez sprawdzenia konkretnego wydarzenia | ⚠️ (drobne) → bez zmian | — |
| `send-task-assignment-push` | ✔ | CRM i mobile (sesja) | push o przypisaniu zadania | przypisujący / autor zadania / `tasks_manage` / admin | ✅ | — |
| `sync-email-read-state` | ✔ | CRM (sesja) | flagi IMAP przeczytane/nieprzeczytane | tylko własne i przypisane skrzynki | ✅ | — |
| `sync-ksef-daily` | ✔ | pg_cron `daily-ksef-sync-0900-warsaw` (klucz service_role z Vault) | synchronizacja faktur KSeF | tylko service_role | ✅ | — |
| `track-marketing-event` | ✘ | piksel i linki w e-mailach kampanii | zapis otwarć/kliknięć, przekierowanie | zapis tylko z tokenem odbiorcy; przekierowanie na dowolny URL także bez tokenu (otwarte przekierowanie) → przekierowanie tylko z ważnym tokenem | ⚠️ → ✅ | tak |
| `translate-offer` | ✔ | CRM `useOfferLanguage` | OpenAI, `offer_english_content` | `sales_can_manage_offer()` | ✅ | — |
| `translate-product` | ✔ | CRM `ProductLanguagePanel` | OpenAI, zapis przez RLS (service_role tylko przy tłumaczeniu z oferty) | `offers_manage`/admin (TS) lub `sales_can_manage_offer()` + produkt w ofercie | ✅ ℹ️ TS | — |
| `unsubscribe-marketing` | ✘ | link w e-mailach kampanii | wypisanie, lista wykluczeń | token odbiorcy (UUID) | ✅ | — |

\* Wdrożenie przeniesie też wcześniejsze, dotąd niewdrożone zmiany z repo (sekcja 5).

## 4. Wywołania z bazy (pg_cron, triggery)

| Funkcja SQL | Kiedy | Edge Function | Nagłówki dziś | Stan |
|---|---|---|---|---|
| `invoke_scheduled_tender_scan()` | cron `17 */6 * * *` | `fetch-tenders` | `Authorization`/`apikey`: klucz anon z Vault (`supabase_anon_key`) | działa; po ustawieniu `INTERNAL_FUNCTION_SECRET` wymaga dodania `X-Internal-Function-Secret` |
| `invoke_ai_email_qualification()` | cron co minutę | `qualify-incoming-email` | jw. | działa; jw. |
| `dispatch_notification_recipient_push()` | trigger `AFTER INSERT` na `notification_recipients` | `send-crm-notification-push` | tylko `Content-Type` | działa; jw. |
| `invoke_marketing_campaign_worker()` | cron co minutę | `process-marketing-campaigns` | anon + `X-Marketing-Worker-Secret` (Vault `marketing_worker_secret`) | **pomijane** — w Vault brak `marketing_worker_secret` (funkcja zwraca NULL z ostrzeżeniem); kampanie przetwarza tylko przycisk w CRM |
| `invoke_subcontractor_reminder_worker()` | cron `15 * * * *` | `process-subcontractor-reminders` | anon + `X-Subcontractor-Reminder-Secret` (Vault `subcontractor_reminder_secret`) | **pomijane** — brak sekretu w Vault; przypomnienia nie są wysyłane |
| `invoke_scheduled_email_worker()` | cron co minutę | `process-scheduled-emails` | `X-Scheduled-Email-Worker-Secret` (Vault) | działa (bez zmian) |
| `invoke_daily_ksef_sync()` | cron `0 7,8 * * *` (09:00 Warszawa) | `sync-ksef-daily` | klucz service_role z Vault (`ksef_daily_service_role_key`) | bez zmian |
| `notify_chat_message_push()` | trigger na `employee_messages` | `send-chat-push` | service_role z Vault `service_role_key` | **nieaktywny** — w Vault brak `service_role_key` i `supabase_url` (trigger kończy się bez wywołania); push wysyłają klienci |
| `invoke_marketing_sync()` | cron `15 */6 * * *` | `/bridge/marketing/sync` (Next.js, nie Edge) | `x-marketing-cron-secret` | **pomijane** — brak `crm_base_url`/`marketing_cron_secret` |

Sekrety w Vault (nazwy): `ksef_daily_project_url`, `ksef_daily_service_role_key`, `scheduled_email_worker_secret`, `supabase_anon_key`.

## 5. Rozbieżności repo ↔ produkcja

- **W repo, niewdrożone:** puste katalogi bez kodu `apply-contract-clause-slots-migration`, `apply-offer-image-position-migration`, `apply-offer-variant-layout-constraint`, `apply-offer-variant-package-migration`, `apply-offer-variant-pdf-migration` — do usunięcia (nie są funkcjami).
- **Wdrożone bez kodu w repo:** brak (40 = 40).
- **Wdrożona wersja starsza niż repo — sprawdzone treścią:** `create-employee`, `create-auth-for-employee` (bez kontroli administratora), `send-email` (repo ma dodatkowo kopię w folderze „Wysłane” przez IMAP, `delivery_archive`, ostrzeżenia `sentCopy`).
- **Prawdopodobnie starsza (wg historii git, nie porównywano treści):** `qualify-incoming-email` (snapshot `4db32540`: liczba uczestników, brak automatycznego zakładania kontaktów), `fetch-tenders` (`57a69d9f`: powiadomienia przez `enqueue_crm_business_notification` — funkcja istnieje w bazie), `send-event-invitation` (`4db32540`: usunięta linijka stopki).
- **Sprawdzone, identyczne z repo (przed tą zmianą):** `send-crm-notification-push`, `send-push-notification`, `generate-contract-pdf`, `generate-agenda-pdf`, `track-marketing-event`.
- Pozostałych nie porównywano treścią. Historia git jest tu niewiarygodna: funkcje bywały wdrażane z niezacommitowanego stanu (snapshot `4db32540` z 31.10).
- **`verify_jwt`:** `respond-subcontractor-assignment` i `process-subcontractor-reminders` — w `config.toml` `false`, wdrożone `true` (obie działają w obu trybach). `fetch-emails` i `fetch-tenders` — wdrożone `false`, brak wpisu w `config.toml` (wdrożenie przez CLI ustawi `true`; dla obu bezpieczne). Dodano wpis `fetch-tenders = true`.
- **Nieużywane przez obecny kod:** `create-auth-for-employee`, `generate-agenda-pdf`, `generate-contract-pdf`, `ksef-api`, `send-push-notification` (oraz `generate-offer-pdf` jako zgodność starszych kart) — kandydaci do usunięcia (`supabase functions delete <nazwa>`) po decyzji właściciela.

## 6. Sekret wywołań wewnętrznych (`INTERNAL_FUNCTION_SECRET`)

Funkcje wołane z bazy kluczem anon (`fetch-tenders`, `qualify-incoming-email`) lub bez nagłówka (`send-crm-notification-push`) mają **tryb zgodności**: dopóki zmienna `INTERNAL_FUNCTION_SECRET` nie jest ustawiona w Edge Functions, przyjmują dotychczasowe wywołania. Ustawienie sekretu włącza wymóg: klucz service_role albo nagłówek `X-Internal-Function-Secret` równy sekretowi (`fetch-tenders` dodatkowo: sesja pracownika z dostępem do przetargów). `send-push-notification` wymaga tego od razu (nikt jej nie woła).

Kolejność (ważna — inaczej zadania cron przestaną działać):

1. Wygeneruj losową wartość (np. `openssl rand -hex 32`). Nie zapisuj jej w repo ani w migracji.
2. Zapisz ją w Vault: `select vault.create_secret('<wartość>', 'internal_function_secret', 'X-Internal-Function-Secret dla Edge Functions');`
3. Migracja (sekcja 7, pkt 1): `invoke_scheduled_tender_scan()`, `invoke_ai_email_qualification()` i trigger `dispatch_notification_recipient_push()` wysyłają nagłówek `X-Internal-Function-Secret` (sekret czytany z `vault.decrypted_secrets`).
4. Wdróż funkcje z sekcji 9 i CRM (nowy `ImportControls` wysyła token sesji).
5. Na końcu: `supabase secrets set INTERNAL_FUNCTION_SECRET=<ta sama wartość> --project-ref wjxnyvcxhhxjytfwpwvu`.
6. Sprawdź: `select status_code, count(*) from net._http_response where created > now() - interval '15 minutes' group by 1;` (oczekiwane 200), ręczny import przetargów w CRM, push z powiadomienia CRM na telefonie.

Wycofanie: `supabase secrets unset INTERNAL_FUNCTION_SECRET --project-ref wjxnyvcxhhxjytfwpwvu` przywraca tryb zgodności bez ponownego wdrażania.

## 7. Zmiany wymagane w bazie

Nie są częścią tej zmiany (migracje prowadzi osobny wątek):

1. **Nagłówek sekretu w wywołaniach z bazy** (warunek pkt 5 sekcji 6). W `invoke_scheduled_tender_scan()` i `invoke_ai_email_qualification()` zostawić `Authorization`/`apikey` (bramka `verify_jwt = true` wymaga JWT) i dodać `'X-Internal-Function-Secret', <sekret z Vault internal_function_secret>`; w `dispatch_notification_recipient_push()` dodać ten sam nagłówek (zachować `EXCEPTION WHEN OTHERS`, żeby awaria pusha nie cofała powiadomienia). Brak sekretu w Vault → pominąć nagłówek (`jsonb_strip_nulls`), a nie wysyłać `null`.
2. **`notifications` / `notification_recipients` (P0-5 w `access-model.md`)** — dziś anon może utworzyć powiadomienie i dopisać odbiorcę; trigger natychmiast wysyła push z tą treścią na telefon pracownika. Kontrola w `send-crm-notification-push` tego nie zatrzyma (treść jest „z bazy”) — konieczne zamknięcie INSERT dla anon/authenticated.
3. **REVOKE EXECUTE** dla `anon`, `authenticated` na `invoke_ai_email_qualification()`, `invoke_scheduled_tender_scan()` (każdy może dziś wyzwolić wywołanie Edge z kluczem z Vault) oraz `claim_email_ai_qualification()` (pobiera i blokuje kolejkę kwalifikacji) — już na liście P0-2/4.4 w `access-model.md`.
4. **Brakujące sekrety (funkcjonalnie, nie bezpieczeństwo):** `marketing_worker_secret` w Vault + `MARKETING_WORKER_SECRET` w Edge (ta sama wartość) — inaczej zaplanowane kampanie nie wychodzą same; `subcontractor_reminder_secret` w Vault + `SUBCONTRACTOR_REMINDER_SECRET` w Edge — inaczej przypomnienia do podwykonawców nie wychodzą; `crm_base_url` + `marketing_cron_secret` — synchronizacja marketingu.
5. **Czat:** trigger `notify_chat_message_push()` jest martwy (brak sekretów). Zamiast dodawać `service_role_key` do Vault — usunąć trigger albo przepiąć na `X-Internal-Function-Secret` razem z kontrolą w `send-chat-push` (pkt 6).
6. **`send-chat-push`** (bez zmian w tym wydaniu, bo zainstalowane aplikacje mobilne wysyłają klucz anon): w kolejnej wersji CRM i mobile wysyłać token sesji, w funkcji sprawdzać `sender_id = current_employee_id()` (RPC jako użytkownik) i jednorazowość wysyłki (tabela dostaw jak `notification_push_deliveries`); ścieżkę anon zamknąć, gdy stare wersje aplikacji wygasną.
7. **Zapisy z klienta, których Edge nie chroni:** `employee_assignments` (INSERT/DELETE dla każdego zalogowanego, P1-2), `subcontractor_tasks` (P1-3) — kontrola w `send-event-invitation`/`send-subcontractor-assignment` nie pomoże, dopóki RLS pozwala zapisywać bezpośrednio.

## 8. Jak pisać nową funkcję

1. **Ustal, kto woła:** (a) zalogowany użytkownik CRM/mobile, (b) serwer — pg_cron, trigger, inna funkcja, `/bridge`, (c) publiczny link lub webhook. Wpisz to w komentarzu na górze pliku i w tabeli z sekcji 3.
2. **(a) Użytkownik:** zweryfikuj token `auth.getUser(token)` klientem z kluczem **anon** i nagłówkiem użytkownika. Tym samym klientem sprawdź regułę przez RPC z bazy (`current_employee_is_crm_admin`, `current_employee_can_view_event` / `current_employee_can_manage_event`, `can_view_event_commercials`, `sales_can_manage_offer` / `sales_can_manage_document`, `can_manage_invoice`, `finance_can_view` / `finance_can_manage` + `finance_company_visible` / `can_manage_invoice_company`, `current_employee_can_view_tenders`, `can_manage_marketing_campaigns`, `current_employee_can_control_mailboxes`…) albo odczytaj rekord klientem użytkownika (RLS). **Nie kopiuj** warunków `role`/`permissions` do TypeScript. Klienta service_role twórz dopiero po kontroli.
3. **Konto portalu sprzedawcy** jest zwykłym `authenticated`. Helpery `current_employee_*` i `current_crm_employee_id()` je wykluczają; jeśli opierasz się na RLS lub innym RPC, dodaj `current_session_is_seller_portal()`.
4. **(b) Serwer:** wymagaj klucza service_role (dokładne porównanie z `SUPABASE_SERVICE_ROLE_KEY`) albo nagłówka `X-Internal-Function-Secret` = `INTERNAL_FUNCTION_SECRET`. W SQL bierz sekret z Vault, nigdy nie wpisuj kluczy do migracji. Nie ufaj roli odczytanej z niepodpisanego JWT przy `verify_jwt = false`.
5. **(c) Publiczne:** `verify_jwt = false` tylko z własnym tokenem/sekretem (w bazie hash, termin ważności, jednorazowość), zwracaj wyłącznie dane objęte tokenem, żadnych otwartych przekierowań, odpowiedzi bez szczegółów błędów bazy.
6. **Tożsamość** zawsze z tokenu, nigdy z body (`p_actor`, `user_id`, `sender_id`, `employee_id`).
7. **Kody odpowiedzi:** 401 — brak lub nieważna sesja, 403 — brak uprawnień; nie zwracaj surowych komunikatów bazy z danymi.
8. **Koszty:** funkcje z OpenAI/HTTP/wysyłką maili muszą mieć kontrolę jak w pkt 2 lub 4 — nawet jeśli „tylko liczą”.
9. **Wdrożenie:** wpis w `supabase/config.toml` (`verify_jwt`), wiersz w tej tabeli, `supabase functions deploy <nazwa>` z repo (nie edytuj w panelu — repo ma być równe produkcji). Jeśli funkcja korzysta z `../_shared`, wdrażaj przez CLI.

Szablon (a):

```ts
type CallerCheck = { ok: true; userId: string } | { ok: false; status: number; error: string };

async function requireEventManager(req: Request, supabaseUrl: string, eventId: string): Promise<CallerCheck> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!token || !anonKey) return { ok: false, status: 401, error: 'Brak aktywnej sesji. Zaloguj się ponownie.' };
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return { ok: false, status: 401, error: 'Sesja wygasła. Zaloguj się ponownie.' };
  const { data: allowed, error } = await userClient.rpc('current_employee_can_manage_event', { p_event_id: eventId });
  if (error || allowed !== true) return { ok: false, status: 403, error: 'Brak uprawnień.' };
  return { ok: true, userId: userData.user.id };
}
```

Wzorce w repo: `create-employee` (administrator), `send-event-confirmation` (zarządzanie wydarzeniem), `send-event-invitation` (widoczność wydarzenia + portal), `generate-contract-pdf` (odczyt przez RLS), `send-push-notification` (tylko serwer), `fetch-tenders` (serwer + użytkownik + tryb zgodności).

## 9. Lista do wdrożenia

```bash
supabase functions deploy create-employee create-auth-for-employee send-email send-push-notification \
  generate-contract-pdf generate-agenda-pdf send-event-invitation send-event-confirmation \
  track-marketing-event fetch-tenders qualify-incoming-email send-crm-notification-push \
  --project-ref wjxnyvcxhhxjytfwpwvu
```

- Pilne (otwarte dziury): `create-employee`, `create-auth-for-employee`, `send-email`, `send-push-notification`, `generate-contract-pdf`, `generate-agenda-pdf`.
- Bez zmiany zachowania do czasu `INTERNAL_FUNCTION_SECRET`: `fetch-tenders` (poza tym, że teraz wymaga choćby klucza anon), `qualify-incoming-email`, `send-crm-notification-push`.
- CRM (Next.js): `src/app/(crm)/crm/tenders/components/ImportControls.tsx` — wdrożyć przed ustawieniem `INTERNAL_FUNCTION_SECRET`.
- Uwagi przed wdrożeniem: `send-email` przeniesie niewdrożone archiwum IMAP („Wysłane”) — jeśli relay SMTP nie zwraca `sentCopy`, po każdej wysyłce pojawi się ostrzeżenie o braku kopii (sprawdzić wersję `smtp-relay-worker`). `qualify-incoming-email` przeniesie zmianę z `4db32540` (liczba uczestników, brak automatycznych kontaktów). `fetch-tenders` — wdrożenie przez CLI zmieni `verify_jwt` na `true` (obecne wywołania przechodzą).
- Później: sekret wg sekcji 6 i zmiany w bazie z sekcji 7.
