# Tryb testowy „widok jako”

Administrator może wejść w CRM (albo w portal sprzedawcy) oczami wybranej osoby i sprawdzić, co widzi, jakie ma funkcje
i czy działają — czy nie ma za dużych albo za małych uprawnień. Ustawienia → zakładka **„Tryb testowy”** (tylko
administrator). Migracje: `20261202100000_crm_test_mode.sql` i `20261202110000_test_mode_postgrest_tx.sql` (PostgREST
`db_tx_end = commit-allow-override` — bez tego Data API pomija `Prefer: tx=rollback` i zatwierdza zapis; serwer wykrywa to zapisem
próbnym i nie otwiera trybu).

## Karta pracownika na liście

Najechanie albo kliknięcie zdjęcia / nazwiska (CRM: popover `TestModePersonPopover`; Mac: popover `TestModePersonCard`; telefon:
rozwinięcie wiersza) — większe zdjęcie, dział, poziom dostępu, rola, przełożony, e-mail i telefon służbowy, ostatnia aktywność
i uprawnienia pracownika w grupach jak w edytorze uprawnień (`src/lib/permissionCatalog.ts`; Mac i telefon —
`GET /bridge/native/v1/permission-labels`), „Otwórz kartę pracownika” (`/crm/employees/<id>` w nowej karcie przeglądarki; Mac —
nowa karta okna z ekranem Zespołu; telefon — CRM w przeglądarce) i „Wejdź jako”. Dane: `test_mode_targets` (migracja
`20261202120000_test_mode_target_details.sql` — e-mail, telefon, kadrowanie zdjęcia, lista uprawnień, przełożony, ostatnia
aktywność; tylko administrator).

## Kogo można oglądać

- aktywnych pracowników z kontem logowania (bez administratorów i bez siebie),
- sprzedawców zewnętrznych z włączonym portalem (wejście prowadzi do `/seller`).

## Jak to działa

1. „Wejdź jako” (`POST /bridge/test-mode/start`): serwer CRM sprawdza administratora (`test_mode_prepare`), sprawdza, że
   baza naprawdę wycofuje zapisy próbne (`test_mode_probe` z `Prefer: tx=rollback` + `test_mode_probe_take`), otwiera w tle
   sesję wybranej osoby (link logowania wygenerowany na serwerze — **bez e-maila do osoby**) i zapisuje ją w bazie
   zaszyfrowaną (AES-GCM) kluczem z sekretu, który ma tylko przeglądarka administratora (`private.test_mode_sessions`).
2. Przeglądarka dostaje **sesję zastępczą** (ciasteczko sesji Supabase z kluczem zastępczym — bez prawdziwego klucza osoby),
   ciasteczko httpOnly `mavinci_test_key` (sesja i sekret) i czytelne `mavinci_test_mode` (kogo oglądamy). Sesja
   administratora jest zapisana (zaszyfrowana) do przywrócenia.
3. Klient Supabase w przeglądarce (`src/lib/supabase/browser.ts` → `browserConfig.ts`) wysyła zapytania do
   `/bridge/test-mode/sb/*`; serwer podstawia klucz osoby (`src/lib/testMode/session.server.ts`):
   - **odczyt** — jak u tej osoby (RLS, funkcje bazy, menu, zakładki, przyciski),
   - **zapis do bazy** — wykonany jako ta osoba i **wycofany** (`Prefer: tx=rollback, handling=strict`): baza sprawdza
     uprawnienia, walidacje i wyzwalacze, ale nic nie zostaje i osoba niczego nie zobaczy. Po odświeżeniu strony zmiany nie
     ma. Gdy baza nie potwierdzi wycofania (`Preference-Applied`), tryb zostaje natychmiast przerwany,
   - **pliki** (przesyłanie, przenoszenie, usuwanie), **funkcje Edge** i **zmiany konta** (hasło, e-mail) — zablokowane
     z komunikatem; podgląd plików (podpisane adresy, lista) działa,
   - powiadomienia na żywo (Realtime) w trybie testowym nie działają.
4. Strony renderowane na serwerze i trasy serwera CRM używają tej samej tożsamości (`createSupabaseServerClient`,
   `src/lib/server.ts`, `requestSupabaseClient`, `bridgeUserClient`, `requireSessionEmployee`, `nativeContext`, trasy
   sprzedawcy `/bridge/seller/offers/[id]` i `/bridge/seller/catalog/[id]/configuration`).
5. `src/middleware.ts`: w trybie testowym serwer CRM nie wykonuje operacji zapisujących — trasy `/bridge/*` innymi metodami
   niż GET i akcje serwera Next zwracają 423 („Tryb testowy: ta operacja serwera jest wyłączona…”), bo mogłyby wysłać e-mail,
   wystawić dokument (KSeF) albo zapisać plik naprawdę.
   Odczyty, które CRM robi w tle, idą metodą GET, więc działają też w trybie testowym — np. odświeżenie listy eventów
   (`GET /bridge/events/page-snapshot`, dotąd akcja serwera). Synchronizacja przeczytanych wiadomości ze skrzynką
   (`sync-email-read-state`, funkcja serwera — zapis) w trybie testowym nie rusza.
