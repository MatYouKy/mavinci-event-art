-- Organization correspondence is scoped to the signed-in employee, including admins.
-- Invoker security retains existing organization/contact/mail RLS restrictions.
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS correspondence_domains text[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.valid_correspondence_domains(domains text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT cardinality(domains) <= 20 AND NOT EXISTS (
   SELECT 1 FROM unnest(domains) d WHERE d IS NULL OR length(d) > 253
     OR d <> lower(d) OR d !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$'
 );
$$;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_correspondence_domains_valid
 CHECK (public.valid_correspondence_domains(correspondence_domains));

CREATE OR REPLACE FUNCTION public.organization360_correspondence(p_organization_id uuid, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, direction text, subject text, occurred_at timestamptz, is_read boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 WITH actor AS MATERIALIZED (
   SELECT e.id FROM public.employees e
   WHERE (e.auth_user_id = auth.uid() OR e.id = auth.uid()) AND e.is_active = true
 ), organization AS MATERIALIZED (
   SELECT o.email, o.correspondence_domains FROM public.organizations o WHERE o.id = p_organization_id
 ), addresses AS MATERIALIZED (
   SELECT lower(trim(email)) AS email FROM organization WHERE nullif(trim(email), '') IS NOT NULL
   UNION
   SELECT lower(trim(c.email)) FROM public.contact_organizations co
   JOIN public.contacts c ON c.id = co.contact_id
   WHERE co.organization_id = p_organization_id AND co.is_current = true
     AND EXISTS (SELECT 1 FROM organization) AND nullif(trim(c.email), '') IS NOT NULL
 ), messages AS (
   SELECT m.id, 'received'::text AS direction, m.subject, m.received_date AS occurred_at, m.is_read,
     m.from_address AS participants
   FROM public.received_emails m
   WHERE EXISTS (SELECT 1 FROM organization) AND (
     m.assigned_to IN (SELECT id FROM actor)
     OR (m.assigned_to IS NULL AND EXISTS (
       SELECT 1 FROM public.employee_email_accounts a WHERE a.id = m.email_account_id
         AND a.account_type = 'personal' AND a.employee_id IN (SELECT id FROM actor)
     ))
   )
   UNION ALL
   SELECT m.id, 'sent'::text, m.subject, m.sent_at, true, m.to_address
   FROM public.sent_emails m
   WHERE EXISTS (SELECT 1 FROM organization) AND (
     m.employee_id IN (SELECT id FROM actor)
     OR (m.employee_id IS NULL AND EXISTS (
       SELECT 1 FROM public.employee_email_accounts a WHERE a.id = m.email_account_id
         AND a.account_type = 'personal' AND a.employee_id IN (SELECT id FROM actor)
     ))
   )
 )
 SELECT m.id, m.direction, m.subject, m.occurred_at, m.is_read FROM messages m
 WHERE EXISTS (
   SELECT 1 FROM regexp_matches(lower(m.participants), '([a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)', 'g') AS match(parts)
   WHERE parts[1] IN (SELECT email FROM addresses)
      OR split_part(parts[1], '@', 2) = ANY((SELECT correspondence_domains FROM organization)::text[])
 )
 ORDER BY m.occurred_at DESC, m.direction, m.id
 LIMIT 100 OFFSET greatest(coalesce(p_offset, 0), 0);
$$;
REVOKE ALL ON FUNCTION public.organization360_correspondence(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization360_correspondence(uuid, integer) TO authenticated;
