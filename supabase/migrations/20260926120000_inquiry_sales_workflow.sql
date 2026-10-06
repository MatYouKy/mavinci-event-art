-- Sales workspace: independent proposals, immutable pricing snapshots and explicit decisions.
BEGIN;
ALTER TABLE public.tasks
 ADD COLUMN IF NOT EXISTS archived_at timestamptz,
 ADD COLUMN IF NOT EXISTS accepted_offer_id uuid REFERENCES public.offers(id) ON DELETE RESTRICT,
 ADD COLUMN IF NOT EXISTS accepted_calculation_id uuid REFERENCES public.event_calculations(id) ON DELETE RESTRICT,
 ADD COLUMN IF NOT EXISTS brief_revision integer NOT NULL DEFAULT 1;
ALTER TABLE public.event_calculations
 ADD COLUMN IF NOT EXISTS content_revision integer NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS generated_pdf_revision integer,
 ADD COLUMN IF NOT EXISTS copied_from_id uuid REFERENCES public.event_calculations(id) ON DELETE SET NULL;
ALTER TABLE public.offers
 ADD COLUMN IF NOT EXISTS content_revision integer NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS generated_pdf_revision integer,
 ADD COLUMN IF NOT EXISTS pricing_source text NOT NULL DEFAULT 'offer' CHECK(pricing_source IN ('offer','calculation')),
 ADD COLUMN IF NOT EXISTS source_calculation_id uuid REFERENCES public.event_calculations(id) ON DELETE RESTRICT,
 ADD COLUMN IF NOT EXISTS calculation_snapshot jsonb,
 ADD COLUMN IF NOT EXISTS source_brief_revision integer,
 ADD COLUMN IF NOT EXISTS copied_from_id uuid REFERENCES public.offers(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES public.employees(id),
 ADD COLUMN IF NOT EXISTS acceptance_note text;

CREATE TABLE public.inquiry_activity (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inquiry_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
 kind text NOT NULL, body text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}',
 actor_id uuid REFERENCES public.employees(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
 delivery_key text UNIQUE
);
CREATE INDEX ON public.inquiry_activity(inquiry_id,created_at DESC);
CREATE TABLE public.inquiry_analyses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inquiry_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
 brief_revision integer NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.inquiry_analyses(inquiry_id,created_at DESC);
CREATE TABLE public.sales_document_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL,
 calculation_id uuid REFERENCES public.event_calculations(id) ON DELETE SET NULL,
 inquiry_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
 storage_bucket text NOT NULL, storage_path text NOT NULL, revision integer,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(storage_bucket,storage_path)
);

CREATE OR REPLACE FUNCTION public.sales_employee_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT id FROM public.employees WHERE is_active AND (auth_user_id=auth.uid() OR id=auth.uid())
 ORDER BY (auth_user_id=auth.uid()) DESC NULLS LAST LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public.is_inquiry_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = public.sales_employee_id()
      AND employee.is_active = true
      AND (
        employee.role = 'admin'
        OR employee.access_level = 'admin'
        OR 'admin' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  );
$$;
CREATE OR REPLACE FUNCTION public.has_inquiry_permission(permission_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.is_inquiry_admin() OR EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = public.sales_employee_id()
      AND employee.is_active = true
      AND permission_name = ANY(COALESCE(employee.permissions, '{}'::text[]))
  );
$$;
CREATE OR REPLACE FUNCTION public.can_view_inquiry(inquiry_owner uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    public.is_inquiry_admin()
    OR public.has_inquiry_permission('inquiries_view_all')
    OR (
      inquiry_owner IS NULL
      AND (
        public.has_inquiry_permission('inquiries_view')
        OR public.has_inquiry_permission('inquiries_manage')
        OR public.has_inquiry_permission('inquiries_view_pool')
      )
    )
    OR (
      inquiry_owner = public.sales_employee_id()
      AND (
        public.has_inquiry_permission('inquiries_view')
        OR public.has_inquiry_permission('inquiries_manage')
        OR public.has_inquiry_permission('inquiries_view_own')
        OR public.has_inquiry_permission('inquiries_manage_own')
      )
    )
    OR (
      public.has_inquiry_permission('inquiries_view_team')
      AND EXISTS (
        SELECT 1
        FROM public.employees viewer
        JOIN public.employees owner ON owner.id = inquiry_owner
        WHERE viewer.id = public.sales_employee_id()
          AND viewer.is_active = true
          AND owner.is_active = true
          AND viewer.sales_team_id IS NOT NULL
          AND owner.sales_team_id = viewer.sales_team_id
      )
    );
$$;
CREATE OR REPLACE FUNCTION public.can_assign_inquiry_owner(target_owner uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    public.is_inquiry_admin()
    OR (
      public.has_inquiry_permission('inquiries_assign')
      AND (
        target_owner IS NULL
        OR target_owner = public.sales_employee_id()
        OR EXISTS (
          SELECT 1
          FROM public.employees viewer
          JOIN public.employees target ON target.id = target_owner
          WHERE viewer.id = public.sales_employee_id()
            AND viewer.is_active = true
            AND target.is_active = true
            AND viewer.sales_team_id IS NOT NULL
            AND target.sales_team_id = viewer.sales_team_id
        )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_inquiry(inquiry_owner uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(bool_or(e.role::text='admin' OR e.access_level::text='admin'
 OR coalesce(e.permissions,'{}') && ARRAY['admin','inquiries_manage_all']
 OR (e.id=inquiry_owner AND coalesce(e.permissions,'{}') && ARRAY['inquiries_manage','inquiries_manage_own'])
 OR (e.is_sales_team_manager AND 'inquiries_manage_team'=ANY(coalesce(e.permissions,'{}')) AND e.sales_team_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.employees owner WHERE owner.id=inquiry_owner AND owner.is_active AND owner.sales_team_id=e.sales_team_id))),false)
 FROM public.employees e WHERE e.id=public.sales_employee_id();
$$;
CREATE OR REPLACE FUNCTION public.sales_can_manage_document(p_inquiry uuid,p_event uuid,p_creator uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT (p_event IS NULL OR public.current_employee_can_access_event_company(p_event)) AND
 CASE WHEN p_inquiry IS NOT NULL THEN EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_inquiry AND t.is_inquiry AND t.archived_at IS NULL AND public.can_manage_inquiry(t.inquiry_owner_id))
 ELSE EXISTS(SELECT 1 FROM public.employees e WHERE e.id=public.sales_employee_id() AND (e.role::text='admin' OR coalesce(e.permissions,'{}') && ARRAY['admin','offers_manage','events_manage'])) END;
$$;
CREATE OR REPLACE FUNCTION public.sales_can_manage_offer(p_offer uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT public.sales_can_manage_document(inquiry_id,event_id,created_by) FROM public.offers WHERE id=p_offer),false);
$$;
CREATE OR REPLACE FUNCTION public.sales_can_manage_calculation(p_calculation uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT public.sales_can_manage_document(inquiry_id,event_id,created_by) FROM public.event_calculations WHERE id=p_calculation),false);
$$;

ALTER TABLE public.inquiry_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquiry_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_document_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_activity_read ON public.inquiry_activity FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.tasks WHERE id=inquiry_id AND is_inquiry));
CREATE POLICY sales_analyses_read ON public.inquiry_analyses FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.tasks WHERE id=inquiry_id AND is_inquiry));
CREATE POLICY sales_files_read ON public.sales_document_files FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM public.offers WHERE id=offer_id) OR EXISTS(SELECT 1 FROM public.event_calculations WHERE id=calculation_id));

