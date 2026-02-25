/*
  # Fix Phase Work Times - Make Nullable

  ## Problem
  - phase_work_start i phase_work_end są NOT NULL
  - Przy przypisywaniu pracownika do całego wydarzenia nie znamy dokładnych godzin pracy
  - Błąd PostgreSQL 23502: "null value violates not-null constraint"

  ## Rozwiązanie
  - Zmiana phase_work_start na NULLABLE
  - Zmiana phase_work_end na NULLABLE
  - Usunięcie constraint sprawdzającego te kolumny (będzie NULL gdy nie określono)

  ## Zastosowanie
  - Przypisanie do całego wydarzenia: phase_work_start/end = NULL
  - Przypisanie ze szczegółami: phase_work_start/end = konkretne daty
*/

-- Usuń stary constraint
ALTER TABLE event_phase_assignments
  DROP CONSTRAINT IF EXISTS valid_assignment_times;

-- Zmień kolumny na nullable
ALTER TABLE event_phase_assignments
  ALTER COLUMN phase_work_start DROP NOT NULL,
  ALTER COLUMN phase_work_end DROP NOT NULL;

-- Dodaj nowy constraint (opcjonalny - sprawdza tylko gdy są wartości)
ALTER TABLE event_phase_assignments
  ADD CONSTRAINT valid_assignment_times CHECK (
    assignment_end > assignment_start
    AND (
      -- Jeśli phase_work jest ustawiony, musi być poprawny
      (phase_work_start IS NULL AND phase_work_end IS NULL)
      OR (
        phase_work_start IS NOT NULL
        AND phase_work_end IS NOT NULL
        AND phase_work_end > phase_work_start
        AND phase_work_start >= assignment_start
        AND phase_work_end <= assignment_end
      )
    )
  );

-- Utwórz indeks dla szybszego wyszukiwania przypisań z konkretnymi godzinami
CREATE INDEX IF NOT EXISTS idx_phase_assignments_work_time
  ON event_phase_assignments(phase_work_start, phase_work_end)
  WHERE phase_work_start IS NOT NULL;