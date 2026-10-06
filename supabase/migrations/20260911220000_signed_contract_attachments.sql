BEGIN;

-- Signed originals are private and independent of regenerable contract PDFs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('signed-contracts', 'signed-contracts', false, 20971520,
  ARRAY['application/pdf', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE public.contract_signed_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT,
  storage_path text NOT NULL UNIQUE,
  original_name text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 20971520),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
  uploaded_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contract_signed_files_contract_idx ON public.contract_signed_files(contract_id, created_at DESC);
ALTER TABLE public.contract_signed_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_signed_files FROM anon, authenticated;
GRANT SELECT, INSERT ON public.contract_signed_files TO service_role;
-- No public storage policies. The authenticated CRM endpoint checks contract access
-- before issuing a short-lived download link using the server's service role.

CREATE FUNCTION public.require_signed_contract_for_attachment()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_contract public.contracts%ROWTYPE;
BEGIN
  SELECT * INTO v_contract FROM public.contracts WHERE id = NEW.contract_id FOR UPDATE;
  IF NOT FOUND OR v_contract.status::text NOT IN ('signed_by_client', 'signed_returned')
    OR v_contract.company_signed_at IS NULL THEN
    RAISE EXCEPTION 'Najpierw potwierdź podpisy obu stron umowy.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER require_signed_contract_for_attachment_trigger
  BEFORE INSERT ON public.contract_signed_files
  FOR EACH ROW EXECUTE FUNCTION public.require_signed_contract_for_attachment();

COMMIT;