-- Module-wide permissive policies must not let a viewer modify another owner's inquiry.
CREATE POLICY inquiry_offer_read ON public.offers FOR SELECT TO authenticated USING(inquiry_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.tasks WHERE id=inquiry_id AND is_inquiry));
CREATE POLICY inquiry_offer_write ON public.offers FOR ALL TO authenticated USING(inquiry_id IS NOT NULL AND public.sales_can_manage_document(inquiry_id,event_id,created_by)) WITH CHECK(inquiry_id IS NOT NULL AND public.sales_can_manage_document(inquiry_id,event_id,created_by));
CREATE POLICY inquiry_offer_insert_guard ON public.offers AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(inquiry_id IS NULL OR public.sales_can_manage_document(inquiry_id,event_id,created_by));
CREATE POLICY inquiry_offer_update_guard ON public.offers AS RESTRICTIVE FOR UPDATE TO authenticated USING(inquiry_id IS NULL OR public.sales_can_manage_document(inquiry_id,event_id,created_by)) WITH CHECK(inquiry_id IS NULL OR public.sales_can_manage_document(inquiry_id,event_id,created_by));
CREATE POLICY inquiry_offer_delete_guard ON public.offers AS RESTRICTIVE FOR DELETE TO authenticated USING(inquiry_id IS NULL OR public.sales_can_manage_document(inquiry_id,event_id,created_by));
DO $$ DECLARE t text; predicate text; BEGIN
 FOREACH t IN ARRAY ARRAY['offer_items','offer_packages','offer_equipment_substitutions'] LOOP
  predicate := format('EXISTS(SELECT 1 FROM public.offers o WHERE o.id=%I.offer_id AND (o.inquiry_id IS NULL OR public.sales_can_manage_document(o.inquiry_id,o.event_id,o.created_by)))',t);
  EXECUTE format('CREATE POLICY sales_document_write ON public.%I FOR ALL TO authenticated USING(%s) WITH CHECK(%s)',t,predicate,predicate);
  EXECUTE format('CREATE POLICY sales_document_read ON public.%I FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.offers o WHERE o.id=%I.offer_id))',t,t);
  EXECUTE format('CREATE POLICY sales_document_update_guard ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING(%s) WITH CHECK(%s)',t,predicate,predicate);
  EXECUTE format('CREATE POLICY sales_document_insert_guard ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(%s)',t,predicate);
  EXECUTE format('CREATE POLICY sales_document_delete_guard ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING(%s)',t,predicate);
 END LOOP;
END $$;
CREATE POLICY sales_package_item_read ON public.offer_package_items FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.offer_packages WHERE id=package_id));
CREATE POLICY sales_package_item_write ON public.offer_package_items FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM public.offer_packages p WHERE p.id=package_id AND public.sales_can_manage_offer(p.offer_id))) WITH CHECK(EXISTS(SELECT 1 FROM public.offer_packages p WHERE p.id=package_id AND public.sales_can_manage_offer(p.offer_id)));
CREATE POLICY sales_calculation_update_guard ON public.event_calculations AS RESTRICTIVE FOR UPDATE TO authenticated USING(inquiry_id IS NULL OR public.sales_can_manage_calculation(id)) WITH CHECK(inquiry_id IS NULL OR public.sales_can_manage_document(inquiry_id,event_id,created_by));
CREATE POLICY sales_calculation_delete_guard ON public.event_calculations AS RESTRICTIVE FOR DELETE TO authenticated USING(inquiry_id IS NULL OR public.sales_can_manage_calculation(id));

