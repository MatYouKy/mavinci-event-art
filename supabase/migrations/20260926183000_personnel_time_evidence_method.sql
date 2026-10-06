BEGIN;

-- Keep existing free-text terms and immutable documents unchanged until an
-- explicit method is chosen. The PDF generator already uses time_evidence.
CREATE FUNCTION public.normalize_personnel_time_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE method text; linked_employee uuid;
BEGIN
  method := NEW.document_details->>'time_evidence_method';
  IF method IS NULL THEN RETURN NEW; END IF;
  IF method NOT IN ('crm','task','other') THEN RAISE EXCEPTION 'Wybierz prawidłowy sposób potwierdzania godzin'; END IF;
  IF NEW.contract_kind <> 'mandate' THEN RETURN NEW; END IF;
  IF method='crm' THEN
    NEW.document_details := jsonb_set(NEW.document_details,'{time_evidence}',to_jsonb('System CRM — raportowanie własnego czasu pracy.'::text));
    linked_employee := NEW.employee_id;
    IF NEW.person_id IS NOT NULL THEN SELECT employee_id INTO linked_employee FROM public.personnel_people WHERE id=NEW.person_id; END IF;
    IF linked_employee IS NULL AND NEW.status<>'draft' THEN RAISE EXCEPTION 'System CRM wymaga powiązania osoby z kontem pracownika'; END IF;
  ELSIF method='task' THEN
    NEW.document_details := jsonb_set(NEW.document_details,'{time_evidence}',to_jsonb('Zadanie — raportowanie czasu pracy przy przypisanych zadaniach.'::text));
  ELSIF nullif(btrim(NEW.document_details->>'time_evidence'),'') IS NULL AND NEW.status<>'draft' THEN
    RAISE EXCEPTION 'Opisz inny sposób potwierdzania godzin';
  END IF;
  RETURN NEW;
END;
$$;
-- Normalize before the existing immutable-document guard compares the terms.
CREATE TRIGGER a_personnel_time_evidence
BEFORE INSERT OR UPDATE OF document_details,contract_kind,person_id,employee_id,status ON public.personnel_contracts
FOR EACH ROW EXECUTE FUNCTION public.normalize_personnel_time_evidence();

-- An explicit CRM method grants only access to the employee's own time entries.
-- Existing broader permissions are preserved. Never grant time_tracking_view:
-- the legacy RLS policy for that scope permits reading everybody's entries.
CREATE FUNCTION public.grant_personnel_crm_time_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE linked_employee uuid;
BEGIN
  IF NEW.contract_kind<>'mandate' OR NEW.document_details->>'time_evidence_method' IS DISTINCT FROM 'crm' THEN RETURN NEW; END IF;
  linked_employee := NEW.employee_id;
  IF NEW.person_id IS NOT NULL THEN SELECT employee_id INTO linked_employee FROM public.personnel_people WHERE id=NEW.person_id; END IF;
  UPDATE public.employees SET permissions=array_append(coalesce(permissions,'{}'::text[]),'time_tracking_view_own')
    WHERE id=linked_employee AND NOT 'time_tracking_view_own'=ANY(coalesce(permissions,'{}'::text[]));
  RETURN NEW;
END;
$$;
CREATE TRIGGER personnel_crm_time_access
AFTER INSERT OR UPDATE OF document_details,contract_kind,person_id,employee_id ON public.personnel_contracts
FOR EACH ROW EXECUTE FUNCTION public.grant_personnel_crm_time_access();

-- A draft can be written before a collaborator is linked to a CRM account.
CREATE FUNCTION public.grant_linked_personnel_crm_time_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.employee_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.personnel_contracts c WHERE c.person_id=NEW.id
      AND c.contract_kind='mandate' AND c.document_details->>'time_evidence_method'='crm'
  ) THEN
    UPDATE public.employees SET permissions=array_append(coalesce(permissions,'{}'::text[]),'time_tracking_view_own')
      WHERE id=NEW.employee_id AND NOT 'time_tracking_view_own'=ANY(coalesce(permissions,'{}'::text[]));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER personnel_linked_crm_time_access AFTER UPDATE OF employee_id ON public.personnel_people
FOR EACH ROW WHEN (NEW.employee_id IS DISTINCT FROM OLD.employee_id)
EXECUTE FUNCTION public.grant_linked_personnel_crm_time_access();

-- Support both employee IDs and separate Auth IDs without expanding access.
CREATE FUNCTION public.personnel_can_report_own_time(p_employee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (SELECT 1 FROM public.employees e WHERE e.id=p_employee AND e.is_active
    AND (e.id=auth.uid() OR e.auth_user_id=auth.uid())
    AND 'time_tracking_view_own'=ANY(coalesce(e.permissions,'{}'::text[])));
$$;
REVOKE ALL ON FUNCTION public.personnel_can_report_own_time(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.personnel_can_report_own_time(uuid) TO authenticated;
CREATE POLICY personnel_crm_own_time ON public.time_entries FOR ALL TO authenticated
USING(public.personnel_can_report_own_time(employee_id))
WITH CHECK(public.personnel_can_report_own_time(employee_id));
REVOKE ALL ON FUNCTION public.normalize_personnel_time_evidence(),public.grant_personnel_crm_time_access(),public.grant_linked_personnel_crm_time_access() FROM PUBLIC,anon,authenticated;

-- A draft may remain incomplete, but an immutable PDF must not silently use
-- the legacy fallback when the explicitly selected method is incomplete.
CREATE FUNCTION public.validate_personnel_time_evidence_document()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE c public.personnel_contracts; method text; linked_employee uuid;
BEGIN
  SELECT * INTO STRICT c FROM public.personnel_contracts WHERE id=NEW.contract_id;
  IF c.contract_kind<>'mandate' THEN RETURN NEW; END IF;
  method:=c.document_details->>'time_evidence_method';
  IF method='other' AND nullif(btrim(c.document_details->>'time_evidence'),'') IS NULL THEN
    RAISE EXCEPTION 'Opisz inny sposób potwierdzania godzin przed utrwaleniem dokumentu';
  ELSIF method='crm' THEN
    linked_employee:=c.employee_id;
    IF c.person_id IS NOT NULL THEN SELECT employee_id INTO linked_employee FROM public.personnel_people WHERE id=c.person_id; END IF;
    IF linked_employee IS NULL THEN RAISE EXCEPTION 'System CRM wymaga powiązania osoby z kontem pracownika przed utrwaleniem dokumentu'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER personnel_document_time_evidence BEFORE INSERT ON public.personnel_contract_documents
FOR EACH ROW EXECUTE FUNCTION public.validate_personnel_time_evidence_document();
REVOKE ALL ON FUNCTION public.validate_personnel_time_evidence_document() FROM PUBLIC,anon,authenticated;
COMMIT;
