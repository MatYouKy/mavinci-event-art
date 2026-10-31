BEGIN;

-- Prywatność poczty: pracownik widzi wyłącznie korespondencję swoich skrzynek (własnej
-- i przypisanych), jak w programie pocztowym. Wszystkie skrzynki: administrator / messages_manage.
-- Sama treść wiadomości (received_emails, sent_emails) była już odseparowana; ta migracja
-- domyka to, co jest wokół niej:
--  1. Załączniki: lista tylko dla wiadomości, które użytkownik widzi; zapis i usuwanie wyłącznie
--     przez serwer. Pliki w Storage czytelne dla tych samych osób — bucket „email-attachments”
--     nie miał żadnej reguły odczytu, więc pobieranie załącznika w przeglądarce nie działało.
--  2. Wiadomości zapisuje wyłącznie serwer (synchronizacja, wysyłka): zalogowany użytkownik
--     nie podrzuci wiadomości do cudzej skrzynki.
--  3. Podsumowania AI rozmów handlowych tylko dla osób z dostępem do danej skrzynki
--     (wcześniej każdy z messages_view widział rozmowy ze wszystkich skrzynek wspólnych).
--  4. Nieużywane funkcje kont pocztowych bez kontroli dostępu — bez wywołania z API
--     (add_email_account działało nawet bez logowania: można było podpiąć cudzy serwer SMTP
--     jako domyślną skrzynkę pracownika).

-- 1. Załączniki ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view all attachments" ON public.email_attachments;
DROP POLICY IF EXISTS "Authenticated users can insert attachments" ON public.email_attachments;
DROP POLICY IF EXISTS "Authenticated users can delete attachments" ON public.email_attachments;
DROP POLICY IF EXISTS email_attachments_visible_mailbox ON public.email_attachments;
-- Podzapytania działają z uprawnieniami użytkownika, więc obowiązują reguły skrzynek.
CREATE POLICY email_attachments_visible_mailbox ON public.email_attachments FOR SELECT TO authenticated
  USING (
    (email_type = 'received' AND EXISTS (SELECT 1 FROM public.received_emails e WHERE e.id = email_attachments.email_id))
    OR (email_type = 'sent' AND EXISTS (SELECT 1 FROM public.sent_emails e WHERE e.id = email_attachments.email_id))
    OR (email_type = 'contact_form' AND EXISTS (SELECT 1 FROM public.contact_messages m WHERE m.id = email_attachments.email_id))
  );
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.email_attachments FROM anon, authenticated;
REVOKE SELECT ON public.email_attachments FROM anon;
CREATE INDEX IF NOT EXISTS idx_email_attachments_storage_path ON public.email_attachments (storage_path);

DROP POLICY IF EXISTS email_attachments_files_read ON storage.objects;
CREATE POLICY email_attachments_files_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'email-attachments'
    AND EXISTS (SELECT 1 FROM public.email_attachments a WHERE a.storage_path = objects.name));

-- 2. Zapis wiadomości tylko przez serwer -----------------------------------------------------
DROP POLICY IF EXISTS "System can insert received emails" ON public.received_emails;
DROP POLICY IF EXISTS "System can insert sent emails" ON public.sent_emails;
REVOKE INSERT, TRUNCATE ON public.received_emails, public.sent_emails FROM anon, authenticated;

-- 3. Kontekst sprzedażowy AI: tylko skrzynki, do których pracownik ma dostęp -------------------
CREATE OR REPLACE FUNCTION public.can_view_email_sales_context(account_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE employee.id = auth.uid() AND employee.is_active = true
      AND (
        employee.role = 'admin' OR employee.access_level = 'admin'
        OR coalesce(employee.permissions, '{}'::text[]) && ARRAY['admin', 'messages_manage']::text[]
        OR EXISTS (
          SELECT 1 FROM public.employee_email_accounts account
          WHERE account.id = account_id AND account.is_active AND account.employee_id = employee.id)
        OR EXISTS (
          SELECT 1 FROM public.employee_email_account_assignments assignment
          JOIN public.employee_email_accounts account ON account.id = assignment.email_account_id
          WHERE assignment.email_account_id = account_id AND account.is_active
            AND assignment.employee_id = employee.id)
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_view_email_sales_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_email_sales_context(uuid) TO authenticated, service_role;

-- 4. Nieużywane funkcje z identyfikatorem pracownika podawanym przez wywołującego -------------
REVOKE ALL ON FUNCTION public.add_email_account(uuid, text, text, text, text, integer, text, text, boolean,
  text, integer, text, text, boolean, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_employee_email_accounts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_email_account_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.user_has_email_account_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_email_account(uuid, text, text, text, text, integer, text, text, boolean,
  text, integer, text, text, boolean, text, boolean, boolean), public.get_employee_email_accounts(uuid),
  public.has_email_account_access(uuid, uuid), public.user_has_email_account_access(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
