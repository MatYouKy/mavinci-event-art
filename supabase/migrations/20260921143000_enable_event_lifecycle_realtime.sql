BEGIN;

-- Invoice/payment triggers project the financial state onto events. Publish
-- that update so open event details and lists can show it without a reload.
-- No historical events or invoices are changed and existing RLS stays intact.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.events'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Aktualizacje wydarzeń wymagają włączonych zasad dostępu RLS.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'Brak publikacji Supabase Realtime dla aktualizacji wydarzeń.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
  END IF;
END;
$migration$;

COMMIT;
