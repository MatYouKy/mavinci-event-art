BEGIN;
ALTER TABLE public.event_vehicles ADD COLUMN IF NOT EXISTS travel_plan jsonb;
ALTER TABLE public.event_vehicles ADD CONSTRAINT event_vehicle_travel_plan_object CHECK (travel_plan IS NULL OR (jsonb_typeof(travel_plan)='object' AND travel_plan ? 'outbound' AND jsonb_typeof(travel_plan->'outbound')='object'));
CREATE OR REPLACE FUNCTION public.clear_changed_event_travel_plans() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.location_id IS DISTINCT FROM OLD.location_id THEN
   UPDATE event_vehicles SET travel_plan=NULL WHERE event_id=NEW.id AND travel_plan IS NOT NULL;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.clear_changed_event_travel_plans() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER clear_changed_event_travel_plans AFTER UPDATE OF location_id ON public.events
FOR EACH ROW EXECUTE FUNCTION public.clear_changed_event_travel_plans();
CREATE OR REPLACE FUNCTION public.clear_changed_vehicle_travel_plan() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.travel_plan IS NOT NULL AND NEW.travel_plan->>'origin' IS DISTINCT FROM NEW.departure_location THEN
   NEW.travel_plan := NULL;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER clear_changed_vehicle_travel_plan BEFORE INSERT OR UPDATE OF departure_location,travel_plan ON public.event_vehicles
FOR EACH ROW EXECUTE FUNCTION public.clear_changed_vehicle_travel_plan();
COMMIT;
