-- Transport acceptance and archiving are independent: never resend after an archive failure.
ALTER TABLE public.sent_emails
  ADD COLUMN IF NOT EXISTS has_attachments boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_archive jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.sent_emails.delivery_archive IS
  'Archive results: sentCopy (IMAP), attachments (expected/saved/status). Empty for historical messages with unknown archive state.';

UPDATE public.sent_emails e SET has_attachments = true
WHERE NOT e.has_attachments AND EXISTS (
  SELECT 1 FROM public.email_attachments a WHERE a.email_type = 'sent' AND a.email_id = e.id
);
