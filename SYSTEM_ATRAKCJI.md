# System Atrakcji i Usług - Dokumentacja

## Przegląd systemu

System atrakcji został zaprojektowany do kompleksowego zarządzania ofertą usług event owych z pełną integracją sprzętu, personelu i kosztorysów.

## Struktura bazy danych

### Główne tabele

#### 1. `attractions` - Katalog atrakcji

Główna tabela przechowująca informacje o dostępnych atrakcjach:

- `name` - Nazwa atrakcji (np. "DJ + Nagłośnienie")
- `description` - Szczegółowy opis
- `category` - Kategoria (sound_system, dj_services, casino, itd.)
- `base_price` - Cena bazowa
- `unit` - Jednostka rozliczeniowa (szt, godz, dzień)
- `max_daily_capacity` - Maksymalna ilość sprzedaży dziennie
- `requires_operator` - Czy wymaga operatora
- `setup_time_minutes` - Czas montażu
- `breakdown_time_minutes` - Czas demontażu

#### 2. `attraction_required_equipment` - Sprzęt wymagany

Definicja sprzętu niezbędnego do realizacji atrakcji:

- `attraction_id` - ID atrakcji
- `equipment_id` - ID sprzętu z tabeli `equipment`
- `quantity` - Wymagana ilość
- `is_primary` - Czy to główny sprzęt
- `notes` - Notatki

**Funkcjonalność:**

- Automatycznie rezerwuje sprzęt przy dodaniu atrakcji do eventu
- Blokuje możliwość sprzedaży gdy brak sprzętu
- Generuje listę do załadunku

#### 3. `equipment_accessories` - Akcesoria sprzętu

Automatycznie dołączane elementy do sprzętu:

- `parent_equipment_id` - ID głównego sprzętu
- `accessory_name` - Nazwa akcesorium (np. "Kabel HDMI")
- `accessory_description` - Opis
- `quantity` - Ilość
- `is_required` - Czy wymagane
- `category` - Kategoria (cables, power, control, adapters, transport)

**Przykład:**

```sql
Rzutnik Epson:
  - Kabel HDMI 5m (wymagany)
  - Kabel zasilający 3m (wymagany)
  - Pilot (wymagany)
  - Adapter VGA (opcjonalny)
  - Torba transportowa (wymagana)
```

#### 4. `attraction_required_staff` - Wymagany personel

Definicja personelu potrzebnego do obsługi:

- `attraction_id` - ID atrakcji
- `role` - Rola (np. "DJ", "Technik audio", "Operator")
- `count` - Ilość osób
- `required_skills` - Wymagane umiejętności (tablica)
- `notes` - Dodatkowe wymagania

#### 5. `attraction_costs` - Kosztorys

Szczegółowy rozkład kosztów:

- `attraction_id` - ID atrakcji
- `cost_type` - Typ kosztu (equipment, labor, transport, materials, other)
- `description` - Opis pozycji
- `amount` - Kwota
- `notes` - Notatki

**Typ kosztu:**

- `equipment` - Amortyzacja sprzętu
- `labor` - Koszty pracy
- `transport` - Transport
- `materials` - Materiały eksploatacyjne
- `other` - Inne koszty

#### 6. `attraction_checklist_templates` - Szablon checklisty

Automatycznie generowane zadania przy dodaniu do eventu:

- `attraction_id` - ID atrakcji
- `title` - Tytuł zadania
- `description` - Opis
- `category` - Kategoria (setup, operation, breakdown, safety, quality_check)
- `sort_order` - Kolejność
- `is_required` - Czy wymagane

## Funkcje systemu

### 1. Zarządzanie katalogiem atrakcji

- **Przeglądanie** - Lista wszystkich atrakcji z filtrowaniem po kategorii
- **Szczegóły** - Pełny widok z zakładkami (Przegląd, Sprzęt, Personel, Kosztorys, Checklist)
- **Edycja** - Możliwość edycji wszystkich parametrów
- **Aktywacja/Dezaktywacja** - Kontrola dostępności w ofercie

### 2. Sprzęt i akcesoria

- **Przypisanie sprzętu** - Wybór wymaganego sprzętu z magazynu
- **Automatyczne akcesoria** - System automatycznie dodaje akcesoria do sprzętu
- **Przykład workflow:**
  ```
  Dodajesz "Rzutnik Epson" → System automatycznie dołącza:
    ✓ Kabel HDMI
    ✓ Kabel zasilający
    ✓ Pilot
    ✓ Adapter VGA (opcjonalny)
    ✓ Torba transportowa
  ```

### 3. Rezerwacja zasobów

- **Blokowanie sprzętu** - Automatyczne przy akceptacji oferty
- **Kontrola dostępności** - System sprawdza czy sprzęt jest dostępny w danych datach
- **Maksymalna sprzedaż** - Limit ilości atrakcji dziennie (max_daily_capacity)

### 4. Generowanie checklisty

Po podpisaniu umowy (status: offer_accepted), system automatycznie:

1. Tworzy checklistę dla eventu z szablonu atrakcji
2. Dodaje wszystkie punkty z `attraction_checklist_templates`
3. Dołącza listę sprzętu ze szczegółami i akcesoriami
4. Przypisuje odpowiedzialność do pracowników

**Przykład checklisty:**

```
[ ] MONTAŻ
  [ ] Załaduj rzutnik Epson + akcesoria:
      - Kabel HDMI 5m
      - Kabel zasilający
      - Pilot
      - Torba transportowa
  [ ] Załaduj nagłośnienie Bose

[ ] SETUP
  [ ] Podłącz rzutnik (HDMI + zasilanie)
  [ ] Test projekcji

[ ] DEMONTAŻ
  [ ] Sprawdź kompletność akcesoriów
  [ ] Zapakuj do torby
```

