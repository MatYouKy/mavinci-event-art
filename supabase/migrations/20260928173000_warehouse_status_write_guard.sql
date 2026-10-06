CREATE OR REPLACE FUNCTION public.guard_warehouse_event_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 IF NEW.status::text NOT IN ('in_preparation','ready_for_live') THEN RETURN NEW; END IF;
 -- Internal background jobs remain unchanged; authenticated writes, including RPCs,
 -- must originate from a warehouse manager or administrator of this company.
 IF auth.role()='authenticated' AND NOT EXISTS (
  SELECT 1 FROM public.employees employee WHERE employee.id=public.sales_employee_id()
   AND employee.is_active AND public.employee_can_access_company(employee.id,NEW.my_company_id)
   AND (employee.role='admin' OR employee.access_level='admin'
        OR coalesce(employee.permissions,'{}') && ARRAY['equipment_manage','admin'])
 ) THEN
  RAISE EXCEPTION 'Statusy „W przygotowaniu” i „Gotowe do realizacji” ustawia magazyn.' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_warehouse_event_status() FROM PUBLIC;
CREATE TRIGGER guard_warehouse_event_status BEFORE INSERT OR UPDATE OF status ON public.events
 FOR EACH ROW EXECUTE FUNCTION public.guard_warehouse_event_status();
