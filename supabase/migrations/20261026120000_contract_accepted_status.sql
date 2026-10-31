ALTER TYPE public.contract_status ADD VALUE IF NOT EXISTS 'accepted';
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
CREATE OR REPLACE FUNCTION public.record_contract_acceptance() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status::text = 'accepted' THEN
    NEW.accepted_at := COALESCE(NEW.accepted_at, now());
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS record_contract_acceptance ON public.contracts;
CREATE TRIGGER record_contract_acceptance BEFORE INSERT OR UPDATE OF status ON public.contracts
FOR EACH ROW EXECUTE FUNCTION public.record_contract_acceptance();
