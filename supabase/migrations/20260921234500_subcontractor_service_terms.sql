BEGIN;
ALTER TABLE public.subcontractor_service_catalog
 ADD COLUMN included_hours numeric(10,2) CHECK (included_hours >= 0 AND included_hours <> 'NaN'::numeric),
 ADD COLUMN overtime_hourly_rate numeric(10,2) CHECK (overtime_hourly_rate >= 0 AND overtime_hourly_rate <> 'NaN'::numeric),
 ADD COLUMN travel_rate_per_km numeric(10,2) CHECK (travel_rate_per_km >= 0 AND travel_rate_per_km <> 'NaN'::numeric),
 ADD COLUMN performance_requirements text;
-- Preserve old labels as real services without inventing their prices.
INSERT INTO public.subcontractor_service_catalog(subcontractor_id,name,unit,unit_price)
SELECT DISTINCT s.id,btrim(label),'realizacja',NULL::numeric
FROM public.subcontractors s CROSS JOIN LATERAL unnest(s.specialization) label
WHERE btrim(label)<>'' AND NOT EXISTS (
 SELECT 1 FROM public.subcontractor_service_catalog c WHERE c.subcontractor_id=s.id AND lower(btrim(c.name))=lower(btrim(label))
);
INSERT INTO public.subcontractor_services(subcontractor_id,service_type,is_active)
SELECT id,'services',true FROM public.subcontractors ON CONFLICT(subcontractor_id,service_type) DO NOTHING;
CREATE FUNCTION public.initialize_subcontractor_service_catalog() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.subcontractor_services(subcontractor_id,service_type,is_active) VALUES(NEW.id,'services',true) ON CONFLICT(subcontractor_id,service_type) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.initialize_subcontractor_service_catalog() FROM PUBLIC;
CREATE TRIGGER initialize_subcontractor_service_catalog AFTER INSERT ON public.subcontractors FOR EACH ROW EXECUTE FUNCTION public.initialize_subcontractor_service_catalog();
NOTIFY pgrst,'reload schema';
COMMIT;
