#!/bin/bash
# Sekret serwera CRM (Next na VPS) — np. klucz OpenAI asystentów AI w Prezentacjach, Realizacjach, social media i raportach.
#
#   bash scripts/server-secret.sh OPENAI_API_KEY          # stan: czy klucz jest w /var/www/mavinci/frontend/.env i w działającej aplikacji
#   bash scripts/server-secret.sh OPENAI_API_KEY --set    # wpisanie lub zmiana wartości, potem przeładowanie aplikacji (jak w deploy.sh)
#
# Wartość wpisujesz sam w Terminalu (nie wyświetla się, nie trafia do historii poleceń ani do argumentów procesów): skrypt
# wysyła ją przez ssh na standardowym wejściu do pliku tymczasowego (tylko root), dopisuje do .env na serwerze (bez kopii na tym
# komputerze) i przeładowuje PM2 tak samo jak `yarn deploy`. Skrypt nigdy nie wypisuje wartości sekretów — tylko „jest / brak”.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

REMOTE="${MAVINCI_DEPLOY_REMOTE:-root@185.235.68.130}"
BASE="/var/www/mavinci/frontend"
REMOTE_NODE_DIR="/root/.nvm/versions/node/v20.11.0/bin"
REMOTE_APP="frontend-mavinci"

KEY="${1:-}"
MODE="${2:-}"
if [[ ! "$KEY" =~ ^[A-Z][A-Z0-9_]{1,63}$ ]]; then
  echo "Użycie: bash scripts/server-secret.sh NAZWA_ZMIENNEJ [--set]   (np. OPENAI_API_KEY)"
  exit 1
fi
if [ -n "$MODE" ] && [ "$MODE" != "--set" ]; then
  echo "Nieznana opcja: $MODE (dozwolona: --set)"
  exit 1
fi

echo "🔌 Sprawdzam połączenie SSH z serwerem CRM ($REMOTE)…"
if ! ssh -o ConnectTimeout=10 -o ConnectionAttempts=1 "$REMOTE" 'true'; then
  echo "❌ Brak połączenia SSH z serwerem — nic nie zostało zmienione."
  exit 1
fi

# Stan bez wartości: wpis w .env (niepusty) i zmienna w środowisku działającej aplikacji PM2 (tak / nie).
status() {
  ssh "$REMOTE" "KEY='$KEY' BASE='$BASE' APP='$REMOTE_APP' NODE_DIR='$REMOTE_NODE_DIR' bash -s" <<'REMOTE'
set -euo pipefail
export PATH="$NODE_DIR:$PATH"
if [ -f "$BASE/.env" ] && grep -Eq "^(export[[:space:]]+)?${KEY}=['\"]?[^'\"[:space:]]" "$BASE/.env"; then
  echo "  .env na serwerze:      jest"
else
  echo "  .env na serwerze:      brak"
fi
running="$(pm2 jlist 2>/dev/null | node -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; }).on("end", () => {
  // Lista procesów to jeden wiersz JSON; ostrzeżenia PM2 („[PM2] …”) w innych wierszach pomijamy.
  let list = null;
  for (const line of raw.split("\n").map((text) => text.trim()).filter((text) => text.startsWith("[")).reverse()) {
    try { list = JSON.parse(line); break; } catch { /* następny wiersz */ }
  }
  if (!Array.isArray(list)) { console.log("nieznany"); return; }
  const app = list.find((item) => item && item.name === process.argv[1]);
  if (!app) { console.log("aplikacja nie działa"); return; }
  const env = app.pm2_env || {};
  const value = (env.env && env.env[process.argv[2]]) || env[process.argv[2]];
  console.log(value ? "jest" : "brak");
});' "$APP" "$KEY" || echo "nieznany")"
echo "  działająca aplikacja:  $running"
REMOTE
}

echo "🔎 $KEY:"
status

if [ "$MODE" != "--set" ]; then
  echo ""
  echo "Aby wpisać lub zmienić wartość: bash scripts/server-secret.sh $KEY --set"
  exit 0
fi

echo ""
read -rs -p "Wklej wartość $KEY (nie będzie widoczna) i naciśnij Enter: " VALUE
echo ""
if [ -z "$VALUE" ]; then
  echo "❌ Pusta wartość — nic nie zostało zmienione."
  exit 1
fi
if [[ "$VALUE" =~ [[:space:]\'\"\\\$\`] ]]; then
  unset VALUE
  echo "❌ Wartość zawiera spację, cudzysłów, \$, \` albo \\ — tego skrypt nie zapisze. Nic nie zostało zmienione."
  exit 1
fi

echo "🔐 Zapisuję $KEY w $BASE/.env na serwerze…"
# 1. Wartość na standardowym wejściu do pliku tymczasowego (tylko root) — nie w argumentach poleceń.
printf '%s' "$VALUE" | ssh "$REMOTE" "umask 077; cat > '$BASE/.secret-$KEY.tmp'"
unset VALUE
# 2. Podmiana wpisu w .env (reszta pliku bez zmian, uprawnienia jak dotąd albo 600), usunięcie pliku tymczasowego.
ssh "$REMOTE" "KEY='$KEY' BASE='$BASE' bash -s" <<'REMOTE'
set -euo pipefail
tmp="$BASE/.secret-$KEY.tmp"
trap 'rm -f "$tmp"' EXIT
value="$(cat "$tmp")"
env_file="$BASE/.env"
umask 077
[ -f "$env_file" ] || touch "$env_file"
next="$(mktemp "$BASE/.env.XXXXXX")"
grep -Ev "^(export[[:space:]]+)?${KEY}=" "$env_file" > "$next" || true
printf "%s='%s'\n" "$KEY" "$value" >> "$next"
chmod --reference="$env_file" "$next" 2>/dev/null || chmod 600 "$next"
mv "$next" "$env_file"
echo "✅ Zapisano (wartość nie jest wyświetlana)."
REMOTE

echo "🚦 Przeładowanie aplikacji (PM2, jak w deploy.sh)…"
ssh "$REMOTE" "
  set -e
  export PATH='${REMOTE_NODE_DIR}':\$PATH
  export PLAYWRIGHT_BROWSERS_PATH='/root/.cache/ms-playwright'
  set -a
  . '${BASE}/.env'
  if [ -f '${BASE}/.env.imap-attachments' ]; then . '${BASE}/.env.imap-attachments'; fi
  set +a
  pm2 startOrReload '${BASE}/ecosystem.frontend.config.js' --update-env >/dev/null
  pm2 restart '${REMOTE_APP}' --update-env >/dev/null
  pm2 save >/dev/null
"

echo "🔎 $KEY po przeładowaniu:"
status
echo "✅ Gotowe. Asystent AI (Prezentacje, Realizacje, social media) działa bez nowego wdrożenia."