CREATE FUNCTION public.sales_log(p_inquiry uuid,p_kind text,p_body text,p_metadata jsonb DEFAULT '{}',p_key text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_inquiry IS NOT NULL THEN INSERT INTO public.inquiry_activity(inquiry_id,kind,body,metadata,actor_id,delivery_key)
 VALUES(p_inquiry,p_kind,p_body,p_metadata,public.sales_employee_id(),p_key) ON CONFLICT(delivery_key) DO NOTHING; END IF;
END $$;
-- Internal row copier preserves newly added content columns but omits generated columns.
CREATE FUNCTION public.sales_insert_copy(p_table regclass,p_data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE columns_sql text; result uuid;
BEGIN
 SELECT string_agg(quote_ident(a.attname),',' ORDER BY a.attnum) INTO columns_sql FROM pg_attribute a
 WHERE a.attrelid=p_table AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='' AND a.attidentity='' AND p_data ? a.attname;
 EXECUTE format('INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_record(NULL::%s,$1) RETURNING id',p_table,columns_sql,columns_sql,p_table) INTO result USING p_data;
 RETURN result;
END $$;
CREATE FUNCTION public.duplicate_sales_calculation(p_calculation uuid,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.event_calculations; i record; n uuid;
BEGIN
 SELECT * INTO STRICT c FROM public.event_calculations WHERE id=p_calculation FOR UPDATE;
 IF NOT public.sales_can_manage_calculation(c.id) THEN RAISE EXCEPTION 'Brak uprawnień do kalkulacji'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_calculations WHERE id=p_request_id AND copied_from_id=c.id) THEN n:=p_request_id;
 ELSE
 n:=public.sales_insert_copy('public.event_calculations',to_jsonb(c)||jsonb_build_object('id',p_request_id,'name',c.name||' — kopia','copied_from_id',c.id,'created_by',public.sales_employee_id(),'created_at',now(),'updated_at',now(),'is_accepted',false,'generated_pdf_path',NULL,'generated_pdf_at',NULL,'generated_pdf_revision',NULL,'content_revision',1));
 FOR i IN SELECT to_jsonb(x) data FROM public.event_calculation_items x WHERE calculation_id=c.id ORDER BY position,id LOOP
 PERFORM public.sales_insert_copy('public.event_calculation_items',i.data||jsonb_build_object('id',gen_random_uuid(),'calculation_id',n,'created_at',now(),'updated_at',now())); END LOOP;
 PERFORM public.sales_log(c.inquiry_id,'calculation','Utworzono kopię kalkulacji',jsonb_build_object('calculation_id',n,'copied_from_id',c.id));
 END IF;
 RETURN (SELECT jsonb_build_object('calculation',to_jsonb(x),'items',(SELECT coalesce(jsonb_agg(to_jsonb(item_row) ORDER BY position,id),'[]') FROM public.event_calculation_items item_row WHERE calculation_id=n)) FROM public.event_calculations x WHERE id=n);
END $$;
CREATE FUNCTION public.duplicate_sales_offer(p_offer uuid,p_request_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.offers; row_data record; pkg record; new_pkg uuid; new_item uuid; item_map jsonb:='{}'; n uuid;
BEGIN
 SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer FOR UPDATE;
 IF NOT public.sales_can_manage_offer(o.id) THEN RAISE EXCEPTION 'Brak uprawnień do oferty'; END IF;
 IF EXISTS(SELECT 1 FROM public.offers WHERE id=p_request_id AND copied_from_id=o.id) THEN RETURN p_request_id; END IF;
 -- Serialize number allocation, including browser-created offers via the trigger below.
 PERFORM pg_advisory_xact_lock(20260926,1);
 n:=public.sales_insert_copy('public.offers',to_jsonb(o)||jsonb_build_object('id',p_request_id,'copied_from_id',o.id,'offer_number',NULL,'status','draft','title',coalesce(o.title,o.offer_number)||' — kopia','created_by',public.sales_employee_id(),'created_at',now(),'updated_at',now(),'accepted_at',NULL,'accepted_by',NULL,'acceptance_note',NULL,'accepted_package_id',NULL,'accepted_variant_selections','[]'::jsonb,'sent_at',NULL,'pdf_url',NULL,'last_generated_by',NULL,'generated_pdf_url',NULL,'generated_pdf_revision',NULL,'content_revision',1,'last_generated_at',NULL,'modified_after_generation',true));
 FOR row_data IN SELECT to_jsonb(x) data FROM public.offer_items x WHERE offer_id=o.id ORDER BY display_order,id LOOP
 new_item:=public.sales_insert_copy('public.offer_items',row_data.data||jsonb_build_object('id',gen_random_uuid(),'offer_id',n,'created_at',now(),'updated_at',now()));
 item_map:=item_map||jsonb_build_object(row_data.data->>'id',new_item); END LOOP;
 FOR pkg IN SELECT * FROM public.offer_packages WHERE offer_id=o.id ORDER BY display_order LOOP
 new_pkg:=public.sales_insert_copy('public.offer_packages',to_jsonb(pkg)||jsonb_build_object('id',gen_random_uuid(),'offer_id',n,'created_at',now(),'updated_at',now()));
 FOR row_data IN SELECT to_jsonb(x) data FROM public.offer_package_items x WHERE package_id=pkg.id LOOP
 PERFORM public.sales_insert_copy('public.offer_package_items',row_data.data||jsonb_build_object('id',gen_random_uuid(),'package_id',new_pkg,'offer_item_id',item_map->>(row_data.data->>'offer_item_id'),'created_at',now())); END LOOP;
 END LOOP;
 FOR row_data IN SELECT to_jsonb(x) data FROM public.offer_equipment_substitutions x WHERE offer_id=o.id LOOP
 PERFORM public.sales_insert_copy('public.offer_equipment_substitutions',row_data.data||jsonb_build_object('id',gen_random_uuid(),'offer_id',n,'created_at',now())); END LOOP;
 PERFORM public.sales_log(o.inquiry_id,'offer','Utworzono kopię oferty',jsonb_build_object('offer_id',n,'copied_from_id',o.id));
 RETURN n;
END $$;
CREATE OR REPLACE FUNCTION public.generate_offer_number(p_event_id uuid DEFAULT NULL) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prefix text:='OF/'||to_char(current_date,'YYYY/MM')||'/'; counter integer;
BEGIN
 PERFORM pg_advisory_xact_lock(20260926,1);
 SELECT coalesce(max(substring(offer_number FROM length(prefix)+1)::integer),0)+1 INTO counter FROM public.offers WHERE offer_number LIKE prefix||'%' AND substring(offer_number FROM length(prefix)+1) ~ '^[0-9]{1,8}$';
 RETURN prefix||lpad(counter::text,greatest(3,length(counter::text)),'0');
END $$;
REVOKE ALL ON FUNCTION public.generate_offer_number(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.generate_offer_number(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.auto_generate_offer_number() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.offer_number IS NULL OR NEW.offer_number='' THEN PERFORM pg_advisory_xact_lock(20260926,1); NEW.offer_number:=public.generate_offer_number(NEW.event_id); END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.snapshot_offer_calculation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.event_calculations;
BEGIN
 IF NEW.source_calculation_id IS NULL THEN NEW.pricing_source:='offer'; NEW.calculation_snapshot:=NULL;
 ELSIF TG_OP='INSERT' OR NEW.source_calculation_id IS DISTINCT FROM OLD.source_calculation_id OR NEW.calculation_snapshot IS NULL THEN
 SELECT * INTO STRICT c FROM public.event_calculations WHERE id=NEW.source_calculation_id FOR UPDATE;
 IF NOT coalesce(((NEW.inquiry_id IS NOT NULL AND c.inquiry_id=NEW.inquiry_id) OR (NEW.event_id IS NOT NULL AND c.event_id=NEW.event_id)),false) THEN RAISE EXCEPTION 'Kalkulacja nie należy do zapytania lub wydarzenia'; END IF;
 NEW.pricing_source:='calculation';
 -- A duplicate retains its original price snapshot, including after source edits.
 IF TG_OP='UPDATE' OR NEW.copied_from_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.offers original WHERE original.id=NEW.copied_from_id AND original.source_calculation_id=NEW.source_calculation_id AND original.calculation_snapshot=NEW.calculation_snapshot) THEN
 NEW.calculation_snapshot:=to_jsonb(c)||jsonb_build_object('event_calculation_items',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY position,id),'[]') FROM public.event_calculation_items i WHERE calculation_id=c.id));
 END IF;
 ELSE NEW.calculation_snapshot:=OLD.calculation_snapshot; NEW.pricing_source:=OLD.pricing_source;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sales_snapshot_calculation BEFORE INSERT OR UPDATE OF source_calculation_id,calculation_snapshot,pricing_source ON public.offers FOR EACH ROW EXECUTE FUNCTION public.snapshot_offer_calculation();
-- Migrate the previous implicit selection exactly once, without accepting any new sale.
UPDATE public.offers o SET source_calculation_id=coalesce(
 (SELECT e.accepted_calculation_id FROM public.events e WHERE e.id=o.event_id AND e.financial_source='calculation'),
 (SELECT c.id FROM public.event_calculations c WHERE c.is_accepted AND c.inquiry_id=o.inquiry_id ORDER BY c.created_at DESC LIMIT 1))
WHERE o.source_calculation_id IS NULL AND (EXISTS(SELECT 1 FROM public.events e WHERE e.id=o.event_id AND e.financial_source='calculation' AND e.accepted_calculation_id IS NOT NULL) OR EXISTS(SELECT 1 FROM public.event_calculations c WHERE c.inquiry_id=o.inquiry_id AND c.is_accepted));

CREATE FUNCTION public.invalidate_calculation_document() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.name IS DISTINCT FROM OLD.name OR NEW.notes IS DISTINCT FROM OLD.notes THEN NEW.content_revision:=OLD.content_revision+1; END IF;
 IF NEW.content_revision IS DISTINCT FROM OLD.content_revision THEN NEW.generated_pdf_path:=NULL; NEW.generated_pdf_at:=NULL; NEW.generated_pdf_revision:=NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sales_calculation_revision BEFORE UPDATE ON public.event_calculations FOR EACH ROW EXECUTE FUNCTION public.invalidate_calculation_document();
CREATE FUNCTION public.invalidate_calculation_item_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE calc uuid;
BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'updated_at')=(to_jsonb(OLD)-'updated_at') THEN RETURN NEW; END IF;
 calc:=CASE WHEN TG_OP='DELETE' THEN OLD.calculation_id ELSE NEW.calculation_id END;
 UPDATE public.event_calculations SET content_revision=content_revision+1,updated_at=now() WHERE id=calc;
 IF TG_OP='UPDATE' AND OLD.calculation_id IS DISTINCT FROM NEW.calculation_id THEN UPDATE public.event_calculations SET content_revision=content_revision+1,updated_at=now() WHERE id=OLD.calculation_id; END IF;
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER sales_calculation_item_revision AFTER INSERT OR UPDATE OR DELETE ON public.event_calculation_items FOR EACH ROW EXECUTE FUNCTION public.invalidate_calculation_item_document();
-- Old PDFs remain available in history, but require regeneration before a new dispatch.
INSERT INTO public.sales_document_files(calculation_id,inquiry_id,storage_bucket,storage_path)
 SELECT id,inquiry_id,'event-files',generated_pdf_path FROM public.event_calculations WHERE generated_pdf_path IS NOT NULL ON CONFLICT DO NOTHING;
UPDATE public.event_calculations SET generated_pdf_path=NULL,generated_pdf_at=NULL WHERE generated_pdf_revision IS NULL;

