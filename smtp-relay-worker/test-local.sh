#!/bin/bash

echo ""
echo "======================================"
echo "   Test workera lokalnie"
echo "======================================"
echo ""

if [ ! -f .env ]; then
  echo "❌ Brak .env"
  exit 1
fi

source .env

if [ -z "$RELAY_SECRET" ]; then
  echo "❌ Brak RELAY_SECRET"
  exit 1
fi

if [ -z "$PORT" ]; then
  PORT=3001
fi

echo "Testuję worker na porcie $PORT..."
echo ""

# Test health
echo "1. Test /health:"
HEALTH=$(curl -s http://localhost:$PORT/health)
if [ $? -eq 0 ]; then
  echo "✅ Worker odpowiada"
  echo "   Response: $HEALTH"
else
  echo "❌ Worker nie odpowiada"
  echo "   Sprawdź: pm2 status"
  exit 1
fi

echo ""
echo "2. Test autoryzacji:"

# Test auth
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:$PORT/api/send-email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RELAY_SECRET" \
  -d '{
    "smtpConfig": {
      "host": "test",
      "port": 587,
      "username": "test",
      "password": "test",
      "from": "test@test.com",
      "fromName": "Test"
    },
    "to": "test@test.com",
    "subject": "Test",
    "body": "Test"
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" == "400" ]; then
  echo "✅ Autoryzacja działa!"
  echo "   (Błąd 400 to OK - brak prawdziwych danych SMTP)"
  echo "   Response: $BODY"
elif [ "$HTTP_CODE" == "401" ]; then
  echo "❌ Błąd autoryzacji!"
  echo "   Response: $BODY"
  echo ""
  echo "Sprawdź logi:"
  echo "   pm2 logs smtp-relay-worker --lines 20"
  exit 1
else
  echo "⚠️  Nieoczekiwany kod: $HTTP_CODE"
  echo "   Response: $BODY"
fi

echo ""
echo "======================================"
echo "✅ Worker działa poprawnie lokalnie"
echo "======================================"
echo ""
echo "Konfiguracja Supabase:"
echo ""
echo "SMTP_RELAY_URL:"
echo "  http://$(curl -s ifconfig.me):$PORT"
echo ""
echo "SMTP_RELAY_SECRET:"
echo "  $RELAY_SECRET"
echo ""
