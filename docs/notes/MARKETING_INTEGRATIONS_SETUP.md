# Integracje marketingowe wielu marek

Moduł przypisuje integrację Meta i Google do rekordu z `my_companies`. Tokeny
OAuth są szyfrowane po stronie serwera. Przeglądarka otrzymuje wyłącznie status,
nazwy kont i wyniki synchronizacji.

## Zmienne serwerowe

```text
MARKETING_TOKEN_ENCRYPTION_KEY=<długi losowy sekret, ten sam na każdej instancji>
MARKETING_CRON_SECRET=<osobny losowy sekret do automatycznej synchronizacji>

META_APP_ID=<id aplikacji Meta>
META_APP_SECRET=<sekret aplikacji Meta>
META_WEBHOOK_VERIFY_TOKEN=<własny token weryfikacyjny webhooka>
META_GRAPH_API_VERSION=v23.0

GOOGLE_MARKETING_CLIENT_ID=<OAuth Client ID aplikacji webowej>
GOOGLE_MARKETING_CLIENT_SECRET=<OAuth Client Secret>
GOOGLE_ADS_DEVELOPER_TOKEN=<token deweloperski Google Ads>
GOOGLE_ADS_API_VERSION=v25

OPENAI_API_KEY=<klucz używany tylko po zgodzie administratora marki>
OPENAI_MARKETING_MODEL=gpt-5.4
```

## Adresy przekierowania OAuth

W konsolach dostawców należy dodać dokładne adresy dla domeny produkcyjnej:

```text
https://TWOJA-DOMENA/bridge/marketing/oauth/meta/callback
https://TWOJA-DOMENA/bridge/marketing/oauth/google/callback
```

Webhook Meta:

```text
https://TWOJA-DOMENA/bridge/marketing/meta-webhook
```

Webhook korzysta z `META_WEBHOOK_VERIFY_TOKEN` i weryfikuje podpis
`x-hub-signature-256`. Dla strony należy zasubskrybować zdarzenie `messages`.
Uprawnienia Meta do wiadomości i danych reklamowych wymagają zatwierdzenia
aplikacji przez Meta oraz przyznania użytkownikowi dostępu do właściwej strony
i konta reklamowego.

W Google Cloud oba adresy OAuth muszą należeć do aplikacji typu Web. Konto
Google użyte podczas łączenia musi mieć dostęp do usługi Search Console oraz
do odpowiedniego konta Google Ads. Dostęp do Google Ads wymaga aktywnego tokenu
deweloperskiego.

## Automatyczna synchronizacja

Migracja tworzy zadanie `pg_cron` uruchamiane co 6 godzin. Adres CRM i sekret
można umieścić w Supabase Vault pod nazwami:

```text
crm_base_url
marketing_cron_secret
```

Wartość `marketing_cron_secret` musi być identyczna z serwerową zmienną
`MARKETING_CRON_SECRET`. Jeśli Vault nie jest dostępny, funkcja czyta ustawienia
PostgreSQL `app.settings.crm_base_url` i `app.settings.marketing_cron_secret`.

## Zakres danych AI

Analiza AI jest wyłączona domyślnie osobno dla każdej marki. Po świadomym
włączeniu przez administratora do OpenAI trafiają wyłącznie zagregowane wyniki
kampanii i SEO. Treści wiadomości oraz dane klientów nie są wysyłane. Żądanie
używa `store: false`.
