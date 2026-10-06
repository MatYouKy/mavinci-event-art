BEGIN;
INSERT INTO storage.buckets(id,name,public,file_size_limit)
VALUES ('mac-crm-sync','mac-crm-sync',false,52428800)
ON CONFLICT(id) DO UPDATE SET public=false, file_size_limit=EXCLUDED.file_size_limit;

CREATE TABLE public.mac_sync_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 year',
  revoked_at timestamptz
);
CREATE TABLE public.mac_sync_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  relative_path text NOT NULL,
  path_key text NOT NULL,
  storage_path text NOT NULL,
  sha256 text NOT NULL,
  file_size bigint NOT NULL CHECK(file_size > 0 AND file_size <= 52428800),
  mime_type text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  UNIQUE(event_id,path_key)
);
CREATE INDEX mac_sync_bindings_event_idx ON public.mac_sync_bindings(event_id);
CREATE INDEX mac_sync_bindings_employee_idx ON public.mac_sync_bindings(employee_id);
CREATE TABLE public.mac_sync_file_versions (
  file_id uuid NOT NULL REFERENCES public.mac_sync_files(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  storage_path text NOT NULL UNIQUE,
  sha256 text NOT NULL,
  uploaded_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(file_id,revision)
);
ALTER TABLE public.mac_sync_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mac_sync_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mac_sync_file_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mac_sync_bindings,public.mac_sync_files,public.mac_sync_file_versions FROM anon,authenticated;
GRANT ALL ON public.mac_sync_bindings,public.mac_sync_files,public.mac_sync_file_versions TO service_role;

CREATE FUNCTION public.commit_mac_sync_file(
  p_event_id uuid, p_employee_id uuid, p_path text, p_storage_path text,
  p_sha256 text, p_size bigint, p_mime text, p_expected_revision integer
) RETURNS public.mac_sync_files
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_file public.mac_sync_files%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR NOT EXISTS (
    SELECT 1 FROM public.employees WHERE id=p_employee_id AND is_active=true
      AND (role='admin' OR access_level='admin')
  ) THEN RAISE EXCEPTION 'Brak uprawnień.' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || lower(p_path),0));
  SELECT * INTO v_file FROM public.mac_sync_files
    WHERE event_id=p_event_id AND path_key=lower(p_path) FOR UPDATE;
  IF FOUND THEN
    IF v_file.sha256=p_sha256 THEN RETURN v_file; END IF;
    IF v_file.revision<>p_expected_revision THEN
      RAISE EXCEPTION 'Konflikt wersji pliku.' USING ERRCODE='40001';
    END IF;
    UPDATE public.mac_sync_files SET storage_path=p_storage_path,sha256=p_sha256,
      file_size=p_size,mime_type=p_mime,revision=revision+1,updated_at=now(),uploaded_by=p_employee_id
      WHERE id=v_file.id RETURNING * INTO v_file;
  ELSE
    IF p_expected_revision<>0 THEN RAISE EXCEPTION 'Konflikt wersji pliku.' USING ERRCODE='40001'; END IF;
    INSERT INTO public.mac_sync_files(event_id,relative_path,path_key,storage_path,sha256,file_size,mime_type,uploaded_by)
      VALUES(p_event_id,p_path,lower(p_path),p_storage_path,p_sha256,p_size,p_mime,p_employee_id)
      RETURNING * INTO v_file;
  END IF;
  INSERT INTO public.mac_sync_file_versions(file_id,revision,storage_path,sha256,uploaded_by)
    VALUES(v_file.id,v_file.revision,v_file.storage_path,v_file.sha256,p_employee_id);
  RETURN v_file;
END;
$$;
REVOKE ALL ON FUNCTION public.commit_mac_sync_file(uuid,uuid,text,text,text,bigint,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_mac_sync_file(uuid,uuid,text,text,text,bigint,text,integer) TO service_role;
COMMIT;
