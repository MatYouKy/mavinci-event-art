#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

clear
echo ""
echo -e "${BLUE}╔═══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  SMTP Relay Worker - Deploy Script   ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════╝${NC}"
echo ""

# Sprawdź czy jesteś w odpowiednim katalogu
if [ ! -f "server.js" ]; then
  echo -e "${RED}❌ Nie znaleziono server.js${NC}"
  echo "   Uruchom ten skrypt z katalogu smtp-relay-worker/"
  exit 1
fi

echo -e "${YELLOW}➤${NC} Sprawdzam aktualny status..."
echo ""

# Status PM2
if command -v pm2 &> /dev/null; then
  pm2 status | grep smtp-relay
else
  echo -e "${RED}❌ PM2 nie jest zainstalowany${NC}"
  echo "   Zainstaluj: npm install -g pm2"
  exit 1
fi

echo ""
echo -e "${YELLOW}➤${NC} Zatrzymuję worker..."
pm2 stop smtp-relay-worker 2>/dev/null

echo ""
echo -e "${YELLOW}➤${NC} Instaluję zależności..."
npm install --production

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Błąd instalacji zależności${NC}"
  exit 1
fi

echo ""
echo -e "${YELLOW}➤${NC} Sprawdzam konfigurację..."

if [ ! -f ".env" ]; then
  echo -e "${RED}❌ Brak pliku .env${NC}"
  echo ""
  echo "Utwórz plik .env:"
  echo ""
  echo "  PORT=3005"
  echo "  RELAY_SECRET=$(openssl rand -hex 32)"
  echo ""
  exit 1
fi

source .env

if [ -z "$RELAY_SECRET" ]; then
  echo -e "${RED}❌ RELAY_SECRET nie jest ustawiony${NC}"
  exit 1
fi

if [ -z "$PORT" ]; then
  PORT=3005
  echo "PORT=3005" >> .env
  echo -e "${YELLOW}⚠️  Dodano PORT=3005 do .env${NC}"
fi

echo -e "${GREEN}✅ PORT: $PORT${NC}"
echo -e "${GREEN}✅ RELAY_SECRET: ${RELAY_SECRET:0:10}...${NC}"

echo ""
echo -e "${YELLOW}➤${NC} Uruchamiam worker..."
npm run pm2:start

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Błąd uruchamiania workera${NC}"
  pm2 logs smtp-relay-worker --lines 20 --nostream
  exit 1
fi

sleep 2

echo ""
echo -e "${YELLOW}➤${NC} Testuję worker..."
HEALTH=$(curl -s http://localhost:$PORT/health 2>/dev/null)

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ Worker odpowiada${NC}"
  echo "   Response: $HEALTH"
else
  echo -e "${RED}❌ Worker nie odpowiada${NC}"
  pm2 logs smtp-relay-worker --lines 20 --nostream
  exit 1
fi

echo ""
echo -e "${YELLOW}➤${NC} Testuję autoryzację..."
./test-local.sh > /tmp/test-result.txt 2>&1

if grep -q "✅ Worker działa poprawnie lokalnie" /tmp/test-result.txt; then
  echo -e "${GREEN}✅ Test autoryzacji: OK${NC}"
else
  echo -e "${RED}❌ Test autoryzacji: FAILED${NC}"
  cat /tmp/test-result.txt
  exit 1
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     ✅ Deploy zakończony sukcesem     ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}📊 Status workera:${NC}"
pm2 status | grep smtp-relay

echo ""
echo -e "${BLUE}🌐 Konfiguracja Supabase:${NC}"
echo ""
echo -e "  ${YELLOW}SMTP_RELAY_URL:${NC}"
echo "    http://$(curl -s ifconfig.me):$PORT"
echo ""
echo -e "  ${YELLOW}SMTP_RELAY_SECRET:${NC}"
echo "    $RELAY_SECRET"
echo ""
echo -e "${YELLOW}⚠️  Upewnij się że te zmienne są ustawione w Supabase:${NC}"
echo "    Settings → Edge Functions → Environment Variables"
echo ""
echo -e "${BLUE}📝 Przydatne komendy:${NC}"
echo ""
echo "  Status:       pm2 status"
echo "  Logi:         pm2 logs smtp-relay-worker"
echo "  Restart:      pm2 restart smtp-relay-worker"
echo "  Stop:         pm2 stop smtp-relay-worker"
echo "  Debug:        ./test-local.sh"
echo ""
