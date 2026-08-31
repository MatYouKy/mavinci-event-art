ALTER TABLE public.my_companies
  ADD COLUMN IF NOT EXISTS facebook_url text,
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS tiktok_url text,
  ADD COLUMN IF NOT EXISTS youtube_url text;

WITH mavinci_signature AS (
  SELECT email_signature_template
  FROM public.my_companies
  WHERE LOWER(name) = 'mavinci'
    AND NULLIF(BTRIM(email_signature_template), '') IS NOT NULL
  ORDER BY is_default DESC, created_at
  LIMIT 1
)
UPDATE public.my_companies AS event_rulers
SET
  website = 'https://www.eventrulers.pl',
  email_signature_use_template = true,
  email_signature_template = REPLACE(
    REPLACE(
      REPLACE(
        mavinci_signature.email_signature_template,
        'https://www.facebook.com/mavincieventart',
        '{{company_facebook_url}}'
      ),
      'https://www.instagram.com/mavincieventart',
      '{{company_instagram_url}}'
    ),
    'https://linkedin.com/company/mavinci-event-art',
    '{{company_linkedin_url}}'
  ),
  updated_at = NOW()
FROM mavinci_signature
WHERE event_rulers.id = '587a3901-850a-4e0c-baa7-93ec984dc6a5'
   OR LOWER(event_rulers.email) IN ('biuro@eventrulers.pl', 'wedding@eventrulers.pl');

INSERT INTO public.company_brandbook_colors (company_id, label, hex, role, order_index)
SELECT company.id, color.label, color.hex, color.role, color.order_index
FROM public.my_companies AS company
CROSS JOIN (
  VALUES
    ('Czerń Event Rulers', '#1c1f33', 'primary', 0),
    ('Tło Event Rulers', '#0f1119', 'secondary', 1),
    ('Złoto Event Rulers', '#d3bb73', 'accent', 2)
) AS color(label, hex, role, order_index)
WHERE (company.id = '587a3901-850a-4e0c-baa7-93ec984dc6a5'
    OR LOWER(company.email) = 'biuro@eventrulers.pl')
  AND NOT EXISTS (
    SELECT 1
    FROM public.company_brandbook_colors existing
    WHERE existing.company_id = company.id
      AND existing.role = color.role
  );

UPDATE public.employee_email_accounts
SET
  from_name = CASE LOWER(email_address)
    WHEN 'wedding@eventrulers.pl' THEN 'Wedding by Event Rulers'
    ELSE 'Event Rulers'
  END,
  my_company_id = (
    SELECT company.id
    FROM public.my_companies company
    WHERE company.id = '587a3901-850a-4e0c-baa7-93ec984dc6a5'
       OR LOWER(company.email) = 'biuro@eventrulers.pl'
    ORDER BY (company.id = '587a3901-850a-4e0c-baa7-93ec984dc6a5') DESC
    LIMIT 1
  )
WHERE LOWER(email_address) IN ('wedding@eventrulers.pl', 'biuro@eventrulers.pl')
  AND EXISTS (
    SELECT 1
    FROM public.my_companies company
    WHERE company.id = '587a3901-850a-4e0c-baa7-93ec984dc6a5'
       OR LOWER(company.email) = 'biuro@eventrulers.pl'
  );

NOTIFY pgrst, 'reload schema';
