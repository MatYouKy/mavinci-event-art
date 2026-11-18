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
      # Zamykanie może chwilę potrwać (zapis kopii danych na dysku) — czekamy do 15 s, potem kończymy proces.
      for _ in $(seq 1 60); do pgrep -x Mavinci >/dev/null 2>&1 || break; sleep 0.25; done
      if pgrep -x Mavinci >/dev/null 2>&1; then
        echo "Poprzednia wersja nie zamknęła się w 15 s — kończę jej proces."
        pkill -x Mavinci >/dev/null 2>&1 || true
        for _ in $(seq 1 20); do pgrep -x Mavinci >/dev/null 2>&1 || break; sleep 0.25; done
        pgrep -x Mavinci >/dev/null 2>&1 && { pkill -9 -x Mavinci >/dev/null 2>&1 || true; sleep 0.5; }
      fi
      # Po zakończeniu procesu system potrzebuje chwili, zanim otworzy nową wersję (inaczej błąd -600).
      sleep 1
    fi
    # Błąd -600: poprzednia wersja jeszcze się zamykała — jedna ponowna próba po chwili.
    if ! open "$APP"; then
      echo "Ponawiam uruchomienie…"
      sleep 2
      open "$APP"
    fi
    echo "Uruchomiono: $APP"
    ;;
  *)
    echo "Użycie: yarn open mac"
    exit 1
    ;;
esac
