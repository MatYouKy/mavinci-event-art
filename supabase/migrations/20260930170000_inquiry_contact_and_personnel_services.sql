BEGIN;
ALTER TABLE public.offer_products ADD COLUMN IF NOT EXISTS is_personnel_service boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.offer_products.is_personnel_service IS 'Usługa personelu: człowiek i umiejętności, bez przypisanego sprzętu. Dostępna w sekcji Ludzie kalkulacji.';

CREATE FUNCTION public.guard_personnel_service_equipment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='offer_products' THEN
   IF NEW.is_personnel_service AND EXISTS (SELECT 1 FROM public.offer_product_equipment WHERE product_id=NEW.id) THEN
     RAISE EXCEPTION 'Usługa personelu nie może zawierać sprzętu. Usuń sprzęt przypisany do produktu i jego wariantów.';
   END IF;
 ELSE
   -- Serialize adding equipment with changing the personnel-only flag.
   PERFORM 1 FROM public.offer_products WHERE id=NEW.product_id FOR UPDATE;
   IF EXISTS (SELECT 1 FROM public.offer_products WHERE id=NEW.product_id AND is_personnel_service) THEN
     RAISE EXCEPTION 'Ten produkt jest usługą personelu bez sprzętu. Zmień rodzaj produktu przed dodaniem sprzętu.';
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_personnel_service_equipment() FROM PUBLIC;
CREATE TRIGGER guard_personnel_service_product BEFORE INSERT OR UPDATE OF is_personnel_service ON public.offer_products
 FOR EACH ROW EXECUTE FUNCTION public.guard_personnel_service_equipment();
CREATE TRIGGER guard_personnel_service_equipment BEFORE INSERT OR UPDATE ON public.offer_product_equipment
 FOR EACH ROW EXECUTE FUNCTION public.guard_personnel_service_equipment();

CREATE FUNCTION public.mark_inquiry_contacted(p_inquiry uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tasks;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry AND is_inquiry FOR UPDATE;
 IF NOT public.can_manage_inquiry(t.inquiry_owner_id) OR t.archived_at IS NOT NULL THEN
   RAISE EXCEPTION 'Brak uprawnień do oznaczenia kontaktu';
 END IF;
 UPDATE public.tasks SET last_contact_at=now(), updated_at=now(),
   inquiry_stage=CASE WHEN inquiry_stage='new' THEN 'contacted' ELSE inquiry_stage END
 WHERE id=t.id RETURNING * INTO t;
 PERFORM public.sales_log(t.id,'contact','Ręcznie oznaczono kontakt jako podjęty');
 RETURN jsonb_build_object('last_contact_at',t.last_contact_at,'inquiry_stage',t.inquiry_stage,'updated_at',t.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.mark_inquiry_contacted(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mark_inquiry_contacted(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
