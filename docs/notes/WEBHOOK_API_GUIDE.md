# Webhook API — Instrukcja podłączenia

## Przegląd

System webhooków umożliwia przyjmowanie zdarzeń z dowolnych zewnętrznych stron i aplikacji. Każde zdarzenie generuje powiadomienie w CRM dla odpowiednich pracowników.

## Krok 1: Utwórz źródło w CRM

1. Otwórz **Ustawienia → Webhooki i integracje**
2. Kliknij **Dodaj źródło**
3. Podaj nazwę (np. "Event Rulers"), slug (np. `event-rulers`), dozwolone typy zdarzeń i uprawnienia
4. Po zapisaniu pojawi się **klucz API** — skopiuj go natychmiast, nie będzie wyświetlony ponownie

## Krok 2: Wyślij zdarzenie

### Endpoint

```
POST https://<SUPABASE_URL>/functions/v1/receive-webhook
```

### Nagłówki

```
Authorization: Bearer whk_<twoj_klucz_api>
Content-Type: application/json
```

### Body (JSON)

```json
{
  "source_id": "event-rulers",
  "event_type": "contact_form",
  "title": "Nowe zapytanie od Jan Kowalski",
  "body": "Dzień dobry, chciałbym zapytać o organizację wesela na 150 osób w czerwcu 2026.",
  "external_event_id": "form-20260810-abc123",
  "priority": "normal",
  "event_time": "2026-08-10T14:30:00Z",
  "detail_url": "https://eventrulers.pl/admin/kontakty/abc123",
  "metadata": {
    "email": "jan@example.com",
    "phone": "+48 600 123 456",
    "event_type": "wesele",
    "guests": 150,
    "preferred_date": "2026-06-20",
    "source_page": "/kontakt"
  }
}
```

### Pola

| Pole | Wymagane | Opis |
|------|----------|------|
| `source_id` | Tak | Slug źródła (taki jak w CRM) |
| `event_type` | Tak | Typ zdarzenia: `contact_form`, `order`, `payment`, `registration` itp. |
| `title` | Tak | Krótki tytuł powiadomienia |
| `external_event_id` | Tak | Unikalny ID zdarzenia po stronie źródła (zapobiega duplikatom) |
| `body` | Nie | Pełna treść wiadomości |
| `priority` | Nie | `low`, `normal` (domyślnie), `high`, `critical` |
| `event_time` | Nie | Kiedy zdarzenie wystąpiło (domyślnie: teraz) |
| `detail_url` | Nie | Link do szczegółów na stronie źródłowej |
| `metadata` | Nie | Dowolne dane JSON (email, telefon, itp.) |

## Krok 3: Odpowiedzi

### Sukces (201)

```json
{
  "status": "accepted",
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "notification_id": "660e8400-e29b-41d4-a716-446655440001"
}
```

### Duplikat (200)

```json
{
  "status": "duplicate",
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Event already processed"
}
```

### Błędy

| Kod | Opis |
|-----|------|
| 400 | Brakujące wymagane pola lub niedozwolony typ zdarzenia |
| 401 | Brak lub nieprawidłowy klucz API |
| 403 | Źródło jest wyłączone (`is_active = false`) |
| 405 | Metoda inna niż POST |

## Przykład: curl

```bash
curl -X POST \
  'https://<SUPABASE_URL>/functions/v1/receive-webhook' \
  -H 'Authorization: Bearer whk_a1b2c3d4e5f6...' \
  -H 'Content-Type: application/json' \
  -d '{
    "source_id": "event-rulers",
    "event_type": "contact_form",
    "title": "Zapytanie: wesele Kraków",
    "body": "Proszę o wycenę wesela na 100 osób.",
    "external_event_id": "er-form-12345",
    "priority": "normal",
    "metadata": {
      "email": "klient@example.com",
      "phone": "+48 500 000 000"
    }
  }'
```

## Przykład: JavaScript (strona www)

```javascript
async function sendWebhookEvent(formData) {
  const response = await fetch(
    'https://<SUPABASE_URL>/functions/v1/receive-webhook',
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer whk_a1b2c3d4e5f6...',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_id: 'event-rulers',
        event_type: 'contact_form',
        title: `Zapytanie od ${formData.name}`,
        body: formData.message,
        external_event_id: `er-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        priority: 'normal',
        metadata: {
          email: formData.email,
          phone: formData.phone,
        },
      }),
    }
  );
  return response.json();
}
```

## Podłączenie kolejnej strony

1. W CRM utwórz nowe źródło (np. slug `moja-strona`, dozwolone typy: `contact_form,order`)
2. Skopiuj klucz API
3. W kodzie strony dodaj wywołanie `fetch` jak powyżej, zmieniając `source_id` na slug nowego źródła
4. Upewnij się, że `external_event_id` jest unikalny dla każdego wysłanego formularza

## Wdrożenie edge function

Narzędzia automatycznego wdrożenia są tymczasowo niedostępne. Aby wdrożyć ręcznie:

1. W Supabase Dashboard → Edge Functions → Create Function
2. Nazwa: `receive-webhook`
3. Wklej zawartość pliku `supabase/functions/receive-webhook/index.ts`
4. Ustaw **Verify JWT: OFF** (webhook przyjmuje zewnętrzne żądania bez tokenu Supabase)
5. Kliknij Deploy

## Bezpieczeństwo

- Klucze API są przechowywane jako hash SHA-256 — nigdy w postaci jawnej
- Każde źródło może mieć ograniczone dozwolone typy zdarzeń
- Duplikaty są automatycznie wykrywane i odrzucane (bez błędu)
- Edge function działa po stronie serwera — klucz service_role nigdy nie trafia do przeglądarki
