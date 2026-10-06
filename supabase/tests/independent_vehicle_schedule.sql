BEGIN;
SET LOCAL statement_timeout='30s';
CREATE TEMP TABLE schedule_test_results(result text) ON COMMIT DROP;
DO $$
DECLARE booking public.event_vehicles%ROWTYPE; phases_before jsonb; phases_after jsonb;
  start_before timestamptz; end_before timestamptz;
BEGIN
  SELECT * INTO booking FROM public.event_vehicles
    WHERE vehicle_id IS NOT NULL AND vehicle_available_from IS NOT NULL
      AND vehicle_available_until>vehicle_available_from AND status IS DISTINCT FROM 'cancelled'
    LIMIT 1;
  IF booking.id IS NULL THEN RAISE EXCEPTION 'Missing vehicle fixture'; END IF;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO phases_before
    FROM public.event_phases p WHERE event_id=booking.event_id;
  UPDATE public.event_vehicles SET driver_id=NULL,
    logistics_schedule='{"pickup":{"id":"local:outbound","name":"Dojazd"},"return":{"id":"local:unloading","name":"Rozładunek"}}',
    travel_plan=travel_plan WHERE id=booking.id;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO phases_after
    FROM public.event_phases p WHERE event_id=booking.event_id;
  IF phases_before IS DISTINCT FROM phases_after THEN RAISE EXCEPTION 'Independent save moved timeline'; END IF;
  IF EXISTS (SELECT 1 FROM public.event_phase_vehicles a JOIN public.event_phases p ON p.id=a.phase_id
    WHERE p.event_id=booking.event_id AND a.vehicle_id=booking.vehicle_id) THEN
    RAISE EXCEPTION 'Independent vehicle assigned to shared timeline';
  END IF;
  PERFORM public.sync_event_return_phases(booking.event_id);
  SELECT vehicle_available_from,vehicle_available_until INTO start_before,end_before
    FROM public.event_vehicles WHERE id=booking.id;
  IF ROW(start_before,end_before) IS DISTINCT FROM ROW(booking.vehicle_available_from,booking.vehicle_available_until) THEN
    RAISE EXCEPTION 'Shared timeline moved independent booking';
  END IF;
  BEGIN
    UPDATE public.event_vehicles SET vehicle_available_until=vehicle_available_from WHERE id=booking.id;
    RAISE EXCEPTION 'Invalid interval accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO schedule_test_results VALUES('PASS: independent save leaves timeline unchanged; no shared phase assignments; shared synchronization preserves booking; invalid interval rejected');
END $$;
SELECT * FROM schedule_test_results;
ROLLBACK;