CREATE FUNCTION public.save_inquiry_brief(p_inquiry uuid,p_expected_revision integer,p_details jsonb,p_contact_note text DEFAULT NULL,p_next_action timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tasks; merged jsonb;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry AND is_inquiry FOR UPDATE;
 IF NOT public.can_manage_inquiry(t.inquiry_owner_id) OR t.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Brak uprawnień do zapytania'; END IF;
 IF t.brief_revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Dane zmieniła inna osoba. Odśwież zapytanie przed zapisem.'; END IF;
 IF jsonb_typeof(p_details) IS DISTINCT FROM 'object' OR octet_length(p_details::text)>100000 THEN RAISE EXCEPTION 'Nieprawidłowe dane briefu'; END IF;
 merged:=coalesce(t.inquiry_details,'{}')||(SELECT coalesce(jsonb_object_agg(key,value),'{}') FROM jsonb_each(p_details) WHERE key=ANY(ARRAY['questions','conversation_notes','event_assumptions','event_assumption_items','event_goal','preliminary_budget_min','preliminary_budget_max','preliminary_budget_text','preliminary_budget_currency','termin','location_text','scope','brief_confirmed_at','event_assumptions_source','assistant_analysis_generated_at']));
 IF jsonb_typeof(coalesce(merged->'questions','[]'))<>'array' THEN RAISE EXCEPTION 'Nieprawidłowa lista pytań'; END IF;
 UPDATE public.tasks SET inquiry_details=merged,brief_revision=brief_revision+1,
 estimated_value=coalesce(((nullif(merged->>'preliminary_budget_min','')::numeric+nullif(merged->>'preliminary_budget_max','')::numeric)/2),nullif(merged->>'preliminary_budget_max','')::numeric,nullif(merged->>'preliminary_budget_min','')::numeric),
 last_contact_at=CASE WHEN nullif(btrim(p_contact_note),'') IS NOT NULL THEN now() ELSE last_contact_at END,
 inquiry_stage=CASE WHEN nullif(btrim(p_contact_note),'') IS NOT NULL AND inquiry_stage='new' THEN 'contacted' ELSE inquiry_stage END,
 next_action_at=coalesce(p_next_action,next_action_at),updated_at=now() WHERE id=t.id RETURNING * INTO t;
 PERFORM public.sales_log(t.id,CASE WHEN nullif(btrim(p_contact_note),'') IS NULL THEN 'brief' ELSE 'contact' END,coalesce(nullif(btrim(p_contact_note),''),'Zapisano ustalenia i odpowiedzi klienta'),jsonb_build_object('brief_revision',t.brief_revision,'details',merged));
 RETURN to_jsonb(t);
END $$;
CREATE FUNCTION public.save_inquiry_analysis(p_inquiry uuid,p_revision integer,p_result jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tasks; n uuid;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry AND is_inquiry FOR UPDATE;
 IF NOT public.can_manage_inquiry(t.inquiry_owner_id) OR t.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
 IF t.brief_revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Brief zmienił się podczas analizy. Uruchom analizę ponownie.'; END IF;
 INSERT INTO public.inquiry_analyses(inquiry_id,brief_revision,result) VALUES(t.id,p_revision,p_result) RETURNING id INTO n;
 PERFORM public.sales_log(t.id,'analysis','Zapisano nową analizę AI',jsonb_build_object('analysis_id',n,'brief_revision',p_revision)); RETURN n;
END $$;
CREATE FUNCTION public.archive_inquiry(p_inquiry uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tasks;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry AND is_inquiry FOR UPDATE;
 IF NOT public.can_manage_inquiry(t.inquiry_owner_id) OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Wymagane uprawnienia i powód archiwizacji'; END IF;
 UPDATE public.tasks SET archived_at=now(),next_action_at=NULL WHERE id=t.id;
 UPDATE public.inquiry_followup_schedule SET status='cancelled',updated_at=now() WHERE inquiry_id=t.id AND status='pending';
 PERFORM public.sales_log(t.id,'archive',p_reason);
END $$;
CREATE FUNCTION public.prevent_inquiry_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.is_inquiry THEN RAISE EXCEPTION 'Archiwizuj zapytanie, aby zachować historię i powiązanie źródła.'; END IF; RETURN OLD; END $$;
CREATE TRIGGER sales_preserve_inquiry BEFORE DELETE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.prevent_inquiry_delete();

CREATE OR REPLACE FUNCTION public.sync_inquiry_from_offer() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 -- Only actual sends advance the sales stage. Draft edits must not change the selected offer.
 IF NEW.inquiry_id IS NOT NULL AND NEW.status='sent' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
 UPDATE public.tasks SET linked_offer_id=NEW.id,last_contact_at=now(),inquiry_stage=CASE WHEN inquiry_stage IN ('new','contacted','qualified') THEN 'proposal' ELSE inquiry_stage END
 WHERE id=NEW.inquiry_id AND is_inquiry AND archived_at IS NULL;
 END IF; RETURN NEW;
END $$;
CREATE FUNCTION public.record_sales_delivery(p_kind text,p_document uuid,p_delivery_key text,p_storage_path text DEFAULT NULL,p_recipient text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE inquiry uuid; o public.offers; c public.event_calculations;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Operacja dostępna tylko dla usługi wysyłającej'; END IF;
 IF EXISTS(SELECT 1 FROM public.inquiry_activity WHERE delivery_key=p_delivery_key) THEN RETURN; END IF;
 IF p_kind='offer' THEN
 SELECT * INTO STRICT o FROM public.offers WHERE id=p_document FOR UPDATE; inquiry:=o.inquiry_id;
 UPDATE public.offers SET status='sent' WHERE id=o.id AND status='draft';
 ELSIF p_kind='calculation' THEN SELECT * INTO STRICT c FROM public.event_calculations WHERE id=p_document; inquiry:=c.inquiry_id;
 ELSE RAISE EXCEPTION 'Nieobsługiwany dokument'; END IF;
 IF p_storage_path IS NOT NULL THEN INSERT INTO public.sales_document_files(offer_id,calculation_id,inquiry_id,storage_bucket,storage_path,revision)
 VALUES(CASE WHEN p_kind='offer' THEN p_document END,CASE WHEN p_kind='calculation' THEN p_document END,inquiry,CASE WHEN p_kind='offer' THEN 'generated-offers' ELSE 'event-files' END,p_storage_path,c.generated_pdf_revision) ON CONFLICT DO NOTHING; END IF;
 UPDATE public.tasks SET last_contact_at=now(),linked_offer_id=CASE WHEN p_kind='offer' THEN p_document ELSE linked_offer_id END,
 inquiry_stage=CASE WHEN inquiry_stage IN ('new','contacted','qualified') THEN 'proposal' ELSE inquiry_stage END
 WHERE id=inquiry AND archived_at IS NULL;
 PERFORM public.sales_log(inquiry,'delivery',CASE WHEN p_kind='offer' THEN 'Wysłano ofertę' ELSE 'Wysłano kalkulację' END,jsonb_build_object('document_id',p_document,'recipient',p_recipient,'storage_path',p_storage_path),p_delivery_key);
END $$;

CREATE FUNCTION public.accept_inquiry_offer(p_offer uuid,p_note text,p_expected_selected uuid DEFAULT NULL,p_package uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.offers; t public.tasks; scope jsonb;
BEGIN
 SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer;
 SELECT * INTO STRICT t FROM public.tasks WHERE id=o.inquiry_id AND is_inquiry FOR UPDATE;
 SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer FOR UPDATE;
 IF NOT public.sales_can_manage_offer(o.id) THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
 IF t.accepted_offer_id=o.id AND o.status='accepted' THEN RETURN; END IF;
 IF t.accepted_offer_id IS DISTINCT FROM p_expected_selected THEN RAISE EXCEPTION 'Wybrany wariant został zmieniony. Odśwież zapytanie.'; END IF;
 IF o.event_id IS NOT NULL THEN RAISE EXCEPTION 'Dla wydarzenia użyj potwierdzenia zasobów i akceptacji oferty.'; END IF;
 IF nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'Zapisz potwierdzenie klienta'; END IF;
 IF o.package_mode AND NOT EXISTS(SELECT 1 FROM public.offer_packages WHERE id=p_package AND offer_id=o.id) THEN RAISE EXCEPTION 'Wybierz pakiet'; END IF;
 IF o.package_mode THEN SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]') INTO scope FROM public.offer_package_items i WHERE package_id=p_package;
 ELSE SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]') INTO scope FROM public.offer_items i WHERE offer_id=o.id; END IF;
 IF jsonb_array_length(scope)=0 THEN RAISE EXCEPTION 'Uzupełnij zakres oferty przed akceptacją'; END IF;
 IF t.accepted_offer_id IS NOT NULL AND t.accepted_offer_id<>o.id THEN RAISE EXCEPTION 'Najpierw otwórz negocjacje ponownie z podaniem powodu'; END IF;
 PERFORM set_config('mavinci.sales_decision','yes',true);
 UPDATE public.offers SET status='rejected' WHERE inquiry_id=t.id AND status='accepted' AND id<>o.id;
 UPDATE public.offers SET status='accepted',accepted_at=now(),accepted_by=public.sales_employee_id(),acceptance_note=p_note,accepted_package_id=p_package,accepted_variant_selections=scope WHERE id=o.id;
 UPDATE public.tasks SET accepted_offer_id=o.id,inquiry_stage='won',next_action_at=NULL WHERE id=t.id;
 PERFORM public.sales_log(t.id,'acceptance','Klient zaakceptował wariant: '||o.offer_number,jsonb_build_object('offer_id',o.id,'note',p_note));
END $$;
CREATE FUNCTION public.select_inquiry_calculation(p_calculation uuid,p_expected_selected uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.event_calculations; t public.tasks;
BEGIN
 SELECT * INTO STRICT c FROM public.event_calculations WHERE id=p_calculation;
 SELECT * INTO STRICT t FROM public.tasks WHERE id=c.inquiry_id AND is_inquiry FOR UPDATE;
 IF NOT public.sales_can_manage_calculation(c.id) THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
 IF t.accepted_calculation_id IS DISTINCT FROM p_expected_selected THEN RAISE EXCEPTION 'Wybór zmieniła inna osoba. Odśwież zapytanie.'; END IF;
 PERFORM set_config('mavinci.sales_decision','yes',true);
 UPDATE public.event_calculations SET is_accepted=false WHERE inquiry_id=t.id AND is_accepted AND id<>c.id;
 UPDATE public.event_calculations SET is_accepted=true WHERE id=c.id;
 UPDATE public.tasks SET accepted_calculation_id=c.id WHERE id=t.id;
 PERFORM public.sales_log(t.id,'calculation','Wybrano kalkulację: '||c.name,jsonb_build_object('calculation_id',c.id));
END $$;

-- Ordinary conversion remains idempotent, but does not claim that a sale was won.
CREATE OR REPLACE FUNCTION public.convert_inquiry_to_event(p_inquiry_id uuid,p_event_name text DEFAULT NULL,p_event_date timestamptz DEFAULT NULL,p_category_id uuid DEFAULT NULL,p_my_company_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE t public.tasks; n uuid; event_date_value timestamptz;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry_id AND is_inquiry FOR UPDATE;
 IF NOT public.can_manage_inquiry(t.inquiry_owner_id) OR t.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
 IF t.event_id IS NOT NULL THEN RETURN t.event_id; END IF;
 event_date_value:=coalesce(p_event_date,nullif(t.inquiry_details->>'termin','')::timestamptz,t.due_date);
 IF event_date_value IS NULL THEN RAISE EXCEPTION 'Uzupełnij termin wydarzenia'; END IF;
 INSERT INTO public.events(name,description,event_date,location,status,budget,organization_id,contact_person_id,category_id,my_company_id,created_by)
 VALUES(coalesce(nullif(btrim(p_event_name),''),t.title),concat_ws(E'\n',t.description,t.inquiry_details->>'scope',t.inquiry_details->>'conversation_notes'),event_date_value,t.inquiry_details->>'location_text','inquiry',t.estimated_value,t.organization_id,t.contact_id,p_category_id,p_my_company_id,auth.uid()) RETURNING id INTO n;
 UPDATE public.tasks SET event_id=n WHERE id=t.id;
 UPDATE public.tasks SET event_id=n WHERE inquiry_id=t.id AND event_id IS NULL;
 UPDATE public.offers SET event_id=n WHERE inquiry_id=t.id AND event_id IS NULL;
 UPDATE public.event_calculations SET event_id=n WHERE inquiry_id=t.id AND event_id IS NULL;
 RETURN n;
END $$;
-- Deliberate return to negotiations; preserves a reason instead of masquerading as a resend.
CREATE FUNCTION public.reopen_inquiry_negotiation(p_inquiry uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tasks;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry AND is_inquiry FOR UPDATE;
 IF NOT public.can_manage_inquiry(t.inquiry_owner_id) OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Podaj powód i sprawdź uprawnienia'; END IF;
 PERFORM set_config('mavinci.sales_decision','yes',true);
 UPDATE public.offers SET status='sent',accepted_at=NULL,accepted_by=NULL,acceptance_note=NULL,accepted_package_id=NULL,accepted_variant_selections='[]' WHERE id=t.accepted_offer_id AND status='accepted';
 UPDATE public.tasks SET accepted_offer_id=NULL,inquiry_stage='negotiation',archived_at=NULL,next_action_at=now()+interval '2 days' WHERE id=t.id;
 PERFORM public.sales_log(t.id,'negotiation',p_reason);
END $$;

-- Guard inquiry child records even when an older module policy also allows a write.
DO $$ DECLARE tbl text; pred text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['offer_package_items','event_calculation_items'] LOOP
  pred:=CASE WHEN tbl='offer_package_items' THEN 'EXISTS(SELECT 1 FROM public.offer_packages p JOIN public.offers o ON o.id=p.offer_id WHERE p.id=package_id AND (o.inquiry_id IS NULL OR public.sales_can_manage_offer(o.id)))'
   ELSE 'EXISTS(SELECT 1 FROM public.event_calculations c WHERE c.id=calculation_id AND (c.inquiry_id IS NULL OR public.sales_can_manage_calculation(c.id)))' END;
  EXECUTE format('CREATE POLICY sales_child_insert_guard ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(%s)',tbl,pred);
  EXECUTE format('CREATE POLICY sales_child_update_guard ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING(%s) WITH CHECK(%s)',tbl,pred,pred);
  EXECUTE format('CREATE POLICY sales_child_delete_guard ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING(%s)',tbl,pred);
 END LOOP;
END $$;

UPDATE public.tasks t SET accepted_offer_id=(SELECT min(o.id::text)::uuid FROM public.offers o WHERE o.inquiry_id=t.id AND o.status='accepted') WHERE t.is_inquiry AND (SELECT count(*) FROM public.offers o WHERE o.inquiry_id=t.id AND o.status='accepted')=1;
UPDATE public.tasks t SET accepted_calculation_id=(SELECT min(c.id::text)::uuid FROM public.event_calculations c WHERE c.inquiry_id=t.id AND c.is_accepted) WHERE t.is_inquiry AND (SELECT count(*) FROM public.event_calculations c WHERE c.inquiry_id=t.id AND c.is_accepted)=1;

CREATE FUNCTION public.guard_inquiry_offer_decision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.inquiry_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.status='accepted' AND coalesce(current_setting('mavinci.sales_decision',true),'')<>'yes' THEN
   IF (to_jsonb(NEW)-ARRAY['updated_at','generated_pdf_url','last_generated_at','last_generated_by','modified_after_generation','generated_pdf_revision','event_id']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['updated_at','generated_pdf_url','last_generated_at','last_generated_by','modified_after_generation','generated_pdf_revision','event_id']) THEN
    RAISE EXCEPTION 'Zaakceptowany wariant jest zapisany. Utwórz kopię albo otwórz negocjacje ponownie.';
   END IF;
 END IF;
 IF NEW.status='accepted' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) AND coalesce(current_setting('mavinci.sales_decision',true),'')<>'yes' THEN
  RAISE EXCEPTION 'Użyj akceptacji wariantu w zapytaniu lub potwierdzenia rezerwacji';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sales_offer_decision_guard BEFORE INSERT OR UPDATE ON public.offers FOR EACH ROW EXECUTE FUNCTION public.guard_inquiry_offer_decision();
CREATE FUNCTION public.guard_accepted_offer_content() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE offer_uuid uuid; BEGIN
 IF TG_TABLE_NAME='offer_package_items' THEN
 SELECT offer_id INTO offer_uuid FROM public.offer_packages WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.package_id ELSE NEW.package_id END;
 ELSE offer_uuid:=CASE WHEN TG_OP='DELETE' THEN OLD.offer_id ELSE NEW.offer_id END; END IF;
 IF EXISTS(SELECT 1 FROM public.offers WHERE id=offer_uuid AND inquiry_id IS NOT NULL AND status='accepted') THEN
 RAISE EXCEPTION 'Nie można edytować zakresu zaakceptowanej oferty. Utwórz kopię.'; END IF;
 RETURN coalesce(NEW,OLD);
END $$;
DO $$ DECLARE tbl text; BEGIN FOREACH tbl IN ARRAY ARRAY['offer_items','offer_packages','offer_package_items','offer_equipment_substitutions'] LOOP
 EXECUTE format('CREATE TRIGGER sales_accepted_content_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_accepted_offer_content()',tbl); END LOOP; END $$;

-- Trusted delivery jobs re-evaluate the same permission as the interactive UI.
CREATE FUNCTION public.sales_actor_can_manage(p_kind text,p_document uuid,p_user uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE old_sub text; result boolean;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Tylko usługa wysyłki'; END IF;
 old_sub:=current_setting('request.jwt.claim.sub',true);
 PERFORM set_config('request.jwt.claim.sub',p_user::text,true);
 result:=CASE WHEN p_kind='offer' THEN public.sales_can_manage_offer(p_document) WHEN p_kind='calculation' THEN public.sales_can_manage_calculation(p_document) WHEN p_kind='inquiry' THEN public.sales_can_manage_document(p_document,NULL,NULL) ELSE false END;
 PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true); RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sales_actor_can_manage(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_actor_can_manage(text,uuid,uuid) TO service_role;
-- Protect functions with a deliberately small public surface.
REVOKE ALL ON FUNCTION public.sales_log(uuid,text,text,jsonb,text),public.sales_insert_copy(regclass,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_sales_delivery(text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_sales_delivery(text,uuid,text,text,text) TO service_role;
DO $$ DECLARE signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY['sales_employee_id()','sales_can_manage_document(uuid,uuid,uuid)','sales_can_manage_offer(uuid)','sales_can_manage_calculation(uuid)','duplicate_sales_calculation(uuid,uuid)','duplicate_sales_offer(uuid,uuid)','save_inquiry_brief(uuid,integer,jsonb,text,timestamp with time zone)','save_inquiry_analysis(uuid,integer,jsonb)','archive_inquiry(uuid,text)','accept_inquiry_offer(uuid,text,uuid,uuid)','select_inquiry_calculation(uuid,uuid)','reopen_inquiry_negotiation(uuid,text)'] LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION public.'||signature||' FROM PUBLIC,anon';
 EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||signature||' TO authenticated'; END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.reserve_selected_equipment(
  p_offer_id uuid,
  p_items jsonb,
  p_accepted_shortages jsonb,
  p_package_id uuid DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_item jsonb;
  v_shortage jsonb;
  v_inserted_count integer := 0;
  v_shortage_count integer := 0;
  v_rejected_count integer := 0;
  v_snapshot jsonb;
  inquiry_uuid uuid; selected_uuid uuid;
BEGIN
  IF NOT public.sales_can_manage_offer(p_offer_id) THEN RAISE EXCEPTION 'Brak uprawnień do akceptacji oferty'; END IF;
  SELECT inquiry_id INTO inquiry_uuid FROM public.offers WHERE id=p_offer_id;
  IF inquiry_uuid IS NOT NULL THEN
    SELECT accepted_offer_id INTO selected_uuid FROM public.tasks WHERE id=inquiry_uuid FOR UPDATE;
    IF selected_uuid IS NOT NULL AND selected_uuid<>p_offer_id THEN RAISE EXCEPTION 'Wybrano inny wariant. Otwórz negocjacje ponownie przed zmianą.'; END IF;
  END IF;
  PERFORM 1 FROM public.offers WHERE id=p_offer_id FOR UPDATE;
  PERFORM set_config('mavinci.sales_decision','yes',true);
  SELECT event_id
  INTO v_event_id
  FROM public.offers
  WHERE id = p_offer_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nie znaleziono oferty');
  END IF;

  IF p_package_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.offer_packages
    WHERE id = p_package_id AND offer_id = p_offer_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wybrany pakiet nie należy do oferty');
  END IF;

  IF p_package_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'package_id', package.id,
      'package_name', package.name,
      'product_id', item.product_id,
      'product_variant_id', item.product_variant_id,
      'variant_name', variant.name,
      'quantity', item.quantity
    ) ORDER BY item.display_order), '[]'::jsonb)
    INTO v_snapshot
    FROM public.offer_packages package
    JOIN public.offer_package_items item ON item.package_id = package.id
    LEFT JOIN public.offer_product_variants variant ON variant.id = item.product_variant_id
    WHERE package.id = p_package_id;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'offer_item_id', item.id,
      'product_id', item.product_id,
      'product_variant_id', item.product_variant_id,
      'variant_name', variant.name,
      'quantity', item.quantity
    ) ORDER BY item.display_order), '[]'::jsonb)
    INTO v_snapshot
    FROM public.offer_items item
    LEFT JOIN public.offer_product_variants variant ON variant.id = item.product_variant_id
    WHERE item.offer_id = p_offer_id;
  END IF;

  DELETE FROM public.event_equipment
  WHERE event_id = v_event_id AND offer_id = p_offer_id;

  FOR v_item IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    IF v_item->>'item_type' = 'item' THEN
      INSERT INTO public.event_equipment(
        event_id, offer_id, equipment_id, quantity, reservation_status, auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_item->>'item_id')::uuid,
        (v_item->>'qty')::integer,
        'reserved_pending',
        true
      );
    ELSE
      INSERT INTO public.event_equipment(
        event_id, offer_id, kit_id, quantity, reservation_status, auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_item->>'item_id')::uuid,
        (v_item->>'qty')::integer,
        'reserved_pending',
        true
      );
    END IF;
    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  FOR v_shortage IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_accepted_shortages, '[]'::jsonb))
  LOOP
    IF v_shortage->>'item_type' = 'item' THEN
      INSERT INTO public.event_equipment(
        event_id, offer_id, equipment_id, quantity, reservation_status, is_optional, auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_shortage->>'item_id')::uuid,
        (v_shortage->>'shortage_qty')::integer,
        'planned',
        true,
        true
      );
    ELSE
      INSERT INTO public.event_equipment(
        event_id, offer_id, kit_id, quantity, reservation_status, is_optional, auto_added
      )
      VALUES (
        v_event_id,
        p_offer_id,
        (v_shortage->>'item_id')::uuid,
        (v_shortage->>'shortage_qty')::integer,
        'planned',
        true,
        true
      );
    END IF;
    v_shortage_count := v_shortage_count + 1;
  END LOOP;

  UPDATE public.offers
  SET status = 'accepted',
      accepted_at = now(),
      accepted_package_id = p_package_id,
      accepted_variant_selections = v_snapshot
  WHERE id = p_offer_id;

  UPDATE public.offers
  SET status = 'rejected'
  WHERE event_id = v_event_id
    AND id <> p_offer_id
    AND status = 'accepted';
  GET DIAGNOSTICS v_rejected_count = ROW_COUNT;

  DELETE FROM public.event_equipment
  WHERE event_id = v_event_id
    AND offer_id IN (
      SELECT id
      FROM public.offers
      WHERE event_id = v_event_id AND status = 'rejected'
    );

  UPDATE public.events
  SET has_equipment_shortage = (v_shortage_count > 0)
  WHERE id = v_event_id;

  IF inquiry_uuid IS NOT NULL THEN
    UPDATE public.tasks SET accepted_offer_id=p_offer_id,inquiry_stage='won',next_action_at=NULL WHERE id=inquiry_uuid;
    PERFORM public.sales_log(inquiry_uuid,'acceptance','Zaakceptowano ofertę i zapisano rezerwacje',jsonb_build_object('offer_id',p_offer_id));
  END IF;
  RETURN jsonb_build_object(
    'success', true,
    'reserved_count', v_inserted_count,
    'shortage_count', v_shortage_count,
    'rejected_offers_count', v_rejected_count,
    'accepted_package_id', p_package_id,
    'variant_selections', v_snapshot
  );
