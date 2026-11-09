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

# Usuwa z wpisanego tekstu sekwencje klawiszy (strzałki w ukrytym polu zapisują się jako ESC[D itp.) i znaki CR.
clean_input() { printf '%s' "$1" | LC_ALL=C sed $'s/\x1b\\[[0-9;]*[A-Za-z]//g' | LC_ALL=C tr -d '\r'; }

# Klucz API Supabase: JWT (eyJ…) albo sb_publishable_… / sb_secret_…
check_key() {
  local var="$1"
  if ! printf '%s' "${!var}" | grep -Eq '^(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_(publishable|secret)_[A-Za-z0-9_-]+)$'; then
    echo "$var nie wygląda na klucz Supabase (powinien zaczynać się od eyJ albo sb_). Skopiuj go ponownie przyciskiem kopiowania i uruchom skrypt jeszcze raz."
    exit 1
  fi
}

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
    val="$(clean_input "$val" | LC_ALL=C tr -d '[:space:]')"
    [ -n "$val" ] || { echo "Brak wartości: $var"; exit 1; }
    export "$var=$val"
  fi
}

# ask_db_url ZMIENNA STAREGO|NOWEGO — adres bazy z panelu (Connect → Direct → Session pooler) i osobno hasło.
# Hasło wstawia skrypt (zakodowane, więc znaki specjalne nie psują adresu); nigdzie go nie zapisuje.
ask_db_url() {
  local var="$1" which="$2" url="" pass=""
  [ -z "${!var:-}" ] || return 0
  echo "Adres bazy $which projektu: panel Supabase → projekt → Connect → Direct → Method: Session pooler."
  read -r -p "Wklej adres (zaczyna się od postgresql://, może zawierać [YOUR-PASSWORD]): " url
  url="$(clean_input "$url" | LC_ALL=C tr -d '[:space:]')"
  case "$url" in
    postgresql://*|postgres://*) ;;
    *) echo "To nie jest adres bazy — powinien zaczynać się od postgresql://. Uruchom skrypt ponownie."; exit 1;;
  esac
  case "$url" in
    *"[YOUR-PASSWORD]"*)
      read -r -s -p "Hasło do bazy $which projektu (nie będzie widoczne): " pass
      echo
      pass="$(clean_input "$pass")"
      [ -n "$pass" ] || { echo "Brak hasła."; exit 1; }
      pass="$(PASS="$pass" perl -e 'print join "", map { /[A-Za-z0-9._~-]/ ? $_ : sprintf("%%%02X", ord) } split //, $ENV{PASS}')"
      url="${url/\[YOUR-PASSWORD\]/$pass}"
      ;;
  esac
  export "$var=$url"
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
