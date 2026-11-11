#!/bin/bash
# Uruchomienie zbudowanej aplikacji desktopowej: `yarn open mac` (albo `yarn open:mac`).
# Działająca wcześniej wersja jest najpierw zamykana, żeby otworzyła się nowo zbudowana.
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-}" in
  mac)
    APP="desktop/mac/build/Mavinci.app"
    [ -d "$APP" ] || { echo "Brak $APP — najpierw: yarn build:mac"; exit 1; }
    if pgrep -x Mavinci >/dev/null 2>&1; then
      osascript -e 'tell application id "pl.mavinci.desktop" to quit' >/dev/null 2>&1 || osascript -e 'quit app "Mavinci"' >/dev/null 2>&1 || true
      for _ in $(seq 1 20); do pgrep -x Mavinci >/dev/null 2>&1 || break; sleep 0.25; done
    fi
    open "$APP"
    echo "Uruchomiono: $APP"
    ;;
  *)
    echo "Użycie: yarn open mac"
    exit 1
    ;;
esac
