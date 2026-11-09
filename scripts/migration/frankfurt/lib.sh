#!/usr/bin/env bash
# Wspólne ustawienia skryptów przenosin do Frankfurtu (docs/migracja-frankfurt.md).
# Hasła i klucze skrypty pytają bez wyświetlania (albo czytają ze zmiennych środowiska) — nie trafiają do repo ani do czatu.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
# Zrzuty zawierają dane osobowe i skróty haseł — katalog roboczy poza repo, dostęp tylko dla Ciebie.
W="${WORK_DIR:-$HOME/mavinci-migracja}"
OLD_REF="${OLD_REF:-fuuljhhuhfojtmmfmskq}"
mkdir -p "$W"
chmod 700 "$W"

log() { printf '\n== %s\n' "$*"; }

# ask ZMIENNA "opis" [secret] — pyta, jeśli zmienna nie jest ustawiona.
ask() {
  local var="$1" prompt="$2" secret="${3:-}" val=""
  if [ -z "${!var:-}" ]; then
    if [ -n "$secret" ]; then
      read -r -s -p "$prompt: " val
      echo
    else
      read -r -p "$prompt: " val
    fi
    [ -n "$val" ] || { echo "Brak wartości: $var"; exit 1; }
    export "$var=$val"
  fi
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Brak programu „$1” — zainstaluj: $2"; exit 1; }
}

# Supabase CLI v3+ używa --remote=<adres>, starsze --db-url <adres>.
dump_target() {
  if supabase db dump --help 2>/dev/null | grep -q -- '--remote'; then
    printf -- '--remote=%s' "$1"
  else
    printf -- '--db-url=%s' "$1"
  fi
}

latest_dump() {
  [ -d "$W/latest" ] || { echo "Brak zrzutu w $W/latest — najpierw 01-dump.sh" >&2; exit 1; }
  echo "$W/latest"
}
