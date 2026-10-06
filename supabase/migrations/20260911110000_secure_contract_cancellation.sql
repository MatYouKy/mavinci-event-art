BEGIN;

-- Cancellation keeps the document, files, versions and an immutable audit entry.
CREATE TABLE IF NOT EXISTS public.contract_cancellation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT,
  cancelled_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  previous_status text NOT NULL,
  cancelled_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.contract_cancellation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_cancellation_audit FROM anon, authenticated;
GRANT SELECT ON public.contract_cancellation_audit TO authenticated;
GRANT ALL ON public.contract_cancellation_audit TO service_role;
CREATE POLICY "Admins can read contract cancellations"
  ON public.contract_cancellation_audit FOR SELECT TO authenticated
  USING (public.is_crm_admin());

CREATE OR REPLACE FUNCTION public.guard_contract_cancellation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.role() IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Umów nie usuwamy. Użyj zabezpieczonego anulowania przez administratora.' USING ERRCODE = '42501';
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status
      AND (NEW.status::text = 'cancelled' OR OLD.status::text = 'cancelled') THEN
      RAISE EXCEPTION 'Anulowanie umowy wymaga weryfikacji hasła administratora po stronie serwera.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_contract_cancellation_trigger
  BEFORE UPDATE OR DELETE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.guard_contract_cancellation();

-- Only the server may call this, AFTER verifying the current admin's password.
-- Passwords and authentication tokens never enter this function or the audit table.
CREATE OR REPLACE FUNCTION public.cancel_event_contract_verified(
  p_contract_id uuid, p_event_id uuid, p_employee_id uuid, p_expected_status text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_contract public.contracts%ROWTYPE;
  v_cancelled_at timestamptz := now();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Operacja dostępna wyłącznie po weryfikacji na serwerze.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.employees WHERE id = p_employee_id AND is_active = true
      AND (role = 'admin' OR access_level = 'admin')
  ) THEN
    RAISE EXCEPTION 'Brak uprawnień administratora.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_contract FROM public.contracts
    WHERE id = p_contract_id AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono umowy.' USING ERRCODE = 'P0002'; END IF;
  IF v_contract.status::text = 'cancelled' THEN RETURN; END IF;
  IF v_contract.status::text IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'Status umowy uległ zmianie.' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.contract_cancellation_audit(contract_id, cancelled_by, previous_status, cancelled_at)
    VALUES (v_contract.id, p_employee_id, v_contract.status::text, v_cancelled_at);
  UPDATE public.contracts SET status = 'cancelled', cancelled_at = v_cancelled_at
    WHERE id = v_contract.id;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_event_contract_verified(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_event_contract_verified(uuid,uuid,uuid,text) TO service_role;

COMMIT;
