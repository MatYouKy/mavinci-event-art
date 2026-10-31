# Mavinci — strona WWW, CRM i portal sprzedawców

Next.js 14 (App Router) + Supabase (Postgres, RLS, Edge Functions, pg_cron). Ten sam projekt obsługuje:

- stronę publiczną i SEO (`src/app/(public)`, `src/app/(sitemaps)`),
- CRM (`src/app/(crm)/crm`): zapytania, przetargi, oferty, kalkulacje, wydarzenia, umowy, sprzęt, flota, faktury i KSeF,
- portal sprzedawców zewnętrznych (`/seller`),
- endpointy serwera (`src/app/bridge/**` — odpowiedniki `/api`),
- aplikację mobilną (`mobile/`), synchronizację macOS (`macos-sync-app/`) i przekaźnik SMTP (`smtp-relay-worker/`).

## Uruchomienie lokalne

```bash
yarn install
cp .env.example .env   # uzupełnij klucze Supabase i integracji (plik .env nie trafia do repozytorium)
yarn dev
```

Menedżer pakietów: **yarn** (jedyny lockfile: `yarn.lock`).

## Zasady pracy

- `AGENTS.md` — polskie etykiety wartości systemowych, typografia marki, obramowania w UI.
- Uprawnienia: decyzję podejmuje baza (RLS i funkcje `SECURITY DEFINER`). Interfejs pyta o nią przez RPC
  (np. `current_employee_can_manage_event`, `get_event_finance_access`, `get_invoice_finance_access`)
  zamiast powtarzać reguły w komponentach.
- Każdy endpoint `/bridge`, który używa klucza serwisowego, najpierw wywołuje
  `requireSessionEmployee` (`src/lib/auth/requireEmployee.server.ts`).
- Tożsamość pracownika w SQL: `public.current_crm_employee_id()` (dopasowuje `id` lub `auth_user_id`).

## Migracje bazy

- Pliki: `supabase/migrations/YYYYMMDDHHMMSS_nazwa.sql`, wersja musi być unikalna (sprawdza CI).
- Stan bazy docelowej: `scripts/migration-status.sql` (uruchom w SQL Editor) i
  `node scripts/check-migration-status.mjs applied.txt`.
- Migracje stosujemy w kolejności nazw; Edge Functions wdrażamy po migracjach, aplikację na końcu.

## Wdrożenie

`yarn deploy` — build standalone i wysyłka na VPS (`deploy.sh`). Przed wdrożeniem: migracje i Edge Functions.

## Dokumentacja

- `docs/` — opisy procesów (zapytania, umowy personelu, kalkulacje, etykiety).
- `docs/notes/` — notatki z wcześniejszych zmian i poprawek.
- `docs/pending-migrations/` — skrypty SQL spoza katalogu migracji; przed użyciem sprawdź, czy nie zostały już zastosowane.
