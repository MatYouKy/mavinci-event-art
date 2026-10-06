# Załączniki odebranych wiadomości

Pełny widok wiadomości oraz podgląd na liście wywołują `/bridge/messages/attachments`.
Endpoint sprawdza sesję i dostęp do wiadomości przez RLS. Dopiero potem pobiera
konfigurację skrzynki i wywołuje chroniony endpoint `/api/imap/attachments` workera.
Hasła IMAP i sekret workera nie trafiają do przeglądarki.

Worker otwiera zapisany folder IMAP tylko do odczytu, sprawdza UIDVALIDITY oraz
Message-ID i pobiera części MIME przez istniejącą bibliotekę ImapFlow. Załączniki,
w tym pliki inline i załączone wiadomości EML, są zapisywane w istniejącym bucketcie
`email-attachments` i tabeli `email_attachments`. Nie jest potrzebna nowa migracja
ani wdrożenie funkcji Supabase.

Po zapisaniu wszystkich plików serwer oznacza zakończenie w
`received_emails.raw_headers.__mavinci_attachment_sync_v1`, zachowując dotychczasowe
nagłówki przez warunkową aktualizację. Marker obejmuje również wiadomości bez plików.
Nie zapisuje się po błędzie. Stabilne identyfikatory plików pozwalają ponawiać
przerwany import. Wcześniejsze pliki są porównywane również po zawartości.

Przy błędzie CRM nadal wyświetla zapisane pliki i przycisk ponowienia. Limit jednego
importu wynosi 32 MB łącznie i 100 załączników; worker obsługuje do trzech importów
jednocześnie. Import wymaga obecności wiadomości w zapisanym folderze na IMAP.
Nie przeszukuje automatycznie innych folderów po przeniesieniu wiadomości.

## Wdrożenie

Główne `yarn send` / `deploy.sh` buduje aplikację, wdraża worker i jego zależności
przez Yarn na VPS, sprawdza obsługę `imap-attachments-v1`, a następnie wdraża aplikację.
Skrypt jest niezależny od katalogu, z którego wywołano worker deployment.
Nie wysyła lokalnych sekretów ani lokalnego `node_modules`.

`next dev` zapisuje do `.next`, a build produkcyjny do `.next-build`, aby
równoległy podgląd lokalny nie nadpisywał manifestów produkcyjnych. Wysyłka
korzysta z `.next-build/standalone` i `.next-build/static`. Katalog startowy
aplikacji na VPS pozostaje `/var/www/mavinci/frontend/.next/standalone`;
wewnątrz niego wygenerowany serwer korzysta z `.next-build`.

Na serwerze używana jest dotychczasowa konfiguracja:

- `/var/www/mavinci/smtp-relay-worker/.env` z `RELAY_SECRET` i opcjonalnie `PORT`;
- `SUPABASE_SERVICE_ROLE_KEY` aplikacji: z `/var/www/mavinci/frontend/.env`, środowiska procesu wdrożenia lub konfiguracji PM2 procesu `frontend-mavinci` (w tej kolejności). Pozostała konfiguracja Supabase aplikacji pozostaje w dotychczasowym miejscu.

Skrypt `configure-attachments-env.cjs` tworzy na VPS prywatny plik
`/var/www/mavinci/frontend/.env.imap-attachments` (0600). Ustawia w nim
`IMAP_ATTACHMENT_RELAY_URL` na lokalny adres workera oraz
`IMAP_ATTACHMENT_RELAY_SECRET` na jego istniejący sekret. Główne wdrożenie wczytuje
ten plik przed restartem aplikacji. Plik zawiera również istniejący klucz `SUPABASE_SERVICE_ROLE_KEY`, aby został zachowany przy restarcie. Odczyt PM2 dotyczy wyłącznie wskazanej aplikacji. Sekrety nie są wypisywane. Opcja `--check` po katalogu aplikacji i nazwie procesu PM2 sprawdza konfigurację bez zapisu i restartu.

W lokalnym środowisku można ustawić te same zmienne w konfiguracji Next.js
lub użyć istniejących `SMTP_RELAY_URL` i `SMTP_RELAY_SECRET`.
Samodzielne wdrożenie workera: `bash smtp-relay-worker/deploy-smtp-relay.sh`.

## Uruchomienie lokalne

`yarn dev` uruchamia również lokalny worker IMAP i przekazuje jego adres oraz
sekret wyłącznie do procesu Next.js. Worker nasłuchuje na `127.0.0.1` i kończy
działanie razem z tym uruchomieniem Next.js. Wykorzystuje istniejący
`smtp-relay-worker/.env`; jeśli brak sekretu, używa losowego sekretu na czas
sesji. Nie pobiera konfiguracji z VPS. Jawna para zmiennych
`IMAP_ATTACHMENT_RELAY_URL` i `IMAP_ATTACHMENT_RELAY_SECRET` (lub `SMTP_RELAY_*`)
umożliwia użycie wcześniej skonfigurowanego workera. Zależności workera muszą być
zainstalowane w jego katalogu. Po aktualizacji sposobu uruchamiania należy raz
ponownie uruchomić `yarn dev`.
