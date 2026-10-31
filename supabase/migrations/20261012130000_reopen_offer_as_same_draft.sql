BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.offer_draft_revisions (
 offer_id uuid PRIMARY KEY REFERENCES public.offers(id) ON DELETE CASCADE,
 original_snapshot jsonb NOT NULL,
 opened_by uuid REFERENCES public.employees(id),
 opened_at timestamptz NOT NULL DEFAULT now(),
 saved_revision integer,
 saved_at timestamptz
);
ALTER TABLE public.offer_draft_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offer_draft_revisions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.offer_draft_revisions TO authenticated;
CREATE POLICY offer_draft_revisions_read ON public.offer_draft_revisions FOR SELECT TO authenticated USING(public.sales_can_manage_offer(offer_id));

CREATE FUNCTION public.snapshot_offer_draft_revision(p_offer uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('offer',to_jsonb(o),
  'items',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.display_order,i.id),'[]'::jsonb) FROM public.offer_items i WHERE i.offer_id=o.id),
  'packages',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM public.offer_packages p WHERE p.offer_id=o.id),
  'package_items',(SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) FROM public.offer_package_items i JOIN public.offer_packages p ON p.id=i.package_id WHERE p.offer_id=o.id))
 FROM public.offers o WHERE o.id=p_offer;
$$;
REVOKE ALL ON FUNCTION public.snapshot_offer_draft_revision(uuid) FROM PUBLIC,anon,authenticated;

-- Preserve the previously accepted reservation while reopening the same document.
DO $migration$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.handle_offer_status_change()'::regprocedure);
 definition:=regexp_replace(definition,'BEGIN',$guard$BEGIN
 IF TG_OP='UPDATE' AND current_setting('mavinci.reopening_offer',true)=NEW.id::text THEN RETURN NEW; END IF;
$guard$);
 EXECUTE definition;
END;
$migration$;

CREATE FUNCTION public.reopen_accepted_offer_draft(p_offer uuid,p_expected_revision integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.offers; actor uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.sales_can_manage_offer(p_offer) THEN RAISE EXCEPTION 'Brak uprawnień do edycji oferty'; END IF;
 SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer FOR UPDATE;
 IF o.status<>'accepted' OR o.sales_channel='seller_portal' THEN RAISE EXCEPTION 'Wybierz zaakceptowaną ofertę CRM'; END IF;
 IF p_expected_revision IS NULL OR o.content_revision<>p_expected_revision THEN RAISE EXCEPTION 'Oferta uległa zmianie. Odśwież dane.'; END IF;
 actor:=public.sales_employee_id();
 IF actor IS NULL THEN RAISE EXCEPTION 'Brak profilu pracownika'; END IF;
 INSERT INTO public.offer_draft_revisions(offer_id,original_snapshot,opened_by)
 VALUES(p_offer,public.snapshot_offer_draft_revision(p_offer),actor)
 ON CONFLICT(offer_id) DO UPDATE SET original_snapshot=EXCLUDED.original_snapshot,opened_by=actor,opened_at=now(),saved_revision=NULL,saved_at=NULL;
 PERFORM set_config('mavinci.sales_decision','yes',true);
 PERFORM set_config('mavinci.reopening_offer',p_offer::text,true);
 UPDATE public.offers SET status='draft',modified_after_generation=true,updated_at=now() WHERE id=p_offer;
 INSERT INTO public.offer_history(offer_id,changed_by,change_type,change_description,old_values,new_values)
 VALUES(p_offer,actor,'status_changed','Otwarto zaakceptowaną ofertę jako szkic do aktualizacji.',jsonb_build_object('status','accepted'),jsonb_build_object('status','draft'));
 PERFORM set_config('mavinci.reopening_offer','',true);
 PERFORM set_config('mavinci.sales_decision','',true);
END;
$$;
REVOKE ALL ON FUNCTION public.reopen_accepted_offer_draft(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reopen_accepted_offer_draft(uuid,integer) TO authenticated;

CREATE FUNCTION public.save_offer_draft_revision(p_offer uuid,p_expected_revision integer,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.offers; revision public.offer_draft_revisions; snapshot jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.sales_can_manage_offer(p_offer) THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
 SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer FOR UPDATE;
 SELECT * INTO STRICT revision FROM public.offer_draft_revisions WHERE offer_id=p_offer FOR UPDATE;
 IF o.status<>'draft' THEN RAISE EXCEPTION 'Zapisz aktualizację w szkicu'; END IF;
 IF p_expected_revision IS NULL OR o.content_revision<>p_expected_revision THEN RAISE EXCEPTION 'Oferta uległa zmianie. Odśwież dane.'; END IF;
 IF length(trim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'Podaj powód aktualizacji (3–2000 znaków)'; END IF;
 IF revision.saved_revision=o.content_revision THEN RAISE EXCEPTION 'Ta aktualizacja została już zapisana'; END IF;
 snapshot:=public.snapshot_offer_draft_revision(p_offer);
 INSERT INTO public.offer_history(offer_id,changed_by,change_type,change_description,old_values,new_values)
 VALUES(p_offer,public.sales_employee_id(),'updated','Aktualizacja wcześniej zaakceptowanej oferty: '||trim(p_reason),revision.original_snapshot,snapshot||jsonb_build_object('in_place_update',true,'reason',trim(p_reason)));
 UPDATE public.offer_draft_revisions SET saved_revision=o.content_revision,saved_at=now(),original_snapshot=snapshot WHERE offer_id=p_offer;
END;
$$;
REVOKE ALL ON FUNCTION public.save_offer_draft_revision(uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_offer_draft_revision(uuid,integer,text) TO authenticated;

CREATE FUNCTION public.require_offer_revision_reason() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status IN ('sent','accepted') AND NEW.status IS DISTINCT FROM OLD.status AND EXISTS(
  SELECT 1 FROM public.offer_draft_revisions r WHERE r.offer_id=NEW.id AND r.saved_revision IS DISTINCT FROM NEW.content_revision
 ) THEN RAISE EXCEPTION 'Najpierw wybierz Zapisz aktualizację i podaj powód zmian.'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.require_offer_revision_reason() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zz_require_offer_revision_reason BEFORE UPDATE ON public.offers FOR EACH ROW EXECUTE FUNCTION public.require_offer_revision_reason();
NOTIFY pgrst,'reload schema';
COMMIT;
