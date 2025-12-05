#!/bin/bash

echo ""
echo "======================================"
echo "   SMTP Relay - Config Checker"
echo "======================================"
echo ""

# Sprawdź czy .env istnieje
if [ ! -f .env ]; then
  echo "❌ Plik .env nie istnieje!"
  echo "   Utwórz go: cp .env.example .env"
  exit 1
fi

# Wczytaj .env
source .env

# Sprawdź RELAY_SECRET
if [ -z "$RELAY_SECRET" ]; then
  echo "❌ RELAY_SECRET nie jest ustawiony w .env"
  echo ""
  echo "Wygeneruj nowy sekret:"
  echo "  openssl rand -hex 32"
  echo ""
  echo "Dodaj do .env:"
  echo "  RELAY_SECRET=<wygenerowany-sekret>"
  exit 1
fi

echo "✅ RELAY_SECRET jest ustawiony"
echo ""
echo "Twój RELAY_SECRET (pierwsze 10 znaków):"
echo "  ${RELAY_SECRET:0:10}..."
echo ""
echo "Długość: ${#RELAY_SECRET} znaków"
echo ""

# Sprawdź czy worker działa
echo "Sprawdzam czy worker działa..."
HEALTH=$(curl -s http://localhost:$PORT/health 2>/dev/null)

if [ $? -eq 0 ]; then
  echo "✅ Worker działa na porcie $PORT"
else
  echo "❌ Worker nie odpowiada na porcie $PORT"
  echo "   Uruchom: npm run pm2:start"
  exit 1
fi

echo ""
echo "======================================"
echo "   Co teraz zrobić:"
echo "======================================"
echo ""
echo "1. Skopiuj pełny sekret:"
echo ""
echo "   $RELAY_SECRET"
echo ""
echo "2. Idź do Supabase Dashboard:"
echo "   Settings → Edge Functions → Environment Variables"
echo ""
echo "3. Znajdź zmienną: SMTP_RELAY_SECRET"
echo ""
echo "4. Upewnij się że wartość to DOKŁADNIE:"
echo "   $RELAY_SECRET"
echo ""
echo "5. Zapisz i poczekaj ~30 sekund"
echo ""
echo "======================================"
echo ""
