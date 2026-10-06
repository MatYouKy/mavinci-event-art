BEGIN;

-- The public bucket itself is deliberately unchanged: this migration closes
-- metadata/listing and mutation paths, not existing public customer download
-- URLs. Moving historical invoice PDFs to private storage is a separate change.
CREATE OR REPLACE FUNCTION public.invoice_event_storage_path(p_path text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT nullif(split_part(regexp_replace(btrim(coalesce(p_path, '')),
    '^https?://[^/]+/storage/v1/object/(public|sign)/event-files/', '', 'i'), '?', 1), '');
$$;

CREATE OR REPLACE FUNCTION public.sales_finance_file_access(
  p_path text, p_document_type text DEFAULT NULL, p_write boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE path text := public.invoice_event_storage_path(p_path); is_invoice boolean;
BEGIN
  IF public.invoice_finance_scope() <> 'sales' THEN RETURN true; END IF;
  IF path IS NULL THEN RETURN false; END IF;
  -- Classification inspects all canonical references, not only rows visible to
  -- the caller. Reclassifying another invoice as an ordinary attachment cannot
  -- open its storage object. Generated orphan invoices fail closed as well.
  is_invoice := coalesce(p_document_type, '') ~* '(invoice|proforma)'
    OR path LIKE 'invoices/%' OR path LIKE '%/documents/faktury/%'
    OR EXISTS (SELECT 1 FROM public.invoices i WHERE public.invoice_event_storage_path(i.pdf_url) = path)
    OR EXISTS (SELECT 1 FROM public.event_files f
      WHERE (public.invoice_event_storage_path(f.file_path) = path OR public.invoice_event_storage_path(f.file_url) = path)
        AND coalesce(f.document_type, '') ~* '(invoice|proforma)');
  IF NOT is_invoice THEN RETURN true; END IF;
  -- All generated invoice files are written via the authenticated server
  -- generator, never overwritten/deleted by a direct storage client request.
  IF p_write THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.invoices i
      WHERE public.invoice_event_storage_path(i.pdf_url) = path AND public.can_view_invoice(i.id))
    AND NOT EXISTS (SELECT 1 FROM public.invoices i
      WHERE public.invoice_event_storage_path(i.pdf_url) = path AND NOT public.can_view_invoice(i.id));
END; $$;

CREATE OR REPLACE FUNCTION public.guard_sales_invoice_pdf_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF public.invoice_finance_scope() <> 'sales' OR auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF (TG_OP = 'INSERT' AND nullif(btrim(NEW.pdf_url), '') IS NOT NULL)
    OR (TG_OP = 'UPDATE' AND NEW.pdf_url IS DISTINCT FROM OLD.pdf_url) THEN
    RAISE EXCEPTION 'Plik faktury zapisuje generator PDF. Nie można ręcznie zmieniać jego odnośnika.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER zzzz_guard_sales_invoice_pdf_reference BEFORE INSERT OR UPDATE OF pdf_url ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_sales_invoice_pdf_reference();

CREATE POLICY event_files_sales_invoice_read_guard ON public.event_files AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.sales_finance_file_access(coalesce(nullif(file_path, ''), file_url), document_type, false)
    AND (nullif(file_url, '') IS NULL OR public.sales_finance_file_access(file_url, document_type, false)));
CREATE POLICY event_files_sales_own_invoice_read ON public.event_files FOR SELECT TO authenticated
  USING (public.invoice_finance_scope() = 'sales' AND document_type = 'invoice'
    AND public.sales_finance_file_access(coalesce(nullif(file_path, ''), file_url), document_type, false));
CREATE POLICY event_files_sales_invoice_insert_guard ON public.event_files AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.sales_finance_file_access(coalesce(nullif(file_path, ''), file_url), document_type, true)
    AND (nullif(file_url, '') IS NULL OR public.sales_finance_file_access(file_url, document_type, true)));
CREATE POLICY event_files_sales_invoice_update_guard ON public.event_files AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.sales_finance_file_access(coalesce(nullif(file_path, ''), file_url), document_type, true)
    AND (nullif(file_url, '') IS NULL OR public.sales_finance_file_access(file_url, document_type, true)))
  WITH CHECK (public.sales_finance_file_access(coalesce(nullif(file_path, ''), file_url), document_type, true)
    AND (nullif(file_url, '') IS NULL OR public.sales_finance_file_access(file_url, document_type, true)));
CREATE POLICY event_files_sales_invoice_delete_guard ON public.event_files AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.sales_finance_file_access(coalesce(nullif(file_path, ''), file_url), document_type, true)
    AND (nullif(file_url, '') IS NULL OR public.sales_finance_file_access(file_url, document_type, true)));

-- Public GET links keep working because the bucket remains public. Anonymous
-- clients must not enumerate object names/metadata via the old public policy.
CREATE POLICY event_files_listing_requires_login ON storage.objects AS RESTRICTIVE FOR SELECT TO public
  USING (bucket_id <> 'event-files' OR auth.uid() IS NOT NULL);

CREATE POLICY event_files_sales_storage_read_guard ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (bucket_id <> 'event-files' OR public.invoice_finance_scope() <> 'sales' OR (
    public.sales_finance_file_access(name, NULL, false) AND (
      -- These subqueries remain invoker queries: operational files must still
      -- satisfy their original event/folder visibility policy.
      EXISTS (SELECT 1 FROM public.event_files f
        WHERE public.invoice_event_storage_path(f.file_path) = name OR public.invoice_event_storage_path(f.file_url) = name)
      OR EXISTS (SELECT 1 FROM public.invoices i
        WHERE public.invoice_event_storage_path(i.pdf_url) = name AND public.can_view_invoice(i.id))
    )
  ));
CREATE POLICY event_files_sales_storage_insert_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'event-files' OR public.sales_finance_file_access(name, NULL, true));
CREATE POLICY event_files_sales_storage_update_guard ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'event-files' OR public.sales_finance_file_access(name, NULL, true))
  WITH CHECK (bucket_id <> 'event-files' OR public.sales_finance_file_access(name, NULL, true));
CREATE POLICY event_files_sales_storage_delete_guard ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'event-files' OR public.sales_finance_file_access(name, NULL, true));

REVOKE ALL ON FUNCTION public.invoice_event_storage_path(text),
  public.sales_finance_file_access(text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_event_storage_path(text),
  public.sales_finance_file_access(text,text,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_sales_invoice_pdf_reference() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
