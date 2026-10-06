BEGIN;
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
    FROM event_vehicles v WHERE v.event_id=target_event
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
    WHERE v.event_id=target_event AND v.vehicle_available_until=m.old_end;
  UPDATE event_phase_vehicles v SET assigned_end=m.new_end
    FROM jsonb_to_recordset(boundaries) AS m(old_end timestamptz,new_end timestamptz)
    WHERE v.assigned_end=m.old_end AND v.phase_id IN (SELECT id FROM event_phases WHERE event_id=target_event);
END; $$;
REVOKE ALL ON FUNCTION public.sync_event_return_phases(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.trigger_sync_event_return_phases()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF pg_trigger_depth()>1 THEN RETURN NULL; END IF;
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
CREATE TRIGGER sync_return_on_phase AFTER INSERT OR UPDATE OF start_time,end_time,phase_type_id OR DELETE
  ON public.event_phases FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_event_return_phases();
CREATE TRIGGER sync_return_on_vehicle AFTER INSERT OR UPDATE OF travel_plan OR DELETE
  ON public.event_vehicles FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_event_return_phases();
CREATE TRIGGER sync_return_on_event AFTER UPDATE OF event_end_date
  ON public.events FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_event_return_phases();
COMMIT;