### 5. Kosztorys i rentowność

- **Suma kosztów** - Automatyczne podsumowanie wszystkich pozycji
- **Marża** - Różnica między ceną bazową a kosztami
- **Analiza** - Raport rentowności atrakcji

## Integracja z ofertami

### Dodawanie atrakcji do oferty

1. Wybierasz atrakcję z katalogu
2. System sprawdza dostępność sprzętu i personelu
3. Dodaje pozycję do oferty z ceną bazową
4. Możesz edytować cenę końcową i rabat

### Akceptacja oferty

1. Klient akceptuje ofertę
2. System automatycznie:
   - Rezerwuje wszystkie wymagane sprzęty
   - Blokuje dostępność w kalendarzu
   - Generuje checklistę z szablonów
   - Tworzy zadania dla zespołu

### Odwołanie/Anulowanie

- Automatyczne zwolnienie zarezerwowanych zasobów
- Sprzęt wraca do puli dostępnej
- Usunięcie checklisty

## Kategorie atrakcji

```typescript
sound_system     - Nagłośnienie
lighting         - Oświetlenie
dj_services      - DJ
stage_tech       - Technika sceniczna
decorations      - Dekoracje
entertainment    - Rozrywka
casino           - Kasyno
simulators       - Symulatory (VR, gogle)
conference       - Konferencje
streaming        - Streaming
other            - Inne
```

## Bezpieczeństwo

### Row Level Security (RLS)

Wszystkie tabele mają włączone RLS z politykami:

- Authenticated users - mogą czytać i zarządzać danymi
- Separacja danych między klientami (przygotowane na multi-tenant)

## API Endpoints (via Supabase)

### Pobieranie atrakcji

```typescript
const { data } = await supabase.from('attractions').select('*').eq('is_active', true);
```

### Pobieranie z wymaganym sprzętem

```typescript
const { data } = await supabase
  .from('attractions')
  .select(
    `
    *,
    required_equipment:attraction_required_equipment(
      *,
      equipment:equipment_id(*)
    )
  `,
  )
  .eq('id', attractionId);
```

### Generowanie checklisty

```typescript
// 1. Pobierz szablon
const { data: templates } = await supabase
  .from('attraction_checklist_templates')
  .select('*')
  .eq('attraction_id', attractionId);

// 2. Utwórz checklistę dla eventu
const { data } = await supabase.from('event_checklists').insert(
  templates.map((t) => ({
    event_id: eventId,
    task: t.title,
    description: t.description,
    priority: t.is_required ? 'high' : 'medium',
    completed: false,
  })),
);
```

## Najlepsze praktyki

### 1. Definiowanie atrakcji

- Zawsze dodaj sprzęt wymagany
- Określ maksymalną dzienna sprzedaż
- Dodaj szczegółowy kosztorys
- Utwórz kompletną checklistę

### 2. Akcesoria sprzętu

- Zdefiniuj wszystkie niezbędne elementy
- Oznacz co jest wymagane vs opcjonalne
- Kategoryzuj (cables, power, control, etc.)

### 3. Personel

- Określ wymagane umiejętności
- Podaj liczbę osób
- Dodaj specjalne wymagania w notatkach

### 4. Kosztorys

- Rozbij na kategorie (sprzęt, praca, transport)
- Aktualizuj regularnie
- Uwzględnij amortyzację sprzętu

## Przykładowy workflow

### Konfiguracja atrakcji "DJ + Nagłośnienie"

```typescript
1. Utworzenie atrakcji:
   - Nazwa: "DJ + Pełne nagłośnienie"
   - Kategoria: dj_services
   - Cena: 3000 zł
   - Max dziennie: 3
   - Wymaga operatora: TAK
   - Czas montażu: 60 min
   - Czas demontażu: 45 min

2. Sprzęt wymagany:
   - Konsola DJ Pioneer (1 szt) [główny]
   - Głośniki Bose 500W (2 szt)
   - Mikser Behringer (1 szt)
   - Kable i okablowanie (1 komplet)

3. Akcesoria (automatyczne):
   Konsola DJ:
     - Kabel zasilający
     - Kabel audio XLR
     - Pendrive backup
   Głośniki:
     - Kable głośnikowe 10m x2
     - Statywy x2
     - Kable zasilające x2

4. Personel:
   - DJ (1 osoba)
     Skills: [mixing, event_hosting, music_selection]

5. Kosztorys:
   - Sprzęt (amortyzacja): 500 zł
   - Praca DJ (4h): 800 zł
   - Transport: 200 zł
   - Inne: 100 zł
   SUMA: 1600 zł
   MARŻA: 1400 zł (47%)

6. Checklist:
   SETUP:
   - Załaduj konsole DJ + akcesoria
   - Załaduj głośniki + statywy
   - Sprawdź pendriv backup

   OPERATION:
   - Podłącz konsole do zasilania
   - Ustaw głośniki na statywach
   - Test dźwięku
   - Sprawdź playlistę

   BREAKDOWN:
   - Spakuj sprzęt
   - Sprawdź kompletność
   - Załaduj do pojazdu
```

## Rozbudowa systemu

### Planowane funkcje:

- [ ] Automatyczne kalkulacje marży
- [ ] Sugestie cenowe na podstawie kosztów
- [ ] Pakiety atrakcji (bundle)
- [ ] Analityka sprzedaży
- [ ] Prognozowanie dostępności
- [ ] Integracja z systemem magazynowym
- [ ] Automatyczne zamówienia materiałów

## Pomoc techniczna

W razie problemów:

1. Sprawdź logi w konsoli przeglądarki
2. Zweryfikuj polityki RLS w Supabase
3. Upewnij się że migracja została zastosowana
4. Sprawdź czy użytkownik jest uwierzytelniony
