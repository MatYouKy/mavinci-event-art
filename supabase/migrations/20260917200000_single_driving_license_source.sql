BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.vehicle_driver_problem(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid,uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Najpierw uruchom migracje 20260917150000_validate_vehicle_drivers i 20260917151000_vehicle_driver_schema_compatibility.';
  END IF;
END $$;

-- Preview only. Reservation checks still use eligible_event_vehicle_drivers
-- and the existing write triggers over the entire pickup/return interval.
-- No category hierarchy is inferred, and certificates never grant licences.
CREATE OR REPLACE FUNCTION public.qualified_vehicle_drivers(
  p_vehicle_id uuid, p_date date, p_trailer_id uuid DEFAULT NULL,
  p_external_trailer boolean DEFAULT false
)
RETURNS TABLE(id uuid,name text,surname text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE problem text;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(public.current_session_is_seller_portal(),true)
    OR NOT EXISTS(SELECT 1 FROM public.employees e
      WHERE (e.id=auth.uid() OR e.auth_user_id=auth.uid()) AND e.is_active
        AND (e.role::text='admin' OR e.access_level::text='admin'
          OR e.permissions && ARRAY['admin','events_manage','events_view','fleet_manage','fleet_view'])) THEN
    RAISE EXCEPTION 'Brak uprawnień do sprawdzania kierowców.' USING ERRCODE='42501';
  END IF;
  IF p_date IS NULL OR NOT isfinite(p_date) THEN RAISE EXCEPTION 'Uzupełnij datę wydarzenia.'; END IF;
  problem:=public.vehicle_driver_problem(NULL,p_vehicle_id,
    p_date::timestamp AT TIME ZONE 'Europe/Warsaw',
    (p_date+1)::timestamp AT TIME ZONE 'Europe/Warsaw',NULL,p_trailer_id,p_external_trailer);
  IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem; END IF;
  RETURN QUERY SELECT e.id,e.name::text,e.surname::text FROM public.employees e
    WHERE e.is_active AND NOT EXISTS(
      SELECT 1 FROM public.vehicle_license_requirements r
      WHERE r.vehicle_id IN (p_vehicle_id,p_trailer_id) AND r.is_required
        AND NOT EXISTS(SELECT 1 FROM public.employee_driving_licenses l
          WHERE l.employee_id=e.id AND l.license_category_id=r.license_category_id
            AND (l.obtained_date IS NULL OR l.obtained_date<=p_date)
            AND (l.expiry_date IS NULL OR l.expiry_date>=p_date)))
    ORDER BY e.name,e.surname;
END;
$$;
REVOKE ALL ON FUNCTION public.qualified_vehicle_drivers(uuid,date,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.qualified_vehicle_drivers(uuid,date,uuid,boolean) TO authenticated;

-- Existing certificates remain untouched as read-only history. In particular,
-- conflicting expiry dates are not merged, extended or promoted to a licence.
-- Guard older clients too: all new/editable licences belong to the dedicated
-- table already used by fleet requirements and driver validation.
CREATE OR REPLACE FUNCTION public.require_dedicated_driving_license_record()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.certification_types t
    WHERE t.id=NEW.certification_type_id AND btrim(t.name) ~* '^prawo[[:space:]]+jazdy([[:space:]]|$)')
    OR (TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.certification_types t
      WHERE t.id=OLD.certification_type_id AND btrim(t.name) ~* '^prawo[[:space:]]+jazdy([[:space:]]|$)')) THEN
    RAISE EXCEPTION 'Prawo jazdy dodaj lub edytuj w Kwalifikacje → Prawa jazdy. Dawne certyfikaty pozostają historią.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.require_dedicated_driving_license_record() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS require_dedicated_driving_license_record ON public.employee_certifications;
CREATE TRIGGER require_dedicated_driving_license_record
  BEFORE INSERT OR UPDATE ON public.employee_certifications
  FOR EACH ROW EXECUTE FUNCTION public.require_dedicated_driving_license_record();

COMMIT;
