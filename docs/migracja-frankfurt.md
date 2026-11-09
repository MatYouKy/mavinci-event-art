# Przenosiny Supabase do Frankfurtu

Cel: baza, logowanie, pliki i funkcje Edge bliżej serwera CRM (SEOHOST, Warszawa) i użytkowników. Dziś projekt `fuuljhhuhfojtmmfmskq` stoi w us-east-2 (Ohio): zapytanie z serwera CRM trwa w medianie ~126 ms, z tego samego regionu ~10 ms. Instancja Micro (1 GB) przy szczytach przechodzi w swap — wtedy przekroczenia limitu 8 s i brak wolnych połączeń (09.11.2026: 122 przekroczenia, 15 odrzuconych połączeń).

Decyzje (09.11.2026): nowy projekt **eu-central-1 (Frankfurt), Medium (4 GB)**; aplikacja mobilna przełączana **aktualizacją OTA** (wcześniej wydanie z obsługą OTA w sklepach); Claude może zapisywać w nowym projekcie (SQL, funkcje) do chwili przełączenia — w starym tylko odczyt.

Regionu istniejącego projektu nie da się zmienić, a „Restore to a new project” zostawia kopię w tym samym regionie — dlatego nowy projekt i przeniesienie logiczne (Supabase CLI), zgodnie z [Backup and restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

Skrypty: `scripts/migration/frankfurt/` (uruchamiasz u siebie w terminalu; hasła i klucze wpisujesz w skrypcie, nie trafiają do repo ani do czatu). Zrzuty i logi: `~/mavinci-migracja/` (poza repo — dane osobowe).

## Co przenosimy (stan 09.11.2026)

| Element | Ile | Jak |
|---|---|---|
| Baza | 1,3 GB, Postgres 17, 483 tabele w `public`, 889 migracji | `01-dump.sh` → `02-prepare.sh` → `03-restore.sh` |
| Konta | 19 (e-mail + hasło, bez MFA) | w zrzucie (hasła działają; sesje wygasają — każdy loguje się raz) |
| Pliki | 33 kontenery, ~3200 plików, ~4,1 GB (największy 49 MB) | `05-storage.sh` (kontenery z ustawieniami + pliki) |
| Reguły plików, Realtime | 102 reguły `storage.objects`, 1 `realtime.messages`, 64 tabele w publikacji | `platform.sql` w zrzucie |
| Wyzwalacz kont | `auth.users` → `handle_new_user_create_employee` | `platform.sql` |
| Crony | 21 | `08-cron-new.sh` dopiero w dniu przełączenia |
| Vault | 4 sekrety (`ksef_daily_project_url`, `ksef_daily_service_role_key`, `scheduled_email_worker_secret`, `supabase_anon_key`) | `04-vault.sh` (nowe wartości) |
| Stary adres w bazie | ~2500 wierszy w ~80 kolumnach (zdjęcia sprzętu, strona WWW, czat, e-maile, migawki ofert) + 6 funkcji (`invoke_*`, `dispatch_notification_recipient_push`) | zamiana adresu w `02-prepare.sh` |
| Funkcje Edge | 40 (wszystkie w repo) + sekrety | `06-functions.sh` + `~/mavinci-migracja/functions.env` |
| Kod | adres z `NEXT_PUBLIC_SUPABASE_URL` (`src/lib/supabase/projectUrl.ts`); funkcje Edge — z `SUPABASE_URL` | zrobione |
| Pliki bez zmiennych | `desktop/mac/Resources/Configuration.json`, `public/invitation-empoliye.html`, `src/components/crm/events/email/email-template.html` | `10-switch-static-refs.sh` |
| Poza repo | `.env` serwera CRM (`ecosystem.frontend.config.js`), `mobile/.env`, przekaźnik SMTP (`SUPABASE_URL`), integracje wysyłające do `receive-webhook` | ręcznie w dniu przełączenia |

## Narzędzia na Macu (raz)

```bash
brew install supabase/tap/supabase postgresql@17   # psql 17 (\getenv wymaga psql 15+)
brew link --force postgresql@17                     # jeśli psql nie jest w PATH
supabase login                                      # wdrażanie funkcji i sekretów
```
Docker Desktop musi być uruchomiony (`supabase db dump` używa pg_dump w kontenerze). Node.js jest w repo (kopiowanie plików).

Adresy baz bierzesz z panelu: projekt → **Connect** → **Direct** → Method: **Session pooler** (działa bez IPv6). Skrypt pyta osobno o adres (z `[YOUR-PASSWORD]`) i o hasło — wstawia je sam, z kodowaniem znaków specjalnych. Nie znasz hasła starego projektu → Settings → Database → Reset database password (CRM, aplikacje i funkcje używają kluczy API, nie hasła; jeśli coś łączy się hasłem — np. `supabase link` — trzeba je tam zmienić).

## Etap 0 — ulga od razu (opcjonalnie)

Stary projekt: Settings → Compute and Disk → **Small** (2 GB, ~$15/mies., kilka minut restartu). Zatrzymuje swap i brak połączeń do czasu przenosin.

## Etap 1 — przygotowanie kodu

- [x] Adres projektu z konfiguracji: nazwa ciasteczka sesji (`serverAuth.ts`), obrazy domyślne strony WWW, szablon broszury hotelowej, logo w e-mailach funkcji Edge.
- [x] **Aplikacja mobilna z OTA** (`expo-updates`, wersja 1.3.16, `docs/mobile-ota.md`) — kod gotowy.
- [ ] Build i wydanie 1.3.16 (`cd mobile && yarn deploy` — iOS, `yarn deploy:android` — APK) i test aktualizacji OTA. Przełączenie robimy dopiero, gdy telefony zespołu mają tę wersję.
- [ ] Aplikacja na Maca: w dniu przełączenia nowy adres i klucz w `Configuration.json` + nowa kompilacja.

## Etap 2 — próba generalna (projekt tymczasowy)

1. **Ty:** nowy projekt w organizacji Mavinci — nazwa „Mavinci CRM – próba”, region **Central EU (Frankfurt)**, rozmiar Medium (Security: Data API i „expose new tables” zaznaczone, „automatic RLS” odznaczone). Hasło bazy zapisz w menedżerze haseł. Od razu: Settings → Compute and Disk → **dysk 32 GB** (przy 8 GB wgrywanie zapełnia dysk dziennikiem WAL i baza staje) i Settings → Storage → limit pliku **2 GB**. Podaj Claude identyfikator projektu (20 znaków z adresu).
2. **Claude:** tylko `create extension` (pg_cron, pg_net, btree_gist) — bez dodatkowych `grant` na schemat `cron` (blokują skrypt instalacyjny Supabase przy wgrywaniu).
3. **Ty**, w katalogu repo:
   ```bash
   cd scripts/migration/frankfurt
   ./01-dump.sh       # ~15–30 min; pyta o adres starej bazy
   ./02-prepare.sh    # pyta o identyfikator projektu próbnego
   ./03-restore.sh    # pyta o adres nowej bazy; jedna transakcja
   ./04-vault.sh      # klucze projektu próbnego
   ./07-verify.sh     # porównanie liczby wierszy i elementów platformy
   ./05-storage.sh --dry-run   # ile plików i MB do skopiowania
   ./05-storage.sh             # ~4 GB; można przerwać i wznowić
   ./06-functions.sh           # za pierwszym razem tworzy functions.env do uzupełnienia
   ```
   Zapisz czasy kroków 01, 03, 05 — to długość okna przełączenia.
4. **Claude:** sprawdza nowy projekt (porównanie danych, reguły, funkcje w bazie z nowym adresem, logi).
5. **Ty:** CRM lokalnie (`.env.local` z adresem i kluczami projektu próbnego, `yarn dev`): logowanie, wydarzenie, oferta (PDF), plik w czacie, strona WWW (zdjęcia). Bez cronów — e-maile i przypomnienia nie wychodzą.
6. Błędy w odtworzeniu → poprawka w skryptach i ponowna próba na nowym projekcie tymczasowym. Na koniec projekt próbny **usuwasz** (Settings → General → Delete project).

### Wynik próby (09.11.2026, projekt `gsrxokzcgfagwvvbquaw`)

- Czasy: zrzut 10 min, przygotowanie ~1 min, odtworzenie ~20 min, Vault + porównanie ~5 min, pliki ~25 min (3033 pliki, 4 GB — w dniu przełączenia tylko zmiany), funkcje ~5 min.
- Zgodność: 490 tabel z tą samą liczbą wierszy, 1647 funkcji, 1589 reguł danych, 102 reguły plików, 64 tabele Realtime, 19 kont, 889 migracji, 31 kontenerów / 3033 pliki / 4031 MB.
- Czas odpowiedzi z Polski (mediana): API danych 40 ms (Ohio 127 ms), logowanie 31 ms (Ohio 129 ms).
- Poprawki z próby (już w skryptach): reguły NOT VALID dodawane po danych; dysk 32 GB i limit plików 2 GB przed wgraniem; limity kontenerów zdjęte na czas kopiowania; sekrety funkcji jak w starym projekcie (tylko `OPENAI_API_KEY` — nowy klucz, `SMTP_RELAY_URL` = `NEXT_SMTP_RELAY_URL` z `.env`, `SMTP_RELAY_SECRET` = `RELAY_SECRET` z `smtp-relay-worker/.env`, `FRONTEND_URL`); wewnętrznych sekretów nie ustawiamy (powiadomienia push z wyzwalacza działają tylko bez `INTERNAL_FUNCTION_SECRET`).
- Test lokalny: `./11-local-env.sh` (tworzy `.env.local`), `yarn dev`, po teście `./11-local-env.sh --remove`.

## Etap 3 — przed dniem przełączenia

- [ ] Projekt docelowy: „Mavinci - CRM (EU)”, Frankfurt, Medium, od razu dysk 32 GB i limit plików 2 GB (jak w próbie). Identyfikator → Claude (rozszerzenia, klucze API).
- [ ] Ustawienia logowania przepisane ze starego projektu (Authentication): Site URL i Redirect URLs, SMTP, szablony e-maili, ustawienia logowania e-mailem, limity, czas sesji (JWT 3600 s).
- [ ] Settings → Storage → Upload file size limit: **2 GB** (kontener `mavinci-view` ma limit 2 GB na plik; domyślne 50 MB blokuje jego założenie).
- [ ] `./06-functions.sh` na projekcie docelowym (sekrety + 40 funkcji).
- [ ] Pliki wstępnie: `./05-storage.sh` (dzień wcześniej; w dniu przełączenia dosyła tylko zmiany).
- [ ] Zespół wie o przerwie (19 osób; wieczór / weekend, ~1–2 h).
- [ ] Aplikacja mobilna z OTA zainstalowana u zespołu.

## Etap 4 — dzień przełączenia

| # | Kto | Krok |
|---|---|---|
| 1 | Ty | `./00-freeze-old.sh` — zatrzymuje crony starego projektu (zapamiętuje które) |
| 2 | Ty | Stary projekt: Settings → Data API → wyłącz (zapis i odczyt przez API stoją; nie ma tej opcji → tylko komunikat do zespołu) |
| 3 | Ty | `./01-dump.sh` → `./02-prepare.sh` (identyfikator docelowy) → `./03-restore.sh` → `./04-vault.sh` → `./07-verify.sh` |
| 4 | Claude | sprawdza projekt docelowy (dane, reguły, funkcje w bazie, Vault) |
| 5 | Ty | `./05-storage.sh --prune` — dosłanie plików zmienionych od wstępnej kopii |
| 6 | Ty | `./08-cron-new.sh` — crony w nowym projekcie |
| 7 | Ty | Serwer CRM: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` → `yarn deploy` (zmienne `NEXT_PUBLIC_` wchodzą w kompilację) |
| 8 | Ty | `./10-switch-static-refs.sh`, nowy klucz w `desktop/mac/Resources/Configuration.json`, kompilacja aplikacji na Maca |
| 9 | Ty | EAS → środowisko „production”: `EXPO_PUBLIC_SUPABASE_URL` i `EXPO_PUBLIC_SUPABASE_ANON_KEY` nowego projektu (oraz `mobile/.env` do pracy lokalnej) → `cd mobile && yarn deploy:ota --message "Nowy serwer (Frankfurt)"` (`docs/mobile-ota.md`) |
| 10 | Ty | Przekaźnik SMTP: `SUPABASE_URL` i klucz → restart; integracje wysyłające do `receive-webhook` → nowy adres |
| 11 | razem | Logowanie, wydarzenie, oferta, czat, powiadomienie push, e-mail z CRM, strona WWW; logi w nowym projekcie |

## Etap 5 — po przełączeniu

- Stary projekt zostaje włączony (bez cronów, z wyłączonym Data API) **kilka tygodni**: wysłane e-maile i PDF-y mają linki do jego publicznych plików, a stare maile marketingowe — do wypisu i śledzenia w jego funkcjach. Potem zmniejszenie do Micro i pauza.
- Pierwsze dni: Observability → Database (pamięć, połączenia), Query Performance. Po poprawkach najcięższych zapytań — ewentualnie zejście z Medium na Small.
- Linki w kodzie / dokumentacji do starego adresu: `10-switch-static-refs.sh` wypisuje pozostałe pliki.

## Plan B (cofnięcie w dniu przełączenia)

Dopóki serwer CRM i aplikacje wskazują stary projekt, nic nie jest stracone: stary projekt → Data API włącz, `./99-unfreeze-old.sh` (crony z powrotem). Zapisy zrobione już w nowym projekcie trzeba wtedy przenieść ręcznie — dlatego krok 11 robimy od razu po przełączeniu.

## Klucze API (sprawdzić przy tworzeniu projektu)

Supabase wycofuje klucze `anon` / `service_role` do końca 2026 ([Migrating to publishable and secret API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)). Dotyczy to też starego projektu, niezależnie od przenosin.

- Projekt ma zakładkę **Legacy API keys** z kluczami `anon` i `service_role` → przenosimy bez zmian w kodzie (najmniejsze ryzyko), zmianę kluczy robimy osobno.
- Projekt ma tylko klucze `sb_publishable_…` / `sb_secret_…` → przed przełączeniem trzeba dostosować: funkcje w bazie (`invoke_*` i powiadomienia push wysyłają klucz w `Authorization: Bearer` — nowy klucz idzie tylko w nagłówku `apikey`) oraz funkcje Edge z `verify_jwt = true` wołane przez crony (`qualify-incoming-email`, `fetch-tenders`, `sync-ksef-daily`, `send-chat-push`). Claude przygotuje migrację i zmiany funkcji.

## Uwagi

- Funkcje w bazie czytają też sekrety Vault, których nie ma w starym projekcie (`marketing_worker_secret`, `subcontractor_reminder_secret`, `crm_base_url`, `marketing_cron_secret`, `service_role_key`, `supabase_url`) — przenosiny tego nie zmieniają; do sprawdzenia osobno.
- `supabase/config.toml` ma `verify_jwt = false` dla `respond-subcontractor-assignment` i `process-subcontractor-reminders` (sprawdzają token / sekret same), starsze wdrożenie w produkcji ma `true` — w nowym projekcie wdrażamy zgodnie z repo.
- Zrzut danych pomija pliki Storage, Vault, crony i kolejki `pg_net` — przenoszą je osobne kroki. Jeśli `03-restore.sh` zatrzyma się na błędzie, nic nie zostaje zapisane (jedna transakcja); poprawka → ponownie od `02-prepare.sh`.
