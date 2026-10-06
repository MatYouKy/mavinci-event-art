BEGIN;
SET LOCAL statement_timeout='15s';
DO $$
DECLARE v uuid; other_id uuid; car_id uuid; before_count bigint; start_time timestamptz := '2099-01-01 15:00:00+01'; result record;
BEGIN
 SELECT id INTO v FROM event_vehicles WHERE vehicle_id IS NOT NULL LIMIT 1;
 IF v IS NULL THEN RAISE EXCEPTION 'Brak pojazdu do testu'; END IF;
 SELECT count(*) INTO before_count FROM event_phases;
 UPDATE event_vehicles SET driver_id=NULL,has_trailer=false,trailer_vehicle_id=NULL,
 logistics_schedule='{"mode":"timeline"}',
 travel_plan='{"outbound":{"baseMinutes":120,"bufferMinutes":0,"breakMinutes":15,"plannedMinutes":135},"inbound":{"baseMinutes":120,"bufferMinutes":0,"breakMinutes":0,"plannedMinutes":120}}'
 WHERE id=v;
 SELECT * INTO result FROM event_vehicles WHERE id=v;
 IF result.vehicle_available_from IS NOT NULL OR result.vehicle_available_until IS NOT NULL OR result.departure_time IS NOT NULL THEN RAISE EXCEPTION 'Plan otrzymał fikcyjne daty'; END IF;
 PERFORM schedule_vehicle_travel(v,start_time,NULL);
 SELECT * INTO result FROM event_vehicles WHERE id=v;
 IF result.arrival_time <> start_time+interval '135 minutes' OR result.vehicle_available_from <> start_time THEN RAISE EXCEPTION 'Błędny koniec dojazdu'; END IF;
 BEGIN
   PERFORM schedule_vehicle_travel(v,start_time,start_time+interval '1 hour');
   RAISE EXCEPTION 'Nie zablokowano powrotu przed dojazdem' USING ERRCODE='XX001';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
 END;
 PERFORM schedule_vehicle_travel(v,start_time,start_time+interval '8 hours');
 SELECT * INTO result FROM event_vehicles WHERE id=v;
 IF result.vehicle_available_until <> start_time+interval '10 hours' THEN RAISE EXCEPTION 'Błędny koniec powrotu'; END IF;
 UPDATE event_vehicles SET travel_plan=jsonb_set(travel_plan,'{outbound,plannedMinutes}','150') WHERE id=v;
 SELECT * INTO result FROM event_vehicles WHERE id=v;
 IF result.arrival_time <> start_time+interval '150 minutes' THEN RAISE EXCEPTION 'Trasa nie przeliczyła końca'; END IF;
 SELECT vehicle_id INTO car_id FROM event_vehicles WHERE id=v;
 SELECT id INTO other_id FROM event_vehicles WHERE id<>v AND status IS DISTINCT FROM 'cancelled' LIMIT 1;
 IF other_id IS NOT NULL THEN
   BEGIN
     UPDATE event_vehicles SET vehicle_id=car_id,driver_id=NULL,has_trailer=false,trailer_vehicle_id=NULL,
       logistics_schedule=jsonb_build_object('mode','timeline','outbound_start',start_time),
       travel_plan='{"outbound":{"plannedMinutes":60}}' WHERE id=other_id;
     RAISE EXCEPTION 'Nie wykryto kolizji auta' USING ERRCODE='XX001';
   EXCEPTION WHEN check_violation THEN
     IF SQLERRM NOT LIKE 'Pojazd lub przyczepa%' THEN RAISE; END IF;
   END;
 END IF;
 IF (SELECT count(*) FROM event_phases) <> before_count THEN RAISE EXCEPTION 'Utworzono sztuczne fazy'; END IF;
END $$;
SELECT 'PASS: undated estimate, timeline start + route + break, return order, updated route, no fabricated phases';
ROLLBACK;
