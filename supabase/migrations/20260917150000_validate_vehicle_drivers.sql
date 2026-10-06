BEGIN;
-- Exact configured categories are authoritative; never infer vehicle weight/licence hierarchy.
CREATE OR REPLACE FUNCTION public.vehicle_driver_problem(p_driver uuid,p_vehicle uuid,p_start timestamptz,p_end timestamptz,p_exclude uuid DEFAULT NULL,p_trailer uuid DEFAULT NULL,p_external_trailer boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE excluded public.event_vehicles%ROWTYPE;
BEGIN
 IF p_start IS NULL OR p_end IS NULL OR p_end<=p_start THEN RETURN 'Wybierz poprawny termin odbioru i zwrotu pojazdu.'; END IF;
 IF p_vehicle IS NULL OR NOT EXISTS(SELECT 1 FROM public.vehicle_license_requirements r WHERE r.vehicle_id=p_vehicle AND r.is_required) THEN
  RETURN 'Uzupełnij wymagane kategorie prawa jazdy w szczegółach pojazdu we flocie.';
 END IF;
 IF p_external_trailer THEN RETURN 'Nie można potwierdzić uprawnień dla zewnętrznej przyczepy. Dodaj ją do floty i określ wymagane kategorie.'; END IF;
 IF p_trailer IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vehicle_license_requirements r WHERE r.vehicle_id=p_trailer AND r.is_required) THEN
  RETURN 'Uzupełnij wymagane kategorie prawa jazdy dla przyczepy we flocie.';
 END IF;
 IF p_driver IS NULL THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.employees e WHERE e.id=p_driver AND e.is_active) THEN RETURN 'Kierowca musi być aktywnym pracownikiem.'; END IF;
 IF EXISTS(SELECT 1 FROM public.vehicle_license_requirements r WHERE r.vehicle_id IN (p_vehicle,p_trailer) AND r.is_required AND NOT EXISTS(
  SELECT 1 FROM public.employee_driving_licenses l WHERE l.employee_id=p_driver AND l.license_category_id=r.license_category_id
  AND (l.obtained_date IS NULL OR l.obtained_date <= (p_start AT TIME ZONE 'Europe/Warsaw')::date)
  AND (l.expiry_date IS NULL OR l.expiry_date >= ((p_end-interval '1 microsecond') AT TIME ZONE 'Europe/Warsaw')::date)
 )) THEN RETURN 'Kierowca nie ma wszystkich wymaganych kategorii ważnych przez cały termin rezerwacji.'; END IF;
 SELECT * INTO excluded FROM public.event_vehicles v WHERE v.id=p_exclude;
 IF EXISTS(SELECT 1 FROM public.event_vehicles v JOIN public.events e ON e.id=v.event_id
  WHERE v.driver_id=p_driver AND v.id IS DISTINCT FROM p_exclude AND v.status IS DISTINCT FROM 'cancelled' AND e.status IS DISTINCT FROM 'cancelled'
  AND coalesce(v.vehicle_available_from,'-infinity'::timestamptz)<p_end
  AND coalesce(v.vehicle_available_until,'infinity'::timestamptz)>p_start
 ) OR EXISTS(SELECT 1 FROM public.event_phase_vehicles a JOIN public.event_phases p ON p.id=a.phase_id JOIN public.events e ON e.id=p.event_id
  WHERE a.driver_id=p_driver AND a.id IS DISTINCT FROM p_exclude AND e.status IS DISTINCT FROM 'cancelled'
  AND NOT EXISTS(SELECT 1 FROM public.event_vehicles cancelled WHERE cancelled.event_id=p.event_id AND cancelled.vehicle_id=a.vehicle_id AND cancelled.status='cancelled')
  AND NOT (p.event_id IS NOT DISTINCT FROM excluded.event_id AND a.vehicle_id IS NOT DISTINCT FROM excluded.vehicle_id)
  AND a.assigned_start<p_end AND a.assigned_end>p_start
 ) THEN RETURN 'Kierowca jest już przypisany do pojazdu w nakładającym się terminie.'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.vehicle_driver_problem(uuid,uuid,timestamptz,timestamptz,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.eligible_event_vehicle_drivers(p_vehicle_id uuid,p_start timestamptz,p_end timestamptz,p_exclude_id uuid DEFAULT NULL,p_trailer_id uuid DEFAULT NULL,p_external_trailer boolean DEFAULT false)
RETURNS TABLE(id uuid,name text,surname text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE problem text;
BEGIN
 IF public.current_session_is_seller_portal() OR NOT EXISTS(SELECT 1 FROM public.employees e
 WHERE (e.id=auth.uid() OR e.auth_user_id=auth.uid()) AND e.is_active AND
 (e.role::text='admin' OR e.access_level::text='admin' OR e.permissions && ARRAY['admin','events_manage','events_view','fleet_manage','fleet_view'])) THEN
 RAISE EXCEPTION 'Brak uprawnień do sprawdzania kierowców.' USING ERRCODE='42501'; END IF;
 problem:=public.vehicle_driver_problem(NULL,p_vehicle_id,p_start,p_end,p_exclude_id,p_trailer_id,p_external_trailer);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem; END IF;
 RETURN QUERY SELECT e.id,e.name::text,e.surname::text FROM public.employees e WHERE e.is_active AND
 public.vehicle_driver_problem(e.id,p_vehicle_id,p_start,p_end,p_exclude_id,p_trailer_id,p_external_trailer) IS NULL ORDER BY e.name,e.surname;
END $$;
REVOKE ALL ON FUNCTION public.eligible_event_vehicle_drivers(uuid,timestamptz,timestamptz,uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.eligible_event_vehicle_drivers(uuid,timestamptz,timestamptz,uuid,uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_event_vehicle_driver()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE problem text;
BEGIN
 IF NEW.driver_id IS NULL OR NEW.status='cancelled' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.driver_id,NEW.vehicle_id,NEW.vehicle_available_from,NEW.vehicle_available_until,NEW.has_trailer,NEW.trailer_vehicle_id,NEW.is_trailer_external,NEW.status)
 IS NOT DISTINCT FROM ROW(OLD.driver_id,OLD.vehicle_id,OLD.vehicle_available_from,OLD.vehicle_available_until,OLD.has_trailer,OLD.trailer_vehicle_id,OLD.is_trailer_external,OLD.status) THEN RETURN NEW; END IF;
 IF NEW.has_trailer AND NOT coalesce(NEW.is_trailer_external,false) AND NEW.trailer_vehicle_id IS NULL THEN RAISE EXCEPTION 'Wybierz przyczepę, aby sprawdzić wymagane uprawnienia.' USING ERRCODE='23514'; END IF;
 -- Serialize competing reservations for the same person. A fresh query after the lock sees committed bookings.
 PERFORM 1 FROM public.employees e WHERE e.id=NEW.driver_id FOR UPDATE;
 problem:=public.vehicle_driver_problem(NEW.driver_id,NEW.vehicle_id,NEW.vehicle_available_from,NEW.vehicle_available_until,NEW.id,
 CASE WHEN NEW.has_trailer AND NOT NEW.is_trailer_external THEN NEW.trailer_vehicle_id END,coalesce(NEW.has_trailer AND NEW.is_trailer_external,false));
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_event_vehicle_driver() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validate_event_vehicle_driver AFTER INSERT OR UPDATE ON public.event_vehicles
FOR EACH ROW EXECUTE FUNCTION public.validate_event_vehicle_driver();
-- Phase-level assignments must not bypass the same validation (including a different phase driver).
CREATE OR REPLACE FUNCTION public.validate_phase_vehicle_driver()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE booking public.event_vehicles%ROWTYPE; problem text;
BEGIN
 IF NEW.driver_id IS NULL THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.employees e WHERE e.id=NEW.driver_id FOR UPDATE;
 SELECT v.* INTO booking FROM public.event_vehicles v JOIN public.event_phases p ON p.event_id=v.event_id
 WHERE p.id=NEW.phase_id AND v.vehicle_id=NEW.vehicle_id;
 problem:=public.vehicle_driver_problem(NEW.driver_id,NEW.vehicle_id,NEW.assigned_start,NEW.assigned_end,coalesce(booking.id,NEW.id),
 CASE WHEN booking.has_trailer AND NOT booking.is_trailer_external THEN booking.trailer_vehicle_id END,
 coalesce(booking.has_trailer AND booking.is_trailer_external,false));
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_phase_vehicle_driver() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zz_validate_phase_vehicle_driver AFTER INSERT OR UPDATE OF driver_id,vehicle_id,assigned_start,assigned_end,phase_id
ON public.event_phase_vehicles FOR EACH ROW EXECUTE FUNCTION public.validate_phase_vehicle_driver();
COMMIT;
