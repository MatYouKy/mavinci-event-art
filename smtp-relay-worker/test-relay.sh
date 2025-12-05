#!/bin/bash

# Kolorowe outputy
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "======================================"
echo "   SMTP Relay Worker - Test"
echo "======================================"
echo ""

# 1. Health check
echo -e "${YELLOW}1. Testing health endpoint...${NC}"
HEALTH=$(curl -s http://localhost:3001/health)
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo -e "${GREEN}✅ Health check passed${NC}"
  echo "$HEALTH" | jq '.'
else
  echo -e "${RED}❌ Health check failed${NC}"
  echo "$HEALTH"
  exit 1
fi

echo ""

# 2. Test bez autoryzacji (powinien zwrócić 401)
echo -e "${YELLOW}2. Testing without authorization (should fail)...${NC}"
UNAUTHORIZED=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:3001/api/send-email \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}')

if [ "$UNAUTHORIZED" = "401" ]; then
  echo -e "${GREEN}✅ Authorization check passed (401 as expected)${NC}"
else
  echo -e "${RED}❌ Authorization check failed (got $UNAUTHORIZED instead of 401)${NC}"
  exit 1
fi

echo ""

# 3. Test z niewłaściwymi danymi
echo -e "${YELLOW}3. Testing with missing fields (should fail)...${NC}"

if [ -f .env ]; then
  source .env
else
  echo -e "${RED}❌ .env file not found${NC}"
  exit 1
fi

MISSING_FIELDS=$(curl -s \
  -X POST http://localhost:3001/api/send-email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RELAY_SECRET" \
  -d '{"test": "data"}')

if echo "$MISSING_FIELDS" | grep -q '"success":false'; then
  echo -e "${GREEN}✅ Validation check passed (rejected invalid data)${NC}"
  echo "$MISSING_FIELDS" | jq '.'
else
  echo -e "${RED}❌ Validation check failed${NC}"
  echo "$MISSING_FIELDS"
fi

echo ""
echo "======================================"
echo -e "${GREEN}✅ All tests passed!${NC}"
echo "======================================"
echo ""
echo "To test actual email sending, provide your SMTP credentials:"
echo ""
echo "curl -X POST http://localhost:3001/api/send-email \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -H \"Authorization: Bearer \$RELAY_SECRET\" \\"
echo "  -d '{"
echo "    \"smtpConfig\": {"
echo "      \"host\": \"smtp.example.com\","
echo "      \"port\": 587,"
echo "      \"username\": \"user@example.com\","
echo "      \"password\": \"password\","
echo "      \"from\": \"user@example.com\","
echo "      \"fromName\": \"Test User\""
echo "    },"
echo "    \"to\": \"recipient@example.com\","
echo "    \"subject\": \"Test Email\","
echo "    \"body\": \"<p>Hello World</p>\""
echo "  }'"
echo ""