6. **„Wyjdź z trybu”** — pasek zawsze na środku u góry (CRM i portal sprzedawcy, `TestModeBar`): `POST /bridge/test-mode/exit`
   unieważnia sesję osoby (`auth.sessions`, tylko ta jedna — jej prawdziwe logowania zostają), usuwa dane zaszyfrowane
   i przywraca sesję administratora. Wylogowanie w trybie testowym działa jak wyjście. Inne karty przeglądarki przeładowują
   się same po wejściu w tryb i po wyjściu.

Tryb kończy się sam po 8 godzinach (`test_mode_close_expired` przy kolejnym wejściu). Każde wejście zostaje w dzienniku
(Ustawienia → „Tryb testowy” → „Dziennik wejść”: kto, kogo, kiedy, jak zakończono). Administrator ma jedną sesję testową naraz
(nowe wejście — także na Macu — kończy poprzednią).

## Aplikacja na Maca

Ustawienia (⌘,) → „Tryb testowy” (tylko administrator, tylko pracownicy — widok portalu sprzedawcy sprawdza się w przeglądarce).
Opis aplikacji: `desktop/mac/README.md` („Tryb testowy „widok jako””).
1. `POST /bridge/test-mode/start` z `Authorization: Bearer <klucz administratora>` (bez ciasteczek): ta sama kontrola i to samo
   otwarcie sesji co w przeglądarce (`openTestSessionFor`); odpowiedź `{id, label, proxy, expires_at, session}` — sesja zastępcza.
2. Aplikacja łączy się z bazą przez `/bridge/test-mode/sb` kluczem zastępczym (nagłówek `Authorization`; odświeżenie sesji —
   pole `refresh_token` w `/auth/v1/token`): odczyt jak u osoby, zapis wycofany, pliki / funkcje Edge / zmiany konta zablokowane.
3. Natywne API (`/bridge/native/v1/*`) z kluczem zastępczym działa w imieniu osoby (`nativeContext` → `testModeFetch`).
   `src/middleware.ts` przepuszcza GET i — z metod zapisujących — tylko odczyty wysyłane metodą POST
   (`testModeNativeReadAllowed` w `src/lib/testMode/shared.ts`: `sync`, `sync/items`, `op=items` sekcji, treści poczty,
   adresy obrazów broszur); resztę zwraca jako 423. Drugi raz sprawdza to `readJson` (`src/lib/native/auth.ts`). Nowy odczyt
   wysyłany metodą POST trzeba dopisać do listy — inaczej w trybie testowym będzie „operacja wyłączona”.
4. `POST /bridge/test-mode/exit` z kluczem zastępczym — koniec sesji testowej; sesję administratora aplikacja trzyma u siebie.

## Telefon

Ustawienia → „Tryb testowy” (tylko administrator, tylko pracownicy): „Wybierz pracownika” — działy, wyszukiwarka, poziom dostępu
i liczba uprawnień, „Wejdź jako”, dziennik wejść; sprzedawcy zewnętrzni — „Otwórz w przeglądarce”
(`mobile/src/components/TestModeSection.tsx`).
1. Wejście (`mobile/src/lib/testModeApi.ts`): `/bridge/test-mode/start` kluczem administratora (jak Mac); sesja administratora
   i stan trybu zapisane na telefonie (`mobile/src/lib/testMode.ts`), sesja zastępcza ustawiona w kliencie Supabase.
2. Klient Supabase (`mobile/src/lib/supabase.ts`, `global.fetch` = `testModeFetch`) wysyła w trybie zapytania do bazy, plików,
   logowania i funkcji na `/bridge/test-mode/sb` (odświeżenie sesji zastępczej też). Natywne API — kluczem zastępczym wprost
   (ta sama lista odczytów POST co na Macu). Realtime nie przyjmuje klucza zastępczego — powiadomienia na żywo nie działają.
3. Telefon administratora bez zmian: bez rejestracji powiadomień push dla oglądanej osoby, bez sprzątania przypomnień
   o spotkaniach, bez synchronizacji kontaktów, bez zmiany motywu, „Mavinci” w Plikach i widżety zostają przy sesji
   administratora; komunikator nie wysyła powiadomień push.
4. Pasek „Tryb testowy · … · Wyjdź z trybu” zawsze na górze, na środku ekranu (`mobile/src/components/TestModeBanner.tsx`).
   Wyjście (pasek, Ustawienia, „Wyloguj”, a także odrzucone odświeżenie sesji zastępczej — sesja wygasła albo została zakończona):
   zapytania znów do Supabase, sesja administratora wraca (odświeżona, gdy wygasła), `/bridge/test-mode/exit` kończy sesję
   testową. Tryb przetrwa ponowne uruchomienie aplikacji (stan z telefonu).

## Uwagi

- Wejście ustawia osobie „ostatnie logowanie” (Supabase Auth) i może unieważnić niewykorzystany link logowania albo zmiany
  hasła wysłany jej wcześniej e-mailem (Supabase wydaje nowy jednorazowy link).
- Na Macu i w telefonie tryb obejmuje tylko pracowników (portal sprzedawcy — przeglądarka).
- Funkcje bazy (`test_mode_prepare`, `_open`, `_get`, `_store`, `_touch`, `_close`, `_close_expired`, `_probe`,
  `_probe_take`) — tylko klucz serwisowy; `test_mode_targets`, `test_mode_history` — tylko administrator.
