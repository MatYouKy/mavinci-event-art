# Zaproszenia do wydarzeń oparte na przypisaniach do faz

## Przegląd zmian

Zaktualizowano system zaproszeń do wydarzeń tak, aby:
1. Dodawanie do zespołu było możliwe tylko dla pracowników przypisanych do faz
2. Modal "Dodaj osobę do zespołu" pokazywał tylko pracowników z faz
3. Email zaproszenia zawierał tabelę z fazami i przedziałami godzinowymi

## Zmiany w plikach

### 1. Modal AddEventEmployeeModal.tsx

**Ścieżka**: `src/app/(crm)/crm/events/[id]/components/Modals/AddEventEmployeeModal.tsx`

**Zmiany**:
- Dodano pobieranie pracowników przypisanych do faz wydarzenia
- Dodano filtrowanie listy pracowników - widoczni są tylko ci przypisani do faz
- Dodano wyświetlanie listy faz z godzinami pracy przy wybranym pracowniku
- Dodano informację dla użytkownika: "Widoczni są tylko pracownicy przypisani do faz wydarzenia"

**Nowe funkcje**:
```typescript
const fetchEmployeesInPhases = async () => {
  // Pobiera wszystkich pracowników przypisanych do faz wydarzenia
  // wraz z ich harmonogramami pracy
}

const availableEmployees = useMemo(() => {
  // Filtruje pracowników - pokazuje tylko tych przypisanych do faz
  // i nie będących już w zespole wydarzenia
});

const selectedEmployeePhases = useMemo(() => {
  // Zwraca listę faz dla wybranego pracownika
});
```

**UI**:
- Select z pracownikami pokazuje tylko dostępnych (przypisanych do faz)
- Po wyborze pracownika wyświetla się sekcja "Przypisane fazy" z tabelą:
  - Nazwa fazy
  - Godziny pracy (rozpoczęcie - zakończenie)

### 2. Edge Function send-event-invitation

**Ścieżka**: `supabase/functions/send-event-invitation/index.ts`

**Zmiany**:
- Dodano pobieranie przypisań pracownika do faz wydarzenia
- Dodano generowanie tabeli HTML z fazami
- Dodano wstawienie tabeli do emaila zaproszenia

**Nowe zapytanie**:
```typescript
const { data: phaseAssignments, error: phasesError } = await supabase
  .from("event_phase_assignments")
  .select(`
    phase_id,
    assignment_start,
    assignment_end,
    phase_work_start,
    phase_work_end,
    event_phases!inner(
      id,
      name,
      start_time,
      end_time,
      color,
      event_id
    )
  `)
  .eq("employee_id", assignment.employee_id)
  .eq("event_phases.event_id", assignment.event_id);
```

**Tabela w emailu**:
```html
<table>
  <thead>
    <tr>
      <th>Faza</th>
      <th>Rozpoczęcie pracy</th>
      <th>Zakończenie pracy</th>
    </tr>
  </thead>
  <tbody>
    <!-- Dla każdej fazy: -->
    <tr>
      <td>• Nazwa fazy (z kolorem)</td>
      <td>DD.MM.YYYY HH:MM</td>
      <td>DD.MM.YYYY HH:MM</td>
    </tr>
  </tbody>
</table>
```

## Jak to działa

### Flow dodawania pracownika do zespołu:

1. **Użytkownik otwiera modal "Dodaj osobę do zespołu"**
   - Modal automatycznie pobiera wszystkich pracowników przypisanych do faz
   - Lista select pokazuje tylko pracowników z faz (którzy nie są jeszcze w zespole)

2. **Użytkownik wybiera pracownika**
   - Wyświetla się lista jego faz z godzinami pracy
   - Użytkownik widzi dokładnie kiedy pracownik jest przypisany

3. **Użytkownik wypełnia formularz i dodaje pracownika**
   - Tworzy się wpis w `employee_assignments`
   - Frontend wywołuje edge function `send-event-invitation`

4. **Edge function wysyła email**
   - Pobiera dane zaproszenia
   - Pobiera fazy pracownika z `event_phase_assignments`
   - Generuje HTML emaila z tabelą faz
   - Wysyła email na podstawie preferencji pracownika (work/personal/both)

5. **Pracownik otrzymuje email z tabelą faz**
   - Widzi dokładne godziny pracy w każdej fazie
   - Może zaakceptować lub odrzucić zaproszenie

