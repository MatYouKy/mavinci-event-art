#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "======================================"
echo "   Porównanie sekretów"
echo "======================================"
echo ""

if [ ! -f .env ]; then
  echo -e "${RED}❌ Brak pliku .env${NC}"
  exit 1
fi

source .env

if [ -z "$RELAY_SECRET" ]; then
  echo -e "${RED}❌ RELAY_SECRET nie jest ustawiony w .env${NC}"
  exit 1
fi

echo -e "${YELLOW}Twój RELAY_SECRET na VPS:${NC}"
echo ""
echo "  $RELAY_SECRET"
echo ""
echo -e "Długość: ${#RELAY_SECRET} znaków"
echo ""
echo "======================================"
echo ""
echo -e "${YELLOW}Co zrobić dalej:${NC}"
echo ""
echo "1. Skopiuj powyższy sekret (cały)"
echo ""
echo "2. Idź do Supabase Dashboard:"
echo "   https://supabase.com/dashboard"
echo ""
echo "3. Settings → Edge Functions → Environment Variables"
echo ""
echo "4. Znajdź: SMTP_RELAY_SECRET"
echo ""
echo "5. Edytuj i wklej DOKŁADNIE ten sam sekret:"
echo "   $RELAY_SECRET"
echo ""
echo "6. Zapisz i poczekaj 60 sekund"
echo ""
echo "======================================"
echo ""
