#!/bin/bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

clear
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Konfiguracja dla Supabase Edge Functions     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
echo ""

if [ ! -f .env ]; then
  echo "❌ Brak pliku .env"
  exit 1
fi

source .env

if [ -z "$RELAY_SECRET" ]; then
  echo "❌ RELAY_SECRET nie jest ustawiony"
  exit 1
fi

if [ -z "$PORT" ]; then
  PORT=3001
fi

echo -e "${YELLOW}📍 Twoje IP VPS:${NC}"
VPS_IP=$(curl -s ifconfig.me)
echo "   $VPS_IP"
echo ""

echo -e "${YELLOW}🔧 Skonfiguruj te zmienne w Supabase:${NC}"
echo ""
echo "   Settings → Edge Functions → Environment Variables"
echo ""

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}Zmienna 1:${NC}"
echo ""
echo "   Name:  ${YELLOW}SMTP_RELAY_URL${NC}"
echo "   Value: ${GREEN}http://${VPS_IP}:${PORT}${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}Zmienna 2:${NC}"
echo ""
echo "   Name:  ${YELLOW}SMTP_RELAY_SECRET${NC}"
echo "   Value: ${GREEN}${RELAY_SECRET}${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}⚠️  WAŻNE:${NC}"
echo ""
echo "   1. Nazwy zmiennych muszą być DOKŁADNIE takie jak powyżej"
echo "   2. Nie używaj innych nazw (np. RELAY_SECRET, SMTP_URL)"
echo "   3. Po zapisaniu w Supabase POCZEKAJ 90 sekund"
echo ""

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}📋 Kopiuj-wklej dla Supabase:${NC}"
echo ""
echo -e "${GREEN}SMTP_RELAY_URL:${NC}"
echo "http://${VPS_IP}:${PORT}"
echo ""
echo -e "${GREEN}SMTP_RELAY_SECRET:${NC}"
echo "${RELAY_SECRET}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}🔍 Sprawdź czy worker działa:${NC}"
HEALTH=$(curl -s http://localhost:$PORT/health 2>/dev/null)
if [ $? -eq 0 ]; then
  echo -e "   ${GREEN}✅ Worker działa poprawnie${NC}"
else
  echo -e "   ${RED}❌ Worker nie odpowiada${NC}"
  echo "   Uruchom: npm run pm2:start"
fi

echo ""
