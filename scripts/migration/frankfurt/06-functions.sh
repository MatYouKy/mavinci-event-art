#!/usr/bin/env bash
# Funkcje Edge w NOWYM projekcie: sekrety z pliku $WORK_DIR/functions.env (wartości wpisujesz Ty — Supabase ich nie
# pokazuje) i wdrożenie tych samych 40 funkcji co w starym projekcie, z tym samym wymaganiem logowania (verify_jwt).
source "$(dirname "$0")/lib.sh"
need_cmd supabase "brew install supabase/tap/supabase"
ask NEW_REF "Identyfikator NOWEGO projektu"
cd "$REPO"

ENV_FILE="$W/functions.env"
if [ ! -s "$ENV_FILE" ]; then
  cp "$HERE/functions.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Utworzyłem $ENV_FILE — wpisz wartości sekretów (jak w starym projekcie) i uruchom skrypt ponownie."
  echo "Nazwy w starym projekcie: supabase secrets list --project-ref $OLD_REF"
  exit 1
fi
log "Sekrety funkcji"
supabase secrets set --env-file "$ENV_FILE" --project-ref "$NEW_REF"

# Bez weryfikacji JWT (funkcje sprawdzają klucz / token / sekret same) — jak w produkcji 09.11.2026 i supabase/config.toml.
# respond-subcontractor-assignment i process-subcontractor-reminders: config.toml ma verify_jwt = false (token z linku,
# sekret crona), starsze wdrożenie w produkcji miało true — wdrażamy zgodnie z repo.
NO_VERIFY="fetch-emails receive-webhook send-crm-notification-push process-marketing-campaigns unsubscribe-marketing
track-marketing-event process-scheduled-emails respond-subcontractor-assignment process-subcontractor-reminders"
VERIFY="send-email create-employee create-auth-for-employee send-invoice-email send-offer-email generate-contract-pdf
generate-offer-pdf generate-agenda-pdf send-event-invitation ksef-api send-event-confirmation fetch-tenders
send-push-notification send-chat-push send-task-assignment-push sync-email-read-state qualify-incoming-email
send-marketing-campaign-test analyze-financial-report assist-inquiry send-subcontractor-assignment delete-event-safe audit-contract schedule-email
analyze-bank-reconciliation extract-external-invoice annotate-saldeo-document generate-subcontractor-guidelines
sync-ksef-daily translate-product translate-offer"

FAILED=""
for fn in $NO_VERIFY; do
  log "$fn (bez JWT)"
  supabase functions deploy "$fn" --project-ref "$NEW_REF" --no-verify-jwt || FAILED="$FAILED $fn"
done
for fn in $VERIFY; do
  log "$fn"
  supabase functions deploy "$fn" --project-ref "$NEW_REF" || FAILED="$FAILED $fn"
done
if [ -z "$FAILED" ]; then echo "Wdrożono wszystkie funkcje."; else echo "Nie wdrożono:$FAILED"; exit 1; fi
