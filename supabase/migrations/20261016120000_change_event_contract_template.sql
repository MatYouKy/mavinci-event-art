-- Zmiana szablonu zachowuje wysłany dokument jako osobny rekord.
CREATE OR REPLACE FUNCTION public.change_event_contract_template(
  p_event_id uuid, p_template_id uuid, p_expected_contract_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  current_contract public.contracts%ROWTYPE;
  result_id uuid;
  new_revision boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.can_manage_event_workflows(p_event_id), false)
    OR NOT coalesce(public.crm_contract_permission('manage'), false) THEN
    RAISE EXCEPTION 'Nie masz uprawnień do zmiany szablonu tej umowy.';
  END IF;
  -- Serializacja zmian szablonu i kontrola nieaktualnej karty przeglądarki.
  PERFORM 1 FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono wydarzenia.'; END IF;
  PERFORM 1 FROM public.contract_templates WHERE id = p_template_id AND is_active IS DISTINCT FROM false;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wybrany szablon nie jest dostępny.'; END IF;
  SELECT * INTO current_contract FROM public.contracts WHERE event_id = p_event_id
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF current_contract.id IS DISTINCT FROM p_expected_contract_id THEN
    RAISE EXCEPTION 'Umowa zmieniła się. Odśwież widok i wybierz szablon ponownie.';
  END IF;
  IF current_contract.status::text = 'cancelled' THEN
    RAISE EXCEPTION 'Nie można zmienić szablonu anulowanej umowy.';
  END IF;
  result_id := current_contract.id;
  IF current_contract.id IS NOT NULL AND current_contract.template_id IS DISTINCT FROM p_template_id THEN
    IF current_contract.status::text <> 'draft' OR current_contract.generated_pdf_path IS NOT NULL
      OR current_contract.locked_at IS NOT NULL THEN
      INSERT INTO public.contracts(event_id, client_id, offer_id, title, content, status,
        template_id, created_by, supersedes_contract_id)
      VALUES(p_event_id, current_contract.client_id, current_contract.offer_id,
        current_contract.title, '', 'draft', p_template_id,
        public.current_workflow_employee_id(), current_contract.id)
      RETURNING id INTO result_id;
      new_revision := true;
    ELSE
      UPDATE public.contracts SET template_id = p_template_id, content = '', modified_after_generation = true
      WHERE id = current_contract.id;
    END IF;
  END IF;
  UPDATE public.events SET selected_contract_template_id = p_template_id WHERE id = p_event_id;
  RETURN jsonb_build_object('contractId', result_id, 'createdRevision', new_revision);
END;
$$;
REVOKE ALL ON FUNCTION public.change_event_contract_template(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_event_contract_template(uuid, uuid, uuid) TO authenticated;
