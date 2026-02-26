/*
  # Usunięcie Duplikatów Przypisań Pojazdów do Faz

  ## Opis
  Przed zmianą systemu, pojazdy były przypisywane osobno do każdej fazy logistycznej
  (Załadunek, Dojazd, Powrót, Rozładunek). Teraz pojazd jest przypisywany raz do fazy
  "Załadunek" z zakresem obejmującym cały event.

  Ta migracja usuwa duplikaty i pozostawia tylko jedno przypisanie na pojazd dla całego wydarzenia.

  ## Zmiany
  1. Dla każdego pojazdu w event_phase_vehicles:
     - Znajdź wszystkie przypisania tego samego vehicle_id w ramach tego samego eventu
     - Jeśli jest więcej niż jedno przypisanie:
       - Zachowaj tylko to z najwcześniejszym assigned_start i najpóźniejszym assigned_end
       - Usuń pozostałe duplikaty
*/

DO $$
DECLARE
  v_record RECORD;
  v_earliest_start TIMESTAMPTZ;
  v_latest_end TIMESTAMPTZ;
  v_phase_id UUID;
  v_event_id UUID;
  v_kept_id UUID;
BEGIN
  -- Dla każdej kombinacji (vehicle_id, event_id) która ma więcej niż jedno przypisanie
  FOR v_record IN
    SELECT
      epv.vehicle_id,
      ep.event_id,
      MIN(epv.assigned_start) as earliest_start,
      MAX(epv.assigned_end) as latest_end,
      COUNT(*) as assignment_count
    FROM event_phase_vehicles epv
    JOIN event_phases ep ON ep.id = epv.phase_id
    WHERE epv.vehicle_id IS NOT NULL
    GROUP BY epv.vehicle_id, ep.event_id
    HAVING COUNT(*) > 1
  LOOP
    v_event_id := v_record.event_id;
    v_earliest_start := v_record.earliest_start;
    v_latest_end := v_record.latest_end;

    -- Znajdź fazę "Załadunek" dla tego wydarzenia
    SELECT ep.id INTO v_phase_id
    FROM event_phases ep
    WHERE ep.event_id = v_event_id
      AND ep.name = 'Załadunek'
    LIMIT 1;

    -- Jeśli nie ma fazy Załadunek, użyj pierwszej fazy (najwcześniejszej)
    IF v_phase_id IS NULL THEN
      SELECT ep.id INTO v_phase_id
      FROM event_phases ep
      WHERE ep.event_id = v_event_id
      ORDER BY ep.start_time ASC
      LIMIT 1;
    END IF;

    -- Jeśli znaleziono fazę
    IF v_phase_id IS NOT NULL THEN
      -- Sprawdź czy już istnieje przypisanie z pełnym zakresem
      SELECT epv.id INTO v_kept_id
      FROM event_phase_vehicles epv
      WHERE epv.vehicle_id = v_record.vehicle_id
        AND epv.phase_id = v_phase_id
        AND epv.assigned_start = v_earliest_start
        AND epv.assigned_end = v_latest_end
      LIMIT 1;

      -- Jeśli nie istnieje - utwórz jedno zbiorowe przypisanie
      IF v_kept_id IS NULL THEN
        -- Znajdź pierwsze istniejące przypisanie aby skopiować driver_id i inne pola
        INSERT INTO event_phase_vehicles (
          phase_id,
          vehicle_id,
          assigned_start,
          assigned_end,
          driver_id,
          purpose,
          notes
        )
        SELECT
          v_phase_id,
          v_record.vehicle_id,
          v_earliest_start,
          v_latest_end,
          epv.driver_id,
          'Pojazd przypisany do całego wydarzenia (załadunek → rozładunek)',
          'Automatycznie skonsolidowane z wielu przypisań'
        FROM event_phase_vehicles epv
        JOIN event_phases ep ON ep.id = epv.phase_id
        WHERE epv.vehicle_id = v_record.vehicle_id
          AND ep.event_id = v_event_id
        LIMIT 1
        ON CONFLICT (phase_id, vehicle_id) DO UPDATE
        SET
          assigned_start = EXCLUDED.assigned_start,
          assigned_end = EXCLUDED.assigned_end,
          purpose = EXCLUDED.purpose,
          notes = EXCLUDED.notes
        RETURNING id INTO v_kept_id;
      END IF;

      -- Usuń wszystkie inne przypisania tego pojazdu dla tego wydarzenia
      DELETE FROM event_phase_vehicles epv
      USING event_phases ep
      WHERE epv.phase_id = ep.id
        AND epv.vehicle_id = v_record.vehicle_id
        AND ep.event_id = v_event_id
        AND epv.id != v_kept_id;

      RAISE NOTICE 'Skonsolidowano % przypisań pojazdu % dla wydarzenia % do jednego przypisania',
        v_record.assignment_count, v_record.vehicle_id, v_event_id;
    END IF;
  END LOOP;
END $$;
