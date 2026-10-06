BEGIN;
-- A populated inquiry remains an audit trail. An empty inquiry can be removed.
CREATE OR REPLACE FUNCTION public.inquiry_has_work(p_inquiry uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.tasks WHERE id=p_inquiry AND
   (event_id IS NOT NULL OR linked_offer_id IS NOT NULL OR accepted_offer_id IS NOT NULL OR accepted_calculation_id IS NOT NULL))
 OR EXISTS(SELECT 1 FROM public.tasks WHERE inquiry_id=p_inquiry)
 OR EXISTS(SELECT 1 FROM public.offers WHERE inquiry_id=p_inquiry)
 OR EXISTS(SELECT 1 FROM public.event_calculations WHERE inquiry_id=p_inquiry);
$$;
REVOKE ALL ON FUNCTION public.inquiry_has_work(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.prevent_inquiry_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF OLD.is_inquiry THEN
  IF NOT coalesce(public.can_manage_inquiry(OLD.inquiry_owner_id),false) THEN
   RAISE EXCEPTION 'Brak uprawnień do usunięcia zapytania.' USING ERRCODE='42501';
  END IF;
  IF public.inquiry_has_work(OLD.id) THEN
   RAISE EXCEPTION 'Zapytanie ma powiązane dane. Użyj archiwizacji.' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN OLD;
END $$;

-- NULL mode is a read/preview. Explicit mode is checked again under a row lock.
CREATE OR REPLACE FUNCTION public.remove_inquiry(p_inquiry uuid,p_mode text DEFAULT NULL,p_reason text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.tasks; actual_mode text;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry AND is_inquiry FOR UPDATE;
 IF NOT coalesce(public.can_manage_inquiry(t.inquiry_owner_id),false) THEN
  RAISE EXCEPTION 'Brak uprawnień do usunięcia zapytania.' USING ERRCODE='42501';
 END IF;
 actual_mode := CASE WHEN public.inquiry_has_work(t.id) THEN 'archived' ELSE 'deleted' END;
 IF p_mode IS NULL THEN RETURN actual_mode; END IF;
 IF p_mode IS DISTINCT FROM actual_mode THEN
  RAISE EXCEPTION 'Powiązania zapytania zmieniły się. Ponów operację, aby potwierdzić aktualny sposób usunięcia.' USING ERRCODE='23514';
 END IF;
 IF actual_mode='archived' THEN
  PERFORM public.archive_inquiry(t.id,p_reason);
 ELSE
  -- Preserve intake decisions so an ignored source does not recreate the inquiry.
  UPDATE public.inquiry_intake_reviews SET inquiry_id=NULL,status='ignored',
    reason='Usunięto puste zapytanie',resolved_at=now() WHERE inquiry_id=t.id;
  DELETE FROM public.tasks WHERE id=t.id;
 END IF;
 RETURN actual_mode;
END $$;
REVOKE ALL ON FUNCTION public.remove_inquiry(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.remove_inquiry(uuid,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