END;
$$;


REVOKE ALL ON FUNCTION public.reserve_selected_equipment(uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reserve_selected_equipment(uuid,jsonb,jsonb,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION handle_accepted_offer_deletion()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_other_accepted_offers_count integer;
BEGIN
  -- Sprawdź czy usuwana oferta była zaakceptowana
  IF OLD.status = 'accepted' THEN
    v_event_id := OLD.event_id;
    
    -- Usuń sprzęt powiązany z tą ofertą
    DELETE FROM event_equipment
    WHERE event_id = v_event_id
      AND offer_id = OLD.id;
    
    -- Sprawdź czy są inne zaakceptowane oferty dla tego eventu
    SELECT COUNT(*) INTO v_other_accepted_offers_count
    FROM offers
    WHERE event_id = v_event_id
      AND id != OLD.id
      AND status = 'accepted';
    
    -- Jeśli nie ma innych zaakceptowanych ofert, zresetuj event
    IF v_other_accepted_offers_count = 0 THEN
      UPDATE events
      SET 
        has_equipment_shortage = false,
        status = CASE 
          WHEN status = 'offer_accepted' THEN 'offer_sent'
          ELSE status
        END
      WHERE id = v_event_id;
      
      -- Możesz też wyczyścić pola budżetu jeśli chcesz:
      -- UPDATE events
      -- SET 
      --   total_budget = NULL,
      --   deposit_amount = NULL,
      --   final_price = NULL
      -- WHERE id = v_event_id;
    END IF;
  END IF;
  
  RETURN OLD;
END;
$$;
CREATE OR REPLACE FUNCTION handle_offer_status_change()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id uuid;
  v_other_accepted_offers_count integer;
BEGIN
  -- Sprawdź czy status zmienia się z 'accepted' na inny
  IF OLD.status = 'accepted' AND NEW.status != 'accepted' THEN
    v_event_id := NEW.event_id;
    
    -- Usuń sprzęt powiązany z tą ofertą
    DELETE FROM event_equipment
    WHERE event_id = v_event_id
      AND offer_id = NEW.id;
    
    -- Sprawdź czy są inne zaakceptowane oferty dla tego eventu
    SELECT COUNT(*) INTO v_other_accepted_offers_count
    FROM offers
    WHERE event_id = v_event_id
      AND id != NEW.id
      AND status = 'accepted';
    
    -- Jeśli nie ma innych zaakceptowanych ofert, zresetuj event
    IF v_other_accepted_offers_count = 0 THEN
      UPDATE events
      SET 
        has_equipment_shortage = false,
        status = CASE 
          WHEN status = 'offer_accepted' THEN 'offer_sent'
          ELSE status
        END
      WHERE id = v_event_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.prepare_inquiry_realization(p_inquiry_id uuid,p_event_name text DEFAULT NULL,p_event_date timestamptz DEFAULT NULL,p_category_id uuid DEFAULT NULL,p_my_company_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tasks; o public.offers; n uuid; amount numeric; resource record; task_uuid uuid;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_inquiry_id AND is_inquiry FOR UPDATE;
 IF NOT public.can_manage_inquiry(t.inquiry_owner_id) OR t.archived_at IS NOT NULL OR NOT public.current_employee_can_access_company(p_my_company_id) THEN RAISE EXCEPTION 'Brak uprawnień do realizacji w wybranej działalności'; END IF;
 IF t.accepted_offer_id IS NULL THEN RAISE EXCEPTION 'Najpierw zapisz akceptację klienta'; END IF;
 IF EXISTS(SELECT 1 FROM public.inquiry_activity WHERE inquiry_id=t.id AND kind='handoff') THEN RETURN t.event_id; END IF;
 SELECT * INTO STRICT o FROM public.offers WHERE id=t.accepted_offer_id AND inquiry_id=t.id AND status='accepted' FOR UPDATE;
 n:=public.convert_inquiry_to_event(t.id,p_event_name,p_event_date,p_category_id,p_my_company_id);
 IF NOT public.current_employee_can_access_event_company(n) THEN RAISE EXCEPTION 'Brak dostępu do działalności wydarzenia'; END IF;
 IF o.pricing_source='calculation' THEN
 SELECT coalesce(sum(round((i->>'quantity')::numeric*(i->>'unit_price')::numeric*greatest(1,coalesce((i->>'days')::numeric,1)),2)),0) INTO amount FROM jsonb_array_elements(o.calculation_snapshot->'event_calculation_items') i;
 ELSIF o.package_mode THEN SELECT price_net INTO STRICT amount FROM public.offer_packages WHERE id=o.accepted_package_id AND offer_id=o.id;
 ELSE amount:=coalesce(o.subtotal,0)-coalesce(o.discount_amount,0); END IF;
 IF o.pricing_source<>'calculation' AND coalesce((to_jsonb(o)->>'logistics_enabled')::boolean,false) THEN amount:=amount+coalesce((to_jsonb(o)->>'logistics_price_net')::numeric,0); END IF;
 UPDATE public.events SET budget=amount,expected_revenue=amount,financial_source='offer',status='offer_accepted' WHERE id=n AND status::text IN ('inquiry','offer_to_send','offer_sent','offer_accepted');
 -- Planned scope is explicit; actual reservations still require checking availability.
 FOR resource IN SELECT * FROM public.get_offer_selected_equipment(o.id,o.accepted_package_id) LOOP
 INSERT INTO public.event_equipment(event_id,offer_id,equipment_id,kit_id,quantity,reservation_status,auto_added)
 SELECT n,o.id,CASE WHEN resource.item_type='item' THEN resource.item_id END,CASE WHEN resource.item_type='kit' THEN resource.item_id END,resource.qty,'planned',true WHERE NOT EXISTS(SELECT 1 FROM public.event_equipment WHERE event_id=n AND offer_id=o.id AND (equipment_id=resource.item_id OR kit_id=resource.item_id));
 END LOOP;
 INSERT INTO public.tasks(title,description,priority,status,board_column,inquiry_id,event_id,assigned_to,created_by,due_date,is_inquiry)
 VALUES('Potwierdź zasoby i przygotuj realizację','Sprawdź dostępność i zamienniki w zaakceptowanej ofercie, następnie zarezerwuj zasoby. Przygotuj umowę i harmonogram.', 'high','todo','todo',t.id,n,t.inquiry_owner_id,public.sales_employee_id(),now()+interval '1 day',false) RETURNING id INTO task_uuid;
 IF t.inquiry_owner_id IS NOT NULL THEN INSERT INTO public.task_assignees(task_id,employee_id,assigned_by) VALUES(task_uuid,t.inquiry_owner_id,public.sales_employee_id()); END IF;
 PERFORM public.sales_log(t.id,'handoff','Przygotowano realizację z zaakceptowanej oferty',jsonb_build_object('event_id',n,'offer_id',o.id,'scope',o.accepted_variant_selections,'calculation_snapshot',o.calculation_snapshot,'budget_net',amount));
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.prepare_inquiry_realization(uuid,text,timestamptz,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_inquiry_realization(uuid,text,timestamptz,uuid,uuid) TO authenticated;


CREATE FUNCTION public.guard_inquiry_selected_documents() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.is_inquiry AND (NEW.accepted_offer_id IS DISTINCT FROM OLD.accepted_offer_id OR NEW.accepted_calculation_id IS DISTINCT FROM OLD.accepted_calculation_id) AND coalesce(current_setting('mavinci.sales_decision',true),'')<>'yes' THEN RAISE EXCEPTION 'Użyj wyboru oferty lub kalkulacji w zapytaniu'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sales_selected_document_guard BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.guard_inquiry_selected_documents();
CREATE FUNCTION public.invalidate_offer_pricing_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.calculation_snapshot IS DISTINCT FROM OLD.calculation_snapshot OR NEW.pricing_source IS DISTINCT FROM OLD.pricing_source THEN NEW.modified_after_generation:=true; END IF; RETURN NEW; END $$;
CREATE TRIGGER zz_sales_offer_pricing_pdf BEFORE UPDATE ON public.offers FOR EACH ROW EXECUTE FUNCTION public.invalidate_offer_pricing_document();
GRANT SELECT ON public.inquiry_activity,public.inquiry_analyses,public.sales_document_files TO authenticated;


CREATE FUNCTION public.record_inquiry_delivery(p_inquiry uuid,p_delivery_key text,p_recipient text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Tylko usługa wysyłki'; END IF;
 IF EXISTS(SELECT 1 FROM public.inquiry_activity WHERE delivery_key=p_delivery_key) THEN RETURN; END IF;
 UPDATE public.tasks SET last_contact_at=now(),inquiry_stage=CASE WHEN inquiry_stage='new' THEN 'contacted' ELSE inquiry_stage END WHERE id=p_inquiry AND is_inquiry AND archived_at IS NULL;
 PERFORM public.sales_log(p_inquiry,'delivery','Wysłano wiadomość do klienta',jsonb_build_object('recipient',p_recipient),p_delivery_key);
END $$;
REVOKE ALL ON FUNCTION public.record_inquiry_delivery(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_inquiry_delivery(uuid,text,text) TO service_role;


-- Every content edit invalidates the PDF, but delivery/acceptance alone does not.
CREATE OR REPLACE FUNCTION public.mark_offer_modified() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ignored text[]:=ARRAY['updated_at','generated_pdf_url','generated_pdf_revision','last_generated_at','last_generated_by','modified_after_generation','content_revision','status','sent_at','accepted_at','accepted_by','acceptance_note','accepted_package_id','accepted_variant_selections','event_id','inquiry_id'];
BEGIN
 IF (to_jsonb(NEW)-ignored) IS DISTINCT FROM (to_jsonb(OLD)-ignored) THEN NEW.content_revision:=OLD.content_revision+1; END IF;
 IF NEW.content_revision IS DISTINCT FROM OLD.content_revision THEN NEW.modified_after_generation:=true; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.invalidate_offer_child_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE offer_uuid uuid; old_offer uuid; BEGIN
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'updated_at')=(to_jsonb(OLD)-'updated_at') THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='offer_package_items' THEN
 SELECT offer_id INTO offer_uuid FROM public.offer_packages WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.package_id ELSE NEW.package_id END;
 IF TG_OP='UPDATE' THEN SELECT offer_id INTO old_offer FROM public.offer_packages WHERE id=OLD.package_id; END IF;
 ELSE offer_uuid:=CASE WHEN TG_OP='DELETE' THEN OLD.offer_id ELSE NEW.offer_id END; IF TG_OP='UPDATE' THEN old_offer:=OLD.offer_id; END IF; END IF;
 UPDATE public.offers SET content_revision=content_revision+1,modified_after_generation=true WHERE id=offer_uuid OR id=old_offer;
 RETURN coalesce(NEW,OLD);
END $$;
DO $$ DECLARE tbl text; BEGIN FOREACH tbl IN ARRAY ARRAY['offer_items','offer_packages','offer_package_items','offer_equipment_substitutions'] LOOP
 EXECUTE format('CREATE TRIGGER sales_offer_child_revision AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.invalidate_offer_child_document()',tbl); END LOOP; END $$;
INSERT INTO public.sales_document_files(offer_id,inquiry_id,storage_bucket,storage_path) SELECT id,inquiry_id,'generated-offers',generated_pdf_url FROM public.offers WHERE generated_pdf_url IS NOT NULL ON CONFLICT DO NOTHING;
UPDATE public.offers SET modified_after_generation=true WHERE generated_pdf_url IS NOT NULL AND generated_pdf_revision IS NULL;


CREATE FUNCTION public.publish_calculation_pdf(p_calculation uuid,p_revision integer,p_path text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.event_calculations;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Tylko usługa generowania dokumentów'; END IF;
 SELECT * INTO STRICT c FROM public.event_calculations WHERE id=p_calculation FOR UPDATE;
 IF c.content_revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Kalkulacja zmieniła się podczas generowania'; END IF;
 INSERT INTO public.sales_document_files(calculation_id,inquiry_id,storage_bucket,storage_path,revision) VALUES(c.id,c.inquiry_id,'event-files',p_path,p_revision);
 UPDATE public.event_calculations SET generated_pdf_path=p_path,generated_pdf_revision=p_revision,generated_pdf_at=now() WHERE id=c.id;
END $$;
REVOKE ALL ON FUNCTION public.publish_calculation_pdf(uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_calculation_pdf(uuid,integer,text) TO service_role;


CREATE POLICY sales_calculation_insert_guard ON public.event_calculations AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(inquiry_id IS NULL OR public.sales_can_manage_document(inquiry_id,event_id,created_by));
CREATE FUNCTION public.track_inquiry_brief_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.is_inquiry AND NEW.inquiry_details IS DISTINCT FROM OLD.inquiry_details AND NEW.brief_revision=OLD.brief_revision THEN NEW.brief_revision:=OLD.brief_revision+1; END IF; RETURN NEW; END $$;
CREATE TRIGGER sales_brief_revision BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.track_inquiry_brief_revision();

GRANT ALL ON public.inquiry_activity,public.inquiry_analyses,public.sales_document_files TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
