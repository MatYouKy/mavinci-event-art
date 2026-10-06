BEGIN;
ALTER TABLE public.event_vehicles DROP CONSTRAINT event_vehicle_independent_schedule_valid;
ALTER TABLE public.event_vehicles ADD CONSTRAINT event_vehicle_independent_schedule_valid CHECK (
 logistics_schedule IS NULL OR coalesce((
 jsonb_typeof(logistics_schedule)='object' AND (
 (logistics_schedule->>'mode'='timeline' AND vehicle_available_from IS NULL AND vehicle_available_until IS NULL)
 OR (vehicle_available_from IS NOT NULL AND vehicle_available_until > vehicle_available_from)
 )),false));

-- Runs after the legacy departure calculator. Undated estimates are not bookings.
CREATE FUNCTION public.calculate_timeline_vehicle_travel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE outbound timestamptz; inbound timestamptz; out_end timestamptz; in_end timestamptz;
  out_minutes numeric; in_minutes numeric; reserve_from timestamptz; reserve_until timestamptz;
BEGIN
 IF NEW.logistics_schedule->>'mode' IS DISTINCT FROM 'timeline' THEN RETURN NEW; END IF;
 outbound := (NEW.logistics_schedule->>'outbound_start')::timestamptz;
 inbound := (NEW.logistics_schedule->>'inbound_start')::timestamptz;
 out_minutes := (NEW.travel_plan->'outbound'->>'plannedMinutes')::numeric;
 in_minutes := (NEW.travel_plan->'inbound'->>'plannedMinutes')::numeric;
 IF outbound IS NOT NULL THEN
   IF out_minutes IS NULL OR out_minutes <= 0 THEN RAISE EXCEPTION 'Oblicz czas dojazdu w Logistyce.'; END IF;
   out_end := outbound + ceil(out_minutes/15)*interval '15 minutes';
 END IF;
 IF inbound IS NOT NULL THEN
   IF in_minutes IS NULL OR in_minutes <= 0 THEN RAISE EXCEPTION 'Oblicz czas powrotu w Logistyce.'; END IF;
   in_end := inbound + ceil(in_minutes/15)*interval '15 minutes';
 END IF;
 IF inbound IS NOT NULL AND out_end IS NOT NULL AND inbound < out_end THEN
   RAISE EXCEPTION 'Powrót nie może zaczynać się przed zakończeniem dojazdu.';
 END IF;
 reserve_from := coalesce(outbound,inbound);
 reserve_until := coalesce(in_end,out_end);
 IF reserve_from IS NOT NULL THEN
   -- Serialize reservations of the car and trailer in stable order.
   PERFORM id FROM vehicles WHERE id IN (NEW.vehicle_id,NEW.trailer_vehicle_id) ORDER BY id FOR UPDATE;
   IF EXISTS (SELECT 1 FROM event_vehicles v WHERE v.id<>NEW.id AND v.status IS DISTINCT FROM 'cancelled'
     AND NEW.status IS DISTINCT FROM 'cancelled'
     AND (v.vehicle_id=NEW.vehicle_id OR v.trailer_vehicle_id=NEW.vehicle_id
       OR (NEW.has_trailer AND NOT coalesce(NEW.is_trailer_external,false)
         AND (v.vehicle_id=NEW.trailer_vehicle_id OR v.trailer_vehicle_id=NEW.trailer_vehicle_id)))
     AND v.vehicle_available_from < reserve_until AND v.vehicle_available_until > reserve_from) THEN
     RAISE EXCEPTION 'Pojazd lub przyczepa ma już rezerwację w tym terminie.' USING ERRCODE='23514';
   END IF;
 END IF;
 NEW.departure_time:=outbound;
 NEW.arrival_time:=out_end;
 NEW.calculated_departure_time:=NULL;
 NEW.vehicle_available_from:=reserve_from;
 NEW.vehicle_available_until:=reserve_until;
 RETURN NEW;
END $$;
CREATE TRIGGER zzz_calculate_timeline_vehicle_travel BEFORE INSERT OR UPDATE ON public.event_vehicles
FOR EACH ROW EXECUTE FUNCTION public.calculate_timeline_vehicle_travel();

CREATE FUNCTION public.schedule_vehicle_travel(p_event_vehicle_id uuid,p_outbound_start timestamptz,p_inbound_start timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE schedule jsonb;
BEGIN
 SELECT coalesce(logistics_schedule,'{}'::jsonb) INTO schedule FROM event_vehicles WHERE id=p_event_vehicle_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Brak dostępu do planu pojazdu.' USING ERRCODE='42501'; END IF;
 UPDATE event_vehicles SET logistics_schedule=schedule||jsonb_build_object('mode','timeline','outbound_start',p_outbound_start,'inbound_start',p_inbound_start)
 WHERE id=p_event_vehicle_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Brak uprawnień do edycji planu.' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.schedule_vehicle_travel(uuid,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.schedule_vehicle_travel(uuid,timestamptz,timestamptz) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
