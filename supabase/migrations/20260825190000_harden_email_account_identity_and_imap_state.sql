-- Reliable company-aware signatures and IMAP read-state synchronization.

ALTER TABLE public.employee_email_accounts
  ADD COLUMN IF NOT EXISTS my_company_id uuid
    REFERENCES public.my_companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employee_email_accounts_company
  ON public.employee_email_accounts(my_company_id)
  WHERE my_company_id IS NOT NULL;

-- Prefer an exact mailbox/company address match.
UPDATE public.employee_email_accounts account
SET my_company_id = company.id
FROM public.my_companies company
WHERE account.my_company_id IS NULL
  AND lower(trim(account.email_address)) = lower(trim(company.email));

-- For the remaining accounts use the company email domain. The default
-- company wins only when more than one company uses the same domain.
UPDATE public.employee_email_accounts account
SET my_company_id = (
  SELECT company.id
  FROM public.my_companies company
  WHERE company.is_active = true
    AND split_part(lower(trim(company.email)), '@', 2) =
        split_part(lower(trim(account.email_address)), '@', 2)
  ORDER BY company.is_default DESC NULLS LAST, company.created_at ASC
  LIMIT 1
)
WHERE account.my_company_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.my_companies company
    WHERE company.is_active = true
      AND split_part(lower(trim(company.email)), '@', 2) =
          split_part(lower(trim(account.email_address)), '@', 2)
  );

ALTER TABLE public.received_emails
  ADD COLUMN IF NOT EXISTS imap_uid bigint,
  ADD COLUMN IF NOT EXISTS imap_uidvalidity text,
  ADD COLUMN IF NOT EXISTS imap_mailbox text NOT NULL DEFAULT 'INBOX',
  ADD COLUMN IF NOT EXISTS imap_flags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS imap_synced_at timestamptz;

ALTER TABLE public.sent_emails
  ADD COLUMN IF NOT EXISTS in_reply_to text,
  ADD COLUMN IF NOT EXISTS email_references text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_received_emails_imap_identity
  ON public.received_emails(email_account_id, imap_mailbox, imap_uidvalidity, imap_uid)
  WHERE imap_uid IS NOT NULL;

COMMENT ON COLUMN public.employee_email_accounts.my_company_id IS
  'Firma/marka używana do wyboru nadawcy, logo, szablonu i stopki wiadomości.';
COMMENT ON COLUMN public.received_emails.imap_uid IS
  'Trwały identyfikator wiadomości w obrębie skrzynki i UIDVALIDITY.';
COMMENT ON COLUMN public.received_emails.imap_uidvalidity IS
  'UIDVALIDITY skrzynki IMAP używane do bezpiecznej synchronizacji UID.';
COMMENT ON COLUMN public.received_emails.imap_mailbox IS
  'Folder IMAP, domyślnie INBOX.';
COMMENT ON COLUMN public.sent_emails.email_references IS
  'Łańcuch nagłówków References zachowujący ciągłość wątku wiadomości.';
