# System Reprezentantów i Osób Decyzyjnych w Organizacjach

## Przegląd

System umożliwia zarządzanie strukturą organizacyjną w kontekście podpisywania umów i podejmowania decyzji podczas eventów.

## Struktura danych

### 1. **Główna osoba kontaktowa** (`primary_contact_id`)
- Osoba, z którą przeprowadzany jest główny kontakt
- Wybierana z listy kontaktów przypisanych do organizacji
- Pola: imię, nazwisko, stanowisko, email, telefon

### 2. **Reprezentant prawny** (`legal_representative_id`, `legal_representative_title`)
- Osoba uprawniona do podpisywania umów (np. Prezes Zarządu)
- Może być tożsama z osobą kontaktową (checkbox: `contact_is_representative`)
- Jeśli zaznaczono checkbox, reprezentant = osoba kontaktowa
- Pole `legal_representative_title` - stanowisko (np. "Prezes Zarządu", "Dyrektor", "Właściciel")

### 3. **Osoby decyzyjne** (tabela `organization_decision_makers`)
- Lista osób mogących podejmować decyzje podczas eventu (prokurenci, osoby uprawnione)
- Każda osoba może mieć:
  - Stanowisko/rolę (`title`)
  - Flagę "może podpisywać umowy" (`can_sign_contracts`)
  - Notatki (`notes`)

## Użycie w UI

### Widok szczegółów organizacji (`/crm/contacts/[id]`)

Nowa sekcja "Reprezentanci i osoby decyzyjne" zawiera:

1. **Panel osoby kontaktowej**
   - Dropdown wyboru osoby z listy kontaktów
   - Wyświetla: imię, nazwisko, stanowisko, email, telefon

2. **Panel reprezentanta prawnego**
   - Checkbox "Osoba kontaktowa jest też reprezentantem"
   - Jeśli niezaznaczony: dropdown wyboru innej osoby + pole stanowiska
   - Jeśli zaznaczony: automatycznie użyje osoby kontaktowej

3. **Panel osób decyzyjnych**
   - Lista osób z możliwością dodawania/usuwania
   - Przycisk "Dodaj" otwiera modal:
     - Wybór osoby z listy kontaktów
     - Pole stanowisko/rola (np. "Prokurent")
     - Checkbox "Może podpisywać umowy"

## Placeholdery w umowach

Nowe placeholdery dostępne w edytorze umów:

```
{{primary_contact_full_name}}       - Imię i nazwisko osoby kontaktowej
{{primary_contact_position}}        - Stanowisko osoby kontaktowej
{{primary_contact_email}}           - Email osoby kontaktowej
{{primary_contact_phone}}           - Telefon osoby kontaktowej

{{legal_representative_full_name}}  - Imię i nazwisko reprezentanta prawnego
{{legal_representative_title}}      - Stanowisko reprezentanta (np. Prezes Zarządu)

{{decision_makers_list}}            - Lista osób decyzyjnych (nazwiska + stanowiska)
```

## Przykład użycia w umowie

```
Umowa zawarta w dniu ... pomiędzy:

{{organization_name}} z siedzibą w {{organization_city}},
NIP: {{organization_nip}}

reprezentowaną przez:
{{legal_representative_full_name}} - {{legal_representative_title}}

zwaną dalej "Zamawiającym"

a

EVENT RULERS sp. z o.o.
...

Osoba kontaktowa po stronie Zamawiającego:
{{primary_contact_full_name}}
{{primary_contact_position}}
Tel: {{primary_contact_phone}}
Email: {{primary_contact_email}}

Osoby uprawnione do podejmowania decyzji podczas eventu:
{{decision_makers_list}}
```

## Baza danych

### Nowe kolumny w `organizations`:
- `primary_contact_id` - FK do `contacts`
- `legal_representative_id` - FK do `contacts`
- `legal_representative_title` - TEXT (stanowisko)
- `contact_is_representative` - BOOLEAN

### Nowa tabela `organization_decision_makers`:
```sql
id                  UUID PRIMARY KEY
organization_id     UUID FK -> organizations(id)
contact_id          UUID FK -> contacts(id)
title               TEXT (stanowisko/rola)
can_sign_contracts  BOOLEAN
notes               TEXT
created_at          TIMESTAMPTZ
```

## Komponenty

- **OrganizationRepresentatives.tsx** - Główny komponent UI dla sekcji
- **Zmodyfikowane**: `/contacts/[id]/page.tsx` - dodana sekcja w widoku organizacji
- **Zmodyfikowane**: `/contract-templates/[id]/edit-wysiwyg/page.tsx` - dodane placeholdery

## Przepływ pracy

1. Dodaj kontakty do organizacji w zakładce "Kontakty"
2. Przejdź do zakładki "Szczegóły"
3. W sekcji "Reprezentanci i osoby decyzyjne":
   - Wybierz osobę kontaktową
   - Ustaw reprezentanta prawnego (lub zaznacz checkbox jeśli to ta sama osoba)
   - Dodaj osoby decyzyjne z przycisku "Dodaj"
4. Użyj placeholderów w szablonach umów

## Bezpieczeństwo

- RLS policies umożliwiają dostęp tylko zalogowanym użytkownikom
- Wszystkie operacje są audytowane
- Kaskadowe usuwanie przy usunięciu organizacji lub kontaktu
