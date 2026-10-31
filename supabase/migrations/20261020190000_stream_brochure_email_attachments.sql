BEGIN;

-- One transport claim per explicitly initiated attempt. Existing uncertain
-- deliveries are intentionally NOT reset or sent again by this migration.
ALTER TABLE public.sales_brochure_deliveries
  ADD COLUMN IF NOT EXISTS dispatch_token uuid,
  ADD COLUMN IF NOT EXISTS transport_started_at timestamptz;

COMMENT ON COLUMN public.sales_brochure_deliveries.dispatch_token IS
  'Identyfikator próby nadany przez serwer CRM; chroni przed spóźnioną odpowiedzią poprzedniej próby.';
COMMENT ON COLUMN public.sales_brochure_deliveries.transport_started_at IS
  'Jednorazowe przejęcie próby przez usługę pocztową; ponowne wywołanie nie wysyła duplikatu.';

-- Archive the exact PDF in Wysłane using a server-side Storage copy, without
-- loading it into Edge memory. Do not lower an existing larger/unlimited limit.
UPDATE storage.buckets SET file_size_limit = 52428800
WHERE id = 'email-attachments'
  AND file_size_limit IS NOT NULL AND file_size_limit < 52428800;

COMMIT;
