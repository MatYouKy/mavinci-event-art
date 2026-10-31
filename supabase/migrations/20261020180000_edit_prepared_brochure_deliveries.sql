BEGIN;

-- Existing prepared messages remain editable without replacing their PDF or
-- creating another delivery. Revision guards concurrent editing and sending.
ALTER TABLE public.sales_brochure_deliveries
  ADD COLUMN IF NOT EXISTS draft_revision integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.guard_brochure_delivery_draft()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF ROW(NEW.subject, NEW.body_html, NEW.email_account_id, NEW.recipient_email)
    IS DISTINCT FROM ROW(OLD.subject, OLD.body_html, OLD.email_account_id, OLD.recipient_email) THEN
    IF OLD.status NOT IN ('prepared', 'failed') OR NEW.status NOT IN ('prepared', 'failed') THEN
      RAISE EXCEPTION 'Nie można edytować wiadomości wysłanej, wysyłanej ani z niepewnym wynikiem wysyłki';
    END IF;
    NEW.draft_revision := OLD.draft_revision + 1;
  ELSE
    NEW.draft_revision := OLD.draft_revision;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_brochure_delivery_draft ON public.sales_brochure_deliveries;
CREATE TRIGGER guard_brochure_delivery_draft
  BEFORE UPDATE ON public.sales_brochure_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.guard_brochure_delivery_draft();

COMMENT ON COLUMN public.sales_brochure_deliveries.draft_revision IS
  'Wersja treści, tematu, odbiorcy i nadawcy. Zapis i wysyłka wymagają wersji sprawdzonej przez użytkownika.';

COMMIT;
