BEGIN;
CREATE TABLE public.personnel_services (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 person_id uuid NOT NULL REFERENCES public.personnel_people(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(btrim(name))>0),
 category text NOT NULL DEFAULT '',
 price numeric CHECK(price>=0 AND price< 'Infinity'::numeric),
 billing_unit text NOT NULL DEFAULT 'event' CHECK(billing_unit IN ('event','hour')),
 included_hours numeric CHECK(included_hours>=0 AND included_hours<'Infinity'::numeric),
 overtime_hourly_rate numeric CHECK(overtime_hourly_rate>=0 AND overtime_hourly_rate<'Infinity'::numeric),
 travel_rate_per_km numeric CHECK(travel_rate_per_km>=0 AND travel_rate_per_km<'Infinity'::numeric),
 performance_requirements text,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.personnel_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY personnel_services_read ON public.personnel_services FOR SELECT TO authenticated USING(public.personnel_can_access());
CREATE POLICY personnel_services_manage ON public.personnel_services FOR ALL TO authenticated USING(public.personnel_can_access(true)) WITH CHECK(public.personnel_can_access(true));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.personnel_services TO authenticated;
CREATE FUNCTION public.delete_personnel_collaborator(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.personnel_people;
BEGIN
 IF NOT public.personnel_can_access(true) THEN RAISE EXCEPTION 'Brak uprawnień do usuwania współpracowników.' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.personnel_people WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono współpracownika.'; END IF;
 IF p.employee_id IS NOT NULL OR p.subcontractor_id IS NOT NULL THEN RAISE EXCEPTION 'Ta kartoteka jest powiązana z pracownikiem lub podwykonawcą. Zakończ współpracę przez edycję statusu.'; END IF;
 DELETE FROM public.personnel_people WHERE id=p_id;
EXCEPTION WHEN foreign_key_violation THEN RAISE EXCEPTION 'Osoba ma powiązane umowy lub rozliczenia. Zachowaj historię i oznacz współpracę jako nieaktywną w edycji danych.';
END $$;
REVOKE ALL ON FUNCTION public.delete_personnel_collaborator(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_personnel_collaborator(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
