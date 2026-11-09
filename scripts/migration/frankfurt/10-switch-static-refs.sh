#!/usr/bin/env bash
# DZIEŃ PRZEŁĄCZENIA: nowy adres projektu w plikach bez zmiennych środowiska (aplikacja na Maca, statyczne HTML).
# Klucz publiczny w aplikacji na Maca wpisujesz sam — skrypt zmienia tylko adres.
source "$(dirname "$0")/lib.sh"
need_cmd perl "perl (jest w macOS)"
ask NEW_REF "Identyfikator NOWEGO projektu"
cd "$REPO"
for f in desktop/mac/Resources/Configuration.json public/invitation-empoliye.html src/components/crm/events/email/email-template.html; do
  if grep -q "$OLD_REF" "$f"; then
    perl -pi -e "s/${OLD_REF}/${NEW_REF}/g" "$f"
    echo "zmieniono: $f"
  fi
done
echo "Pozostałe pliki ze starym adresem (dokumentacja i historia migracji mogą zostać):"
grep -rIl "$OLD_REF" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.next-build --exclude-dir=.git \
  --exclude-dir=build --exclude-dir=migrations --exclude-dir=.temp . 2>/dev/null | grep -v '^./docs/' || true
