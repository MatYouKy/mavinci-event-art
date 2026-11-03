-- Deploy the updated /bridge/team-members endpoint before this migration.
-- Public pages and the endpoint now use the same server-only employee projection
-- with show_on_website=true. SUPABASE_SERVICE_ROLE_KEY stays on the Next.js server.
-- Do not add anonymous access to employees to make the old view usable.
BEGIN;

ALTER VIEW public.website_team_members SET (security_invoker = true);
REVOKE ALL PRIVILEGES ON public.website_team_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.website_team_members TO service_role;

COMMENT ON VIEW public.website_team_members IS
  'Widok wyłącznie dla usługi serwerowej, SECURITY INVOKER. Publiczny zespół jest udostępniany przez serwer aplikacji z jawną listą pól i filtrem show_on_website=true.';

COMMIT;
