BEGIN;
CREATE OR REPLACE FUNCTION public.delete_personnel_contract_draft(p_id uuid,p_updated_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE draft public.personnel_contracts;
BEGIN
 IF NOT public.personnel_can_access(true) THEN RAISE EXCEPTION 'Brak uprawnień do usuwania szkiców umów.' USING ERRCODE='42501'; END IF;
 SELECT * INTO draft FROM public.personnel_contracts WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Szkic nie istnieje lub nie masz do niego dostępu.'; END IF;
 IF draft.status <> 'draft' THEN RAISE EXCEPTION 'Można usunąć wyłącznie szkic umowy.'; END IF;
 IF draft.updated_at IS DISTINCT FROM p_updated_at THEN RAISE EXCEPTION 'Szkic został zmieniony. Odśwież listę przed usunięciem.'; END IF;
 IF EXISTS(SELECT 1 FROM public.personnel_contract_payments WHERE personnel_contract_id=p_id) THEN RAISE EXCEPTION 'Szkic ma zapisane płatności i nie może zostać usunięty.'; END IF;
 DELETE FROM public.personnel_contracts WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Brak uprawnień do usunięcia szkicu.'; END IF;
EXCEPTION WHEN foreign_key_violation THEN
 RAISE EXCEPTION 'Szkic ma powiązane dokumenty, stawki lub rozliczenia i nie może zostać usunięty.';
END $$;
REVOKE ALL ON FUNCTION public.delete_personnel_contract_draft(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_personnel_contract_draft(uuid,timestamptz) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