## Struktura danych

### event_phase_assignments
```sql
CREATE TABLE event_phase_assignments (
  id uuid PRIMARY KEY,
  phase_id uuid REFERENCES event_phases(id),
  employee_id uuid REFERENCES employees(id),
  assignment_start timestamptz,      -- Czas rozpoczęcia (z dojazdem)
  assignment_end timestamptz,        -- Czas zakończenia (z powrotem)
  phase_work_start timestamptz,      -- Początek pracy
  phase_work_end timestamptz,        -- Koniec pracy
  invitation_status text,            -- pending/accepted/rejected
  ...
);
```

### employee_assignments
```sql
CREATE TABLE employee_assignments (
  id uuid PRIMARY KEY,
  event_id uuid REFERENCES events(id),
  employee_id uuid REFERENCES employees(id),
  status text,                       -- pending/accepted/rejected
  role text,
  responsibilities text,
  invitation_token uuid,
  invitation_expires_at timestamptz,
  ...
);
```

## Walidacje

### Modal:
- ✅ Pokazuje tylko pracowników przypisanych do faz
- ✅ Ukrywa pracowników już będących w zespole
- ✅ Wyświetla komunikat gdy brak dostępnych pracowników
- ✅ Pokazuje harmonogram wybranego pracownika

### Email:
- ✅ Zawiera tabelę z fazami i godzinami
- ✅ Pokazuje kolory faz
- ✅ Formatuje daty i godziny po polsku
- ✅ Obsługuje brak przypisań do faz (nie wyświetla tabeli)

## Przykład emaila

```
╔══════════════════════════════════════════╗
║   🎉 Zaproszenie do wydarzenia           ║
╚══════════════════════════════════════════╝

Cześć Mateusz Kwiatkowski,

Zostałeś zaproszony do zespołu wydarzenia:

┌────────────────────────────────────────┐
│ Wesele Kowalskich                      │
│ 📅 15.06.2026 15:00                    │
│ 📍 Dwór w Tomaszowicach               │
│ 👤 Realizator dźwięku                 │
└────────────────────────────────────────┘

📋 Twoje przypisane fazy

┌──────────────┬──────────────┬──────────────┐
│ Faza         │ Rozpoczęcie  │ Zakończenie  │
├──────────────┼──────────────┼──────────────┤
│ • Montaż     │ 15.06 12:00  │ 15.06 15:00  │
│ • Realizacja │ 15.06 15:00  │ 15.06 23:00  │
│ • Demontaż   │ 15.06 23:00  │ 16.06 02:00  │
└──────────────┴──────────────┴──────────────┘

  [✓ Akceptuję]    [✕ Odrzucam]
```

## Bezpieczeństwo

- Funkcja Edge używa `SUPABASE_SERVICE_ROLE_KEY` do pełnego dostępu
- RLS na `event_phase_assignments` kontroluje dostęp do danych faz
- Trigger `notify_employee_assignment` używa `SECURITY DEFINER`
- Tokeny zaproszeń wygasają po określonym czasie

## Kompatybilność wsteczna

- Jeśli pracownik nie ma przypisanych faz, email wysyła się bez tabeli
- Stare zaproszenia (bez faz) nadal działają
- Modal pokazuje komunikat "Brak pracowników przypisanych do faz" jeśli nie ma nikogo

## Testowanie

### Scenariusz 1: Dodanie pracownika z fazami
1. Utwórz wydarzenie
2. Dodaj fazy do wydarzenia
3. Przypisz pracownika do faz
4. Otwórz modal "Dodaj osobę do zespołu"
5. ✅ Pracownik jest widoczny na liście
6. Wybierz pracownika
7. ✅ Wyświetlają się jego fazy z godzinami
8. Dodaj do zespołu
9. ✅ Email zawiera tabelę z fazami

### Scenariusz 2: Brak pracowników w fazach
1. Utwórz wydarzenie bez faz
2. Otwórz modal "Dodaj osobę do zespołu"
3. ✅ Select pokazuje "Brak pracowników przypisanych do faz"
4. ✅ Nie można dodać nikogo

### Scenariusz 3: Pracownik już w zespole
1. Dodaj pracownika do zespołu
2. Otwórz modal ponownie
3. ✅ Ten pracownik nie jest widoczny na liście
