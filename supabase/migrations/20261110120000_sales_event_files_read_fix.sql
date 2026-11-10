-- Pliki wydarzeń dla sprzedawców (zakres finansów „Własna sprzedaż”): naprawa odczytu
-- ===============================================================================================================
-- Można uruchomić ponownie.
--
-- Błąd: sprzedawca nie mógł wysłać wygenerowanej umowy — {"statusCode":"404","error":"not_found",
-- "message":"Object not found","code":"NoSuchKey"} przy tworzeniu linku do PDF-u. Tak samo nie otwierał się
-- żaden inny plik z zasobnika event-files (pliki wydarzenia, oferty PDF, checklisty, załączniki zadań).
-- Przyczyna: w regule event_files_sales_storage_read_guard (20260926200000_scope_sales_finance_files.sql)
-- niekwalifikowane „name” w podzapytaniu do event_files wskazywało kolumnę event_files.name (nazwę pliku),
-- a nie ścieżkę obiektu w storage.objects. Warunek nigdy nie był spełniony, więc osoby z zakresem „sales”
-- nie widziały żadnego pliku poza fakturami.
-- Poprawka: ścieżka obiektu jest kwalifikowana (objects.name), a plik musi być wskazany przez rekord, który
-- pracownik widzi (RLS tych tabel działa jak dotąd): plik wydarzenia, umowa (PDF), dokument sprzedażowy,
-- agenda, kalkulacja, checklista sprzętu, załącznik zadania; zdjęcia zwrotu sprzętu — gdy widzi wydarzenie;
-- foldery zadań i zapytań — jak dla pozostałych pracowników. Faktury bez zmian: tylko te, które może oglądać
-- (sales_finance_file_access + can_view_invoice).

-- Funkcja działa z uprawnieniami pracownika (bez SECURITY DEFINER): sprawdza tylko rekordy, które widzi.
CREATE OR REPLACE FUNCTION public.event_files_object_referenced(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT p_name IS NOT NULL AND (
    (storage.foldername(p_name))[1] IN ('task-attachments', 'task-thumbnails', 'inquiries')
    OR EXISTS (SELECT 1 FROM public.event_files f
               WHERE p_name IN (public.invoice_event_storage_path(f.file_path),
                                public.invoice_event_storage_path(f.file_url),
                                public.invoice_event_storage_path(f.thumbnail_url)))
    OR EXISTS (SELECT 1 FROM public.contracts c
               WHERE public.invoice_event_storage_path(c.generated_pdf_path) = p_name)
    OR EXISTS (SELECT 1 FROM public.sales_document_files d
               WHERE public.invoice_event_storage_path(d.storage_path) = p_name)
    OR EXISTS (SELECT 1 FROM public.event_agendas a
               WHERE public.invoice_event_storage_path(a.generated_pdf_path) = p_name)
    OR EXISTS (SELECT 1 FROM public.event_calculations k
               WHERE public.invoice_event_storage_path(k.generated_pdf_path) = p_name)
    OR EXISTS (SELECT 1 FROM public.events e
               WHERE public.invoice_event_storage_path(e.equipment_checklist_pdf_path) = p_name)
    OR EXISTS (SELECT 1 FROM public.task_attachments ta
               WHERE public.invoice_event_storage_path(ta.file_url) = p_name)
    OR (p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/equipment-return/'
        AND EXISTS (SELECT 1 FROM public.events e WHERE e.id::text = lower(split_part(p_name, '/', 1))))
  );
$$;

COMMENT ON FUNCTION public.event_files_object_referenced(text) IS
  'Czy obiekt z event-files jest wskazany przez rekord widoczny dla pracownika (reguła odczytu dla zakresu „sales”).';

DROP POLICY IF EXISTS event_files_sales_storage_read_guard ON storage.objects;
CREATE POLICY event_files_sales_storage_read_guard ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    bucket_id <> 'event-files'
    OR public.invoice_finance_scope() <> 'sales'
    OR (
      public.sales_finance_file_access(objects.name, NULL, false)
      AND (
        public.event_files_object_referenced(objects.name)
        OR EXISTS (SELECT 1 FROM public.invoices i
                   WHERE public.invoice_event_storage_path(i.pdf_url) = objects.name
                     AND public.can_view_invoice(i.id))
      )
    )
  );
