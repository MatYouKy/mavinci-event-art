BEGIN;

-- Individual vehicle journeys can cover only setup or teardown, on different
-- days. Times remain in the existing availability fields so booking and driver
-- constraints use exactly the interval displayed by the modal.
ALTER TABLE public.event_vehicles ADD COLUMN IF NOT EXISTS logistics_schedule jsonb;
COMMENT ON COLUMN public.event_vehicles.logistics_schedule IS
  'Independent pickup/return stage labels. NULL retains legacy timeline synchronization. Dates use vehicle_available_from/until.';
ALTER TABLE public.event_vehicles ADD CONSTRAINT event_vehicle_independent_schedule_valid
  CHECK (logistics_schedule IS NULL OR (
    coalesce(jsonb_typeof(logistics_schedule) = 'object'
      AND jsonb_typeof(logistics_schedule->'pickup') = 'object'
      AND jsonb_typeof(logistics_schedule->'return') = 'object'
      AND length(logistics_schedule->'pickup'->>'id') > 0
      AND length(logistics_schedule->'return'->>'id') > 0, false)
    AND vehicle_available_from IS NOT NULL AND vehicle_available_until IS NOT NULL
    AND vehicle_available_until > vehicle_available_from
  ));

CREATE OR REPLACE FUNCTION public.sync_event_return_phases(target_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE anchor_time timestamptz; return_end timestamptz; route_minutes numeric;
  item record; duration interval; new_end timestamptz; boundaries jsonb := '[]'::jsonb;
BEGIN
  PERFORM 1 FROM events WHERE id=target_event FOR UPDATE;
  SELECT max(p.end_time) INTO anchor_time FROM event_phases p
    LEFT JOIN event_phase_types t ON t.id=p.phase_type_id
    WHERE p.event_id=target_event AND lower(btrim(coalesce(t.name,p.name)))='demontaż';
  IF anchor_time IS NULL THEN
    SELECT max(p.end_time) INTO anchor_time FROM event_phases p
      LEFT JOIN event_phase_types t ON t.id=p.phase_type_id
      WHERE p.event_id=target_event AND lower(btrim(coalesce(t.name,p.name)))='realizacja';
  END IF;
  IF anchor_time IS NULL THEN SELECT event_end_date INTO anchor_time FROM events WHERE id=target_event; END IF;
  IF anchor_time IS NULL THEN RETURN; END IF;
  SELECT max((v.travel_plan->'inbound'->>'plannedMinutes')::numeric) INTO route_minutes
    FROM event_vehicles v WHERE v.logistics_schedule IS NULL AND v.event_id=target_event
    AND jsonb_typeof(v.travel_plan->'inbound'->'plannedMinutes')='number'
    AND (v.travel_plan->'inbound'->>'plannedMinutes')::numeric > 0;
  FOR item IN SELECT p.* FROM event_phases p LEFT JOIN event_phase_types t ON t.id=p.phase_type_id
    WHERE p.event_id=target_event AND lower(btrim(coalesce(t.name,p.name)))='powrót' ORDER BY p.start_time,p.id LOOP
    duration := CASE WHEN route_minutes IS NOT NULL THEN (ceil(route_minutes/15)*15)*interval '1 minute'
      ELSE greatest(item.end_time-item.start_time, interval '15 minutes') END;
    new_end := anchor_time+duration;
    IF item.start_time IS DISTINCT FROM anchor_time OR item.end_time IS DISTINCT FROM new_end THEN
      UPDATE event_phases SET start_time=anchor_time,end_time=new_end WHERE id=item.id;
      boundaries := boundaries || jsonb_build_array(jsonb_build_object('old_end',item.end_time,'new_end',new_end));
    END IF;
    return_end := greatest(return_end,new_end);
  END LOOP;
  IF return_end IS NULL THEN RETURN; END IF;
  FOR item IN SELECT p.* FROM event_phases p LEFT JOIN event_phase_types t ON t.id=p.phase_type_id
    WHERE p.event_id=target_event AND lower(btrim(coalesce(t.name,p.name)))='rozładunek' ORDER BY p.start_time,p.id LOOP
    duration := greatest(item.end_time-item.start_time, interval '15 minutes');
    new_end := return_end+duration;
    IF item.start_time IS DISTINCT FROM return_end OR item.end_time IS DISTINCT FROM new_end THEN
      UPDATE event_phases SET start_time=return_end,end_time=new_end WHERE id=item.id;
      boundaries := boundaries || jsonb_build_array(jsonb_build_object('old_end',item.end_time,'new_end',new_end));
    END IF;
  END LOOP;
  UPDATE event_vehicles v SET vehicle_available_until=m.new_end
    FROM jsonb_to_recordset(boundaries) AS m(old_end timestamptz,new_end timestamptz)
    WHERE v.logistics_schedule IS NULL AND v.event_id=target_event AND v.vehicle_available_until=m.old_end;
  UPDATE event_phase_vehicles v SET assigned_end=m.new_end
    FROM jsonb_to_recordset(boundaries) AS m(old_end timestamptz,new_end timestamptz)
    WHERE v.assigned_end=m.old_end AND v.phase_id IN (SELECT id FROM event_phases WHERE event_id=target_event);
END; $$;
REVOKE ALL ON FUNCTION public.sync_event_return_phases(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.trigger_sync_event_return_phases()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF pg_trigger_depth()>1 THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='event_vehicles' THEN
    IF TG_OP='DELETE' THEN
      IF OLD.logistics_schedule IS NOT NULL THEN RETURN NULL; END IF;
    ELSE
      IF NEW.logistics_schedule IS NOT NULL THEN RETURN NULL; END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME='events' THEN
    PERFORM public.sync_event_return_phases(NEW.id);
  ELSIF TG_OP='DELETE' THEN
    PERFORM public.sync_event_return_phases(OLD.event_id);
  ELSE
    PERFORM public.sync_event_return_phases(NEW.event_id);
  END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.trigger_sync_event_return_phases() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.apply_saved_vehicle_travel_phases(
  p_event_id uuid,
  p_event_vehicle_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  booking public.event_vehicles%ROWTYPE;
  outbound_minutes numeric;
  inbound_minutes numeric;
  setup_start timestamptz;
  return_start timestamptz;
  return_end timestamptz;
  old_departure timestamptz;
  new_departure timestamptz;
  new_start timestamptz;
  new_end timestamptz;
  loading_shift interval;
  item record;
  changes jsonb := '[]'::jsonb;
  reservations jsonb := '[]'::jsonb;
  outbound_found boolean := false;
  return_found boolean := false;
  updated_count integer;
BEGIN
  IF auth.uid() IS NULL OR public.current_session_is_seller_portal() THEN
    RAISE EXCEPTION 'Brak uprawnień do zmiany faz logistyki.' USING ERRCODE = '42501';
  END IF;
  -- Lock only the event explicitly selected by the caller, subject to RLS.
  PERFORM 1 FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Brak dostępu do wydarzenia.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO booking FROM public.event_vehicles
    WHERE id = p_event_vehicle_id AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND OR booking.status = 'cancelled' THEN
    RAISE EXCEPTION 'Nie znaleziono aktywnego przypisania pojazdu do tego wydarzenia.';
  END IF;
  IF booking.logistics_schedule IS NOT NULL THEN
    RETURN jsonb_build_object('updated_phases', 0, 'independent_schedule', true);
  END IF;
  IF booking.travel_plan IS NULL THEN
    RAISE EXCEPTION 'Brak zapisanej trasy pojazdu. Oblicz trasę i zapisz logistykę ponownie.';
  END IF;

  -- Shared phases use the longest saved route for this event, separately for
  -- each direction, consistently with the existing return-phase synchronizer.
  SELECT
    max(CASE WHEN jsonb_typeof(v.travel_plan->'outbound'->'plannedMinutes') = 'number'
      THEN (v.travel_plan->'outbound'->>'plannedMinutes')::numeric END),
    max(CASE WHEN jsonb_typeof(v.travel_plan->'inbound'->'plannedMinutes') = 'number'
      THEN (v.travel_plan->'inbound'->>'plannedMinutes')::numeric END)
  INTO outbound_minutes, inbound_minutes
  FROM public.event_vehicles v WHERE v.logistics_schedule IS NULL AND v.event_id = p_event_id;
  IF outbound_minutes IS NULL OR outbound_minutes <= 0 THEN
    RAISE EXCEPTION 'Zapisana trasa nie zawiera poprawnego czasu dojazdu. Oblicz ją ponownie.';
  END IF;

  SELECT min(p.start_time) INTO setup_start
  FROM public.event_phases p LEFT JOIN public.event_phase_types t ON t.id = p.phase_type_id
  WHERE p.event_id = p_event_id AND lower(btrim(coalesce(t.name, p.name))) = 'montaż';

  FOR item IN
    SELECT p.* FROM public.event_phases p
    LEFT JOIN public.event_phase_types t ON t.id = p.phase_type_id
    WHERE p.event_id = p_event_id AND lower(btrim(coalesce(t.name, p.name))) = 'dojazd'
    ORDER BY p.start_time, p.id
  LOOP
    outbound_found := true;
    -- Never move setup or realization to make room for the journey.
    new_end := coalesce(setup_start, item.end_time);
    new_start := new_end - (ceil(outbound_minutes / 15) * 15) * interval '1 minute';
    old_departure := least(old_departure, item.start_time);
    new_departure := least(new_departure, new_start);
    IF ROW(item.start_time, item.end_time) IS DISTINCT FROM ROW(new_start, new_end) THEN
      changes := changes || jsonb_build_array(jsonb_build_object(
        'id', item.id, 'old_start', item.start_time, 'old_end', item.end_time,
        'new_start', new_start, 'new_end', new_end));
    END IF;
  END LOOP;

  loading_shift := new_departure - old_departure;
  IF loading_shift IS NOT NULL AND loading_shift <> interval '0' THEN
    FOR item IN
      SELECT p.* FROM public.event_phases p
      LEFT JOIN public.event_phase_types t ON t.id = p.phase_type_id
      WHERE p.event_id = p_event_id AND lower(btrim(coalesce(t.name, p.name))) = 'załadunek'
        AND p.end_time <= old_departure
    LOOP
      -- Only loading preceding this departure follows it; retain duration/gap.
      changes := changes || jsonb_build_array(jsonb_build_object(
        'id', item.id, 'old_start', item.start_time, 'old_end', item.end_time,
        'new_start', item.start_time + loading_shift, 'new_end', item.end_time + loading_shift));
    END LOOP;
  END IF;

  SELECT max(p.end_time) INTO return_start
  FROM public.event_phases p LEFT JOIN public.event_phase_types t ON t.id = p.phase_type_id
  WHERE p.event_id = p_event_id AND lower(btrim(coalesce(t.name, p.name))) = 'demontaż';
  IF return_start IS NULL THEN
    SELECT max(p.end_time) INTO return_start
    FROM public.event_phases p LEFT JOIN public.event_phase_types t ON t.id = p.phase_type_id
    WHERE p.event_id = p_event_id AND lower(btrim(coalesce(t.name, p.name))) = 'realizacja';
  END IF;
  IF return_start IS NULL THEN
    SELECT event_end_date INTO return_start FROM public.events WHERE id = p_event_id;
  END IF;

  FOR item IN
    SELECT p.* FROM public.event_phases p
    LEFT JOIN public.event_phase_types t ON t.id = p.phase_type_id
    WHERE p.event_id = p_event_id AND lower(btrim(coalesce(t.name, p.name))) = 'powrót'
    ORDER BY p.start_time, p.id
  LOOP
    return_found := true;
    -- Do not invent a return journey for a one-way calculation.
    IF inbound_minutes IS NULL OR inbound_minutes <= 0 THEN CONTINUE; END IF;
    new_start := coalesce(return_start, item.start_time);
    new_end := new_start + (ceil(inbound_minutes / 15) * 15) * interval '1 minute';
    return_end := greatest(return_end, new_end);
    IF ROW(item.start_time, item.end_time) IS DISTINCT FROM ROW(new_start, new_end) THEN
      changes := changes || jsonb_build_array(jsonb_build_object(
        'id', item.id, 'old_start', item.start_time, 'old_end', item.end_time,
        'new_start', new_start, 'new_end', new_end));
    END IF;
  END LOOP;

  IF return_end IS NOT NULL THEN
    FOR item IN
      SELECT p.* FROM public.event_phases p
      LEFT JOIN public.event_phase_types t ON t.id = p.phase_type_id
      WHERE p.event_id = p_event_id AND lower(btrim(coalesce(t.name, p.name))) = 'rozładunek'
    LOOP
      new_start := return_end;
      new_end := new_start + (item.end_time - item.start_time);
      IF ROW(item.start_time, item.end_time) IS DISTINCT FROM ROW(new_start, new_end) THEN
        changes := changes || jsonb_build_array(jsonb_build_object(
          'id', item.id, 'old_start', item.start_time, 'old_end', item.end_time,
          'new_start', new_start, 'new_end', new_end));
      END IF;
    END LOOP;
  END IF;

  IF jsonb_array_length(changes) > 0 THEN
    -- Snapshot before assignment triggers expand reservations. Custom times
    -- unrelated to changed phase boundaries and actual handovers stay intact.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id,
      'new_start', coalesce(m.new_start, v.vehicle_available_from),
      'new_end', coalesce(m.new_end, v.vehicle_available_until),
      'departure_time', coalesce(m.departure_time, v.departure_time)
    )), '[]'::jsonb) INTO reservations
    FROM public.event_vehicles v
    CROSS JOIN LATERAL (
      SELECT
        min(c.new_start) FILTER (WHERE c.old_start = v.vehicle_available_from) AS new_start,
        max(c.new_end) FILTER (WHERE c.old_end = v.vehicle_available_until) AS new_end,
        min(c.new_start) FILTER (WHERE c.old_start = v.departure_time) AS departure_time
      FROM jsonb_to_recordset(changes) AS c(
        id uuid, old_start timestamptz, old_end timestamptz, new_start timestamptz, new_end timestamptz)
    ) m
    WHERE v.logistics_schedule IS NULL AND v.event_id = p_event_id AND v.status IS DISTINCT FROM 'cancelled'
      AND (m.new_start IS NOT NULL OR m.new_end IS NOT NULL OR m.departure_time IS NOT NULL);

    UPDATE public.event_phases p SET start_time = c.new_start, end_time = c.new_end
    FROM jsonb_to_recordset(changes) AS c(id uuid, new_start timestamptz, new_end timestamptz)
    WHERE p.id = c.id AND p.event_id = p_event_id;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    IF updated_count <> jsonb_array_length(changes) THEN
      RAISE EXCEPTION 'Brak uprawnień do aktualizacji wszystkich faz wydarzenia.' USING ERRCODE = '42501';
    END IF;

    WITH mapped AS (
      SELECT a.id,
        coalesce(min(c.new_start) FILTER (WHERE c.old_start = a.assigned_start), a.assigned_start) AS new_start,
        coalesce(max(c.new_end) FILTER (WHERE c.old_end = a.assigned_end), a.assigned_end) AS new_end
      FROM public.event_phase_vehicles a
      JOIN public.event_phases p ON p.id = a.phase_id AND p.event_id = p_event_id
      CROSS JOIN jsonb_to_recordset(changes) AS c(
        id uuid, old_start timestamptz, old_end timestamptz, new_start timestamptz, new_end timestamptz)
      GROUP BY a.id, a.assigned_start, a.assigned_end
    )
    UPDATE public.event_phase_vehicles a SET assigned_start = m.new_start, assigned_end = m.new_end
    FROM mapped m WHERE a.id = m.id
      AND ROW(a.assigned_start, a.assigned_end) IS DISTINCT FROM ROW(m.new_start, m.new_end);

    -- Driver qualification/conflict triggers remain enabled. An error rolls
    -- back this entire phase/reservation synchronization, not just its last step.
    UPDATE public.event_vehicles v
    SET vehicle_available_from = r.new_start, vehicle_available_until = r.new_end,
        departure_time = r.departure_time
    FROM jsonb_to_recordset(reservations) AS r(
      id uuid, new_start timestamptz, new_end timestamptz, departure_time timestamptz)
    WHERE v.id = r.id AND v.event_id = p_event_id;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    IF updated_count <> jsonb_array_length(reservations) THEN
      RAISE EXCEPTION 'Brak uprawnień do aktualizacji powiązanych rezerwacji pojazdów.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'updated_phases', jsonb_array_length(changes),
    'has_outbound_phase', outbound_found,
    'has_return_phase', return_found);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_saved_vehicle_travel_phases(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_saved_vehicle_travel_phases(uuid, uuid) TO authenticated;


-- The legacy fleet synchronizer assigned every vehicle to every event phase.
-- Independent bookings must not acquire these timeline mirrors. Conversion of
-- an existing booking removes its old mirrors inside the same transaction.
CREATE OR REPLACE FUNCTION public.sync_event_vehicle_to_phases(p_event_vehicle_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_ev public.event_vehicles%ROWTYPE;
BEGIN
  SELECT * INTO v_ev FROM public.event_vehicles WHERE id=p_event_vehicle_id;
  IF v_ev.id IS NULL THEN RAISE EXCEPTION 'event_vehicle not found: %', p_event_vehicle_id; END IF;
  IF v_ev.vehicle_id IS NULL THEN RETURN; END IF;
  IF v_ev.logistics_schedule IS NOT NULL THEN
    DELETE FROM public.event_phase_vehicles a USING public.event_phases p
      WHERE a.phase_id=p.id AND p.event_id=v_ev.event_id AND a.vehicle_id=v_ev.vehicle_id;
    RETURN;
  END IF;
  INSERT INTO public.event_phase_vehicles
    (phase_id,vehicle_id,assigned_start,assigned_end,driver_id,purpose,notes)
  SELECT p.id,v_ev.vehicle_id,p.start_time,p.end_time,v_ev.driver_id,v_ev.role,v_ev.notes
    FROM public.event_phases p WHERE p.event_id=v_ev.event_id
  ON CONFLICT (phase_id,vehicle_id) DO UPDATE SET
    assigned_start=excluded.assigned_start,assigned_end=excluded.assigned_end,
    driver_id=excluded.driver_id,purpose=excluded.purpose,notes=excluded.notes;
END; $$;
CREATE OR REPLACE TRIGGER sync_event_vehicle_to_phases
  AFTER INSERT OR UPDATE OF vehicle_id,driver_id,role,notes,logistics_schedule
  ON public.event_vehicles FOR EACH ROW EXECUTE FUNCTION public.trg_sync_event_vehicle();

NOTIFY pgrst, 'reload schema';
COMMIT;
