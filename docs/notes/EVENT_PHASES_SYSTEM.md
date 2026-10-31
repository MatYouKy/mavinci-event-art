# System Faz Wydarzenia - Kompletna Dokumentacja

## 📋 Spis Treści
1. [Przegląd Systemu](#przegląd-systemu)
2. [Architektura Bazy Danych](#architektura-bazy-danych)
3. [Hierarchia Czasowa](#hierarchia-czasowa)
4. [Komponenty UI](#komponenty-ui)
5. [API i Hooki](#api-i-hooki)
6. [Wykrywanie Konfliktów](#wykrywanie-konfliktów)
7. [Przepływ Pracy](#przepływ-pracy)
8. [Uprawnienia i Bezpieczeństwo](#uprawnienia-i-bezpieczeństwo)

---

## Przegląd Systemu

System faz umożliwia szczegółowe zarządzanie wydarzeniami poprzez podział na sekwencyjne fazy czasowe (montaż, realizacja, demontaż) z indywidualnymi harmonogramami dla każdego pracownika.

### Kluczowe Funkcje
- ✅ Konfigurowalne typy faz z kolorami i czasami domyślnymi
- ✅ Sekwencyjne fazy bez nakładania (hard constraint)
- ✅ Indywidualne harmonogramy pracowników (dojazd + praca + powrót)
- ✅ Soft warnings dla konfliktów zasobów
- ✅ Sugestie alternatywnego sprzętu
- ✅ System zaproszeń i akceptacji (pending/accepted/rejected)
- ✅ Drag & resize w timeline UI
- ✅ Integracja z kalendarzem pracowników

---

## Architektura Bazy Danych

### 1. `event_phase_types` - Typy Faz (Konfigurowalne)

Szablony faz dostępne do wyboru przy tworzeniu.

```sql
CREATE TABLE event_phase_types (
  id uuid PRIMARY KEY,
  name text NOT NULL,                    -- np. "Montaż", "Realizacja"
  description text,
  color text NOT NULL DEFAULT '#3b82f6', -- Hex color (NIE czerwony!)
  icon text,                             -- Lucide icon name
  default_duration_hours integer DEFAULT 8,
  is_active boolean DEFAULT true,
  sequence_priority integer DEFAULT 0,   -- Sugerowana kolejność
  created_at timestamptz,
  updated_at timestamptz
);
```

**Domyślne Typy:**
- Załadunek (2h, #3b82f6)
- Dojazd (1h, #06b6d4)
- Montaż (4h, #8b5cf6)
- Realizacja (8h, #10b981)
- Demontaż (3h, #f59e0b)
- Powrót (1h, #06b6d4)
- Rozładunek (2h, #3b82f6)

**Uprawnienia:** Admin + `events_manage`

---

### 2. `event_phases` - Fazy Wydarzenia

Konkretne instancje faz w wydarzeniach.

```sql
CREATE TABLE event_phases (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  phase_type_id uuid NOT NULL REFERENCES event_phase_types(id),
  name text NOT NULL,              -- Nazwa (może nadpisać typ)
  description text,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  sequence_order integer NOT NULL, -- Kolejność w wydarzeniu
  color text,                      -- Może nadpisać kolor typu
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid REFERENCES employees(id),

  CHECK (end_time > start_time)
);
```

**Walidacja:** Trigger `ensure_phases_no_overlap` blokuje nakładające się fazy.

**Uprawnienia:**
- SELECT: Użytkownicy z dostępem do wydarzenia
- INSERT/UPDATE/DELETE: Admin, `events_manage`, koordynatorzy wydarzenia

---

### 3. `event_phase_assignments` - Indywidualne Harmonogramy Pracowników

Kluczowa tabela - każdy pracownik ma własny harmonogram w ramach fazy.

```sql
CREATE TABLE event_phase_assignments (
  id uuid PRIMARY KEY,
  phase_id uuid NOT NULL REFERENCES event_phases(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  -- Pełny harmonogram (włącznie z dojazdem/powrotem)
  assignment_start timestamptz NOT NULL,  -- Kiedy pracownik zaczyna (z dojazdem)
  assignment_end timestamptz NOT NULL,    -- Kiedy kończy (z powrotem)

  -- Faktyczna praca w fazie
  phase_work_start timestamptz NOT NULL,  -- Początek pracy w fazie
  phase_work_end timestamptz NOT NULL,    -- Koniec pracy w fazie

  -- Status zaproszenia
  invitation_status text NOT NULL DEFAULT 'pending'
    CHECK (invitation_status IN ('pending', 'accepted', 'rejected')),
  invitation_sent_at timestamptz DEFAULT now(),
  invitation_responded_at timestamptz,

  -- Dodatkowe informacje
  role text,                              -- np. 'lead', 'technician'
  travel_to_notes text,                   -- Informacje o dojeździe
  travel_from_notes text,                 -- Informacje o powrocie
  notes text,

  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid REFERENCES employees(id),

  CHECK (assignment_end > assignment_start),
  CHECK (phase_work_end > phase_work_start),
  CHECK (phase_work_start >= assignment_start),
  CHECK (phase_work_end <= assignment_end),
  UNIQUE (phase_id, employee_id)
);
```

**Przykład:**
```
Faza Montaż: 10:00 - 18:00

Pracownik A:
  assignment_start: 09:00   (1h dojazd)
  assignment_end:   19:00   (1h powrót)
  phase_work_start: 10:00   (faktyczna praca)
  phase_work_end:   18:00   (koniec pracy)
```

**Uprawnienia:**
- SELECT: Użytkownicy wydarzenia + przypisany pracownik
- INSERT: Admin, `events_manage`
- UPDATE: Admin, `events_manage`, przypisany pracownik (może akceptować/odrzucać)
- DELETE: Admin, `events_manage`

---

### 4. `event_phase_equipment` - Sprzęt w Fazie

```sql
CREATE TABLE event_phase_equipment (
  id uuid PRIMARY KEY,
  phase_id uuid NOT NULL REFERENCES event_phases(id) ON DELETE CASCADE,

  -- Jeden z trzech typów zasobów
  equipment_item_id uuid REFERENCES equipment_items(id) ON DELETE CASCADE,
  equipment_kit_id uuid REFERENCES equipment_kits(id) ON DELETE CASCADE,
  cable_id uuid REFERENCES cables(id) ON DELETE CASCADE,

  -- Elastyczne ramy czasowe (może obejmować transport/setup)
  assigned_start timestamptz NOT NULL,
  assigned_end timestamptz NOT NULL,

  quantity integer DEFAULT 1,
  notes text,

  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid REFERENCES employees(id),

  CHECK (assigned_end > assigned_start),
  CHECK (
    (equipment_item_id IS NOT NULL)::int +
    (equipment_kit_id IS NOT NULL)::int +
    (cable_id IS NOT NULL)::int = 1
  )
);
```

**Uprawnienia:** Admin, `events_manage`, `equipment_manage`

---

### 5. `event_phase_vehicles` - Pojazdy w Fazie

```sql
CREATE TABLE event_phase_vehicles (
  id uuid PRIMARY KEY,
  phase_id uuid NOT NULL REFERENCES event_phases(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES employees(id) ON DELETE SET NULL,

  assigned_start timestamptz NOT NULL,
  assigned_end timestamptz NOT NULL,

  purpose text,  -- 'transport', 'on-site', etc.
  notes text,

  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid REFERENCES employees(id),

  CHECK (assigned_end > assigned_start)
);
```

**Uprawnienia:** Admin, `events_manage`, `fleet_manage`

---

## Hierarchia Czasowa

```
Event (główne ramy: 2026-06-06 12:00 → 2026-06-07 02:00)
│
├── Phase 1: Montaż (2026-06-06 12:00 → 16:00)
│   ├── Employee Assignment: Jan Kowalski
│   │   ├── Dojazd:      11:00 → 12:00
│   │   ├── Praca:       12:00 → 16:00
│   │   └── Powrót:      16:00 → 17:00
│   │   Total: 11:00 → 17:00 (6h)
│   │
│   ├── Equipment: Mixer Yamaha #123
│   │   └── Assigned: 11:30 → 16:30 (transport included)
│   │
│   └── Vehicle: Ford Transit #456
│       └── Assigned: 11:00 → 17:00 (driver: Jan Kowalski)
│
├── Phase 2: Realizacja (2026-06-06 18:00 → 2026-06-07 01:00)
│   └── Employee Assignment: Anna Nowak
│       ├── Dojazd:      17:00 → 18:00
│       ├── Praca:       18:00 → 01:00
│       └── Powrót:      01:00 → 02:00
│       Total: 17:00 → 02:00 (9h)
│
└── Phase 3: Demontaż (2026-06-07 01:00 → 02:00)
    └── ...
```

---

## Komponenty UI

**UWAGA: Wszystkie komponenty używają Tailwind CSS (NIE Material-UI)!**
Szczegółowa dokumentacja stylistyki: `EVENT_PHASES_STYLING.md`

### 1. `EventPhasesTimeline.tsx` - Główny Komponent

**Lokalizacja:** `src/app/(crm)/crm/events/[id]/components/tabs/EventPhasesTimeline.tsx`

**Stylistyka:**
- Ciemny motyw: `#0f1119` + `#1c1f33`
- Złoty akcent: `#d3bb73`
- Lucide icons (Plus, Filter, Clock, AlertCircle)
- Tailwind CSS classes

**Funkcje:**
- Wyświetla wszystkie fazy na osi czasu
- Zoom (dni / godziny / minuty) - 3 przyciski w grupie
- Filtry zasobów (wszystkie / wybrane / z wydarzenia) - dropdown
- Wykrywanie konfliktów (czerwony badge z AlertCircle)
- Drag & resize faz (handlery GripVertical na krawędziach)
- Kliknięcie otwiera panel zasobów

**Użycie:**
```tsx
<EventPhasesTimeline
  eventId={event.id}
  eventStartDate={event.event_date}
  eventEndDate={event.event_end_date}
/>
```

---

### 2. `PhaseTimelineView.tsx` - Renderowanie Timeline

**Lokalizacja:** `src/app/(crm)/crm/events/[id]/components/tabs/PhaseTimelineView.tsx`

**Funkcje:**
- Oś czasu z markerami
- Kolorowe bloki faz z możliwością resize
- Drag handles na krawędziach (pojawiają się na hover)
- Wyświetlanie konfliktów (czerwona ramka + ikona Warning)
- Kalkulacja czasu trwania

**Interakcje:**
- Kliknięcie: Wybiera fazę
- Przeciągnięcie handlera: Zmienia czas rozpoczęcia/zakończenia
- Hover: Pokazuje handlery i przycisk delete

---

### 3. `PhaseResourcesPanel.tsx` - Panel Zasobów

**Lokalizacja:** `src/app/(crm)/crm/events/[id]/components/tabs/PhaseResourcesPanel.tsx`

**Funkcje:**
- Drawer po prawej stronie (500px)
- 3 taby: Pracownicy / Sprzęt / Pojazdy
- Wyświetlanie statusów zaproszeń (ikony: ✓ Zaakceptowane, ⚠ Oczekuje, ✗ Odrzucone)
- Podgląd indywidualnych harmonogramów
- Przyciski "Dodaj" dla każdego typu zasobu
- Podsumowanie w stopce

---

### 4. `AddPhaseModal.tsx` - Dodawanie Fazy

**Lokalizacja:** `src/app/(crm)/crm/events/[id]/components/Modals/AddPhaseModal.tsx`

**Funkcje:**
- Wybór typu fazy (z podglądem koloru i domyślnego czasu)
- Auto-wypełnianie nazwy z typu
- Sugestia czasu rozpoczęcia (po ostatniej fazie)
- Auto-kalkulacja czasu zakończenia na podstawie typu
- Walidacja nakładania się faz
- Walidacja ram czasowych wydarzenia

---

### 5. `AddPhaseAssignmentModal.tsx` - Dodawanie Pracownika

**Lokalizacja:** `src/app/(crm)/crm/events/[id]/components/Modals/AddPhaseAssignmentModal.tsx`

**Funkcje:**
- Wybór pracownika (obecnie UUID, TODO: autocomplete)
- Przełącznik "Uwzględnij czas dojazdu/powrotu"
- Dwa zestawy pól czasu:
  - **Pełny harmonogram** (z dojazdem/powrotem) - jasny background
  - **Faktyczna praca** (w fazie) - niebieska ramka
- Auto-kalkulacja czasu trwania
- Wykrywanie konfliktów w czasie rzeczywistym (lazy query)
- Pola na notatki o dojeździe i powrocie

**Przykład użycia:**
```tsx
<AddPhaseAssignmentModal
  open={addAssignmentOpen}
  onClose={() => setAddAssignmentOpen(false)}
  phase={selectedPhase}
/>
```

---

## API i Hooki

### RTK Query API (`eventPhasesApi.ts`)

**Lokalizacja:** `src/store/api/eventPhasesApi.ts`

#### Phase Types
```typescript
useGetPhaseTypesQuery() // Pobiera aktywne typy faz
useCreatePhaseTypeMutation() // Tworzy nowy typ (admin)
useUpdatePhaseTypeMutation() // Aktualizuje typ (admin)
```

#### Event Phases
```typescript
useGetEventPhasesQuery(eventId) // Pobiera fazy wydarzenia
useCreatePhaseMutation() // Tworzy nową fazę
useUpdatePhaseMutation() // Aktualizuje fazę (resize, rename)
useDeletePhaseMutation() // Usuwa fazę
```

#### Phase Assignments
```typescript
useGetPhaseAssignmentsQuery(phaseId) // Pobiera pracowników w fazie
useCreatePhaseAssignmentMutation() // Dodaje pracownika
useUpdatePhaseAssignmentMutation() // Aktualizuje przypisanie (akceptacja!)
useDeletePhaseAssignmentMutation() // Usuwa pracownika
```

#### Phase Equipment
```typescript
useGetPhaseEquipmentQuery(phaseId) // Pobiera sprzęt w fazie
useCreatePhaseEquipmentMutation() // Dodaje sprzęt
useDeletePhaseEquipmentMutation() // Usuwa sprzęt
```

#### Phase Vehicles
```typescript
useGetPhaseVehiclesQuery(phaseId) // Pobiera pojazdy w fazie
useCreatePhaseVehicleMutation() // Dodaje pojazd
useDeletePhaseVehicleMutation() // Usuwa pojazd
```

#### Conflict Detection (Lazy Queries)
```typescript
useLazyGetEmployeeConflictsQuery() // Sprawdza konflikty pracownika
useLazyGetEquipmentConflictsQuery() // Sprawdza konflikty sprzętu
useLazyGetAlternativeEquipmentQuery() // Sugeruje alternatywy
```

---

## Wykrywanie Konfliktów

### Typy Konfliktów

#### 1. **Hard Constraint - Nakładające się Fazy** (BLOKUJE)
Trigger w bazie danych nie pozwala na utworzenie faz które się nakładają.

```sql
-- Trigger: ensure_phases_no_overlap
-- Rzuca wyjątek jeśli fazy się nakładają
```

**Komunikat:** "Event phases cannot overlap. Adjust times to prevent conflicts."

---

#### 2. **Soft Warning - Konflikty Zasobów** (NIE BLOKUJE)

Wyświetlane jako ostrzeżenia, ale nie blokują zapisywania.

##### Konflikt Pracownika
```typescript
const { data: conflicts } = useLazyGetEmployeeConflictsQuery({
  employeeId: 'uuid',
  startTime: '2026-06-06T11:00:00Z',
  endTime: '2026-06-06T17:00:00Z',
});

// Zwraca:
[
  {
    phase_id: 'uuid',
    event_id: 'uuid',
    event_name: 'Inne Wesele',
    phase_name: 'Montaż',
    assignment_start: '2026-06-06T10:00:00Z',
    assignment_end: '2026-06-06T18:00:00Z'
  }
]
```

##### Konflikt Sprzętu
```typescript
const { data: conflicts } = useLazyGetEquipmentConflictsQuery({
  equipmentItemId: 'uuid',
  startTime: '2026-06-06T11:30:00Z',
  endTime: '2026-06-06T16:30:00Z',
});
```

##### Alternatywny Sprzęt
```typescript
const { data: alternatives } = useLazyGetAlternativeEquipmentQuery({
  equipmentItemId: 'uuid',
  startTime: '2026-06-06T11:30:00Z',
  endTime: '2026-06-06T16:30:00Z',
});

// Zwraca sprzęt z tej samej kategorii:
[
  {
    item_id: 'uuid',
    name: 'Yamaha MG16XU',
    model: 'MG16XU',
    category_name: 'Miksery',
    is_available: true  // Dostępny w tym czasie
  },
  {
    item_id: 'uuid',
    name: 'Behringer X32',
    model: 'X32',
    category_name: 'Miksery',
    is_available: false  // Zajęty
  }
]
```

---

### Wizualizacja Konfliktów

**Czerwone Badge:**
```tsx
{hasConflict && (
  <Chip
    icon={<Warning />}
    label="Nakładające się fazy!"
    size="small"
    color="error"
  />
)}
```

**Czerwona Ramka:**
```tsx
<Paper
  sx={{
    backgroundColor: hasConflict ? '#fee' : phaseColor + '20',
    borderColor: hasConflict ? '#dc2626' : phaseColor,
  }}
>
```

---

## Przepływ Pracy

### Scenariusz 1: Tworzenie Wydarzenia z Fazami

1. Admin tworzy wydarzenie "Wesele 2026-06-06"
2. System automatycznie tworzy domyślną fazę na podstawie kategorii
3. Admin klika "Fazy" → widzi jedną fazę "Wesele"
4. Admin klika "Dodaj fazę"
5. Wybiera typ "Montaż" (auto-wypełnia nazwę, czas 4h)
6. Ustawia czas: 12:00 - 16:00
7. Kliknięcie "Utwórz Fazę" → faza pojawia się na timeline
8. Admin przeciąga krawędź fazy aby zmienić czas
9. Kliknięcie na fazę → otwiera panel zasobów

---

### Scenariusz 2: Dodawanie Pracownika z Indywidualnym Harmonogramem

1. Admin otwiera panel zasobów fazy "Montaż"
2. Tab "Pracownicy" → "Dodaj Pracownika"
3. Modal:
   - ID Pracownika: Jan Kowalski
   - Rola: lead
   - Przełącznik dojazdu: ✓ Włączony
   - **Pełny harmonogram:** 11:00 → 17:00 (6h total)
   - **Faktyczna praca:** 12:00 → 16:00 (4h pracy)
   - Notatki dojazd: "Zbiórka w magazynie 11:00"
   - Notatki powrót: "Powrót do magazynu"
4. System wykrywa konflikt → pokazuje ostrzeżenie
5. Admin akceptuje konflikt (soft warning)
6. Kliknięcie "Dodaj Pracownika"
7. System wysyła zaproszenie (status: pending)
8. Pracownik widzi w kalendarzu fazę jako żółtą (pending)
9. Pracownik akceptuje → status zmienia się na accepted
10. Faza w kalendarzu zmienia kolor na zielony

---

### Scenariusz 3: Wykrywanie i Rozwiązywanie Konfliktu Sprzętu

1. Admin dodaje sprzęt "Mixer Yamaha #123" do fazy
2. System wykrywa konflikt (sprzęt używany w innym wydarzeniu)
3. Alert: "Mixer Yamaha #123 jest używany w: Inne Wesele - Montaż"
4. Przycisk "Pokaż alternatywy"
5. System pokazuje listę:
   - ✓ Yamaha MG16XU (dostępny)
   - ✗ Behringer X32 (zajęty)
   - ✓ Soundcraft Signature 16 (dostępny)
6. Admin wybiera "Yamaha MG16XU"
7. Sprzęt zostaje przypisany bez konfliktu

---

## Uprawnienia i Bezpieczeństwo

### Hierarchia Uprawnień

#### 1. **Phase Types (Typy Faz)**
- **Odczyt:** Wszyscy użytkownicy (tylko aktywne)
- **Zarządzanie:** `admin` + `events_manage`

#### 2. **Event Phases (Fazy)**
- **Odczyt:** Użytkownicy z dostępem do wydarzenia
- **Tworzenie/Edycja/Usuwanie:**
  - `admin`
  - `events_manage`
  - Koordynatorzy wydarzenia (role: 'coordinator', 'lead')

#### 3. **Phase Assignments (Przypisania)**
- **Odczyt:**
  - Użytkownicy wydarzenia
  - Przypisany pracownik (widzi tylko swoje)
- **Tworzenie:** `admin`, `events_manage`
- **Edycja:**
  - `admin`, `events_manage` (wszystko)
  - Przypisany pracownik (tylko `invitation_status`)
- **Usuwanie:** `admin`, `events_manage`

#### 4. **Phase Equipment/Vehicles**
- **Odczyt:** Użytkownicy wydarzenia
- **Zarządzanie:** `admin`, `events_manage`, odpowiednie uprawnienie (equipment_manage/fleet_manage)

---

### RLS Policies - Przykłady

#### Employees Can Accept/Reject Invitations
```sql
CREATE POLICY "Event managers and assigned employees can update assignments"
  ON event_phase_assignments FOR UPDATE
  TO authenticated
  USING (
    -- Pracownik może akceptować/odrzucać
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = event_phase_assignments.employee_id
      AND auth_user_id = auth.uid()
    )
    OR
    -- Managerowie mogą edytować wszystko
    EXISTS (
      SELECT 1 FROM employees
      WHERE auth_user_id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'events_manage' = ANY(permissions))
    )
  );
```

#### Phases Inherit Event Permissions
```sql
CREATE POLICY "Users can view phases of events they can access"
  ON event_phases FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_phases.event_id
      -- Dziedziczenie z events RLS
    )
  );
```

---

## Integracja z Kalendarzem (TODO)

### Wyświetlanie Faz w Kalendarzu

Pracownicy widzą w swoim kalendarzu:

```typescript
// Kolor w zależności od statusu
const getPhaseColor = (status: string, phaseColor: string) => {
  switch (status) {
    case 'accepted':
      return phaseColor; // Oryginalny kolor fazy
    case 'pending':
      return '#f59e0b'; // Żółty/pomarańczowy
    case 'rejected':
      return '#9ca3af'; // Szary
    default:
      return phaseColor;
  }
};
```

### Struktura Event dla Kalendarza

```typescript
{
  id: 'phase_assignment_id',
  title: 'Wesele - Montaż (lead)',
  start: '2026-06-06T11:00:00Z', // assignment_start
  end: '2026-06-06T17:00:00Z',   // assignment_end
  color: getPhaseColor(assignment.invitation_status, phase.color),
  extendedProps: {
    type: 'phase_assignment',
    phaseId: phase.id,
    eventId: event.id,
    eventName: event.name,
    phaseName: phase.name,
    workStart: '2026-06-06T12:00:00Z', // phase_work_start
    workEnd: '2026-06-06T16:00:00Z',   // phase_work_end
    invitationStatus: 'pending',
    travelToNotes: 'Zbiórka w magazynie 11:00',
    travelFromNotes: 'Powrót do magazynu',
  }
}
```

### Akcje w Kalendarzu

Kliknięcie na wydarzenie → modal z opcjami:
- ✓ Zaakceptuj zaproszenie
- ✗ Odrzuć zaproszenie
- 👁 Pokaż szczegóły wydarzenia
- 📍 Pokaż lokalizację
- 🚗 Informacje o dojeździe

---

## Notyfikacje (TODO)

### Email przy Przypisaniu do Fazy

```
Subject: Zaproszenie do udziału w fazie: Wesele - Montaż

Cześć Jan,

Zostałeś przypisany do fazy "Montaż" w wydarzeniu "Wesele".

📅 Data: 6 czerwca 2026
⏰ Twój harmonogram:
  • Dojazd: 11:00
  • Praca: 12:00 - 16:00 (4h)
  • Powrót: 17:00
  • Łącznie: 6h

🚗 Informacje o dojeździe:
Zbiórka w magazynie o 11:00

👤 Rola: Lead

[Zaakceptuj] [Odrzuć] [Zobacz Szczegóły]
```

### Push Notification

```
Nowa faza: Wesele - Montaż
6 czerwca, 12:00-16:00
Tap to accept invitation
```

---

## Rozszerzenia Przyszłościowe

### 1. Rozliczenia per Faza
```sql
ALTER TABLE event_phase_assignments ADD COLUMN hourly_rate numeric;
ALTER TABLE event_phase_assignments ADD COLUMN calculated_payment numeric;
```

### 2. Checklisty per Faza
```sql
CREATE TABLE phase_checklists (
  id uuid PRIMARY KEY,
  phase_id uuid REFERENCES event_phases(id),
  title text,
  items jsonb
);
```

### 3. Szablony Faz dla Kategorii
```sql
CREATE TABLE event_category_phase_templates (
  id uuid PRIMARY KEY,
  category_id uuid REFERENCES event_categories(id),
  phase_type_id uuid REFERENCES event_phase_types(id),
  default_order integer,
  default_offset_hours integer  -- Offset względem początku wydarzenia
);
```

### 4. Auto-Przypisywanie Zasobów
```sql
-- Przy tworzeniu fazy automatycznie przypisz zasoby z oferty
CREATE TRIGGER auto_assign_resources_to_phase
  AFTER INSERT ON event_phases
  FOR EACH ROW
  EXECUTE FUNCTION assign_resources_from_accepted_offer();
```

---

## Podsumowanie

System faz to kompletne rozwiązanie do zarządzania złożonymi wydarzeniami z wieloma pracownikami i zasobami. Kluczowe zalety:

1. **Indywidualne harmonogramy** - każdy pracownik ma własny czas z uwzględnieniem dojazdu
2. **Soft conflicts** - system ostrzega ale nie blokuje
3. **Inteligentne sugestie** - alternatywny sprzęt z tej samej kategorii
4. **Intuicyjny UI** - drag & resize, zoom, kolorowe timeline
5. **Bezpieczne** - RLS policies, walidacja w bazie
6. **Skalowalne** - gotowe na rozszerzenia (rozliczenia, checklisty, szablony)

**Status:** ✅ Gotowe do użycia (brakuje tylko integracji z kalendarzem i notyfikacji)
