BEGIN;
CREATE TABLE public.event_partner_arrangements(
 event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
 contact_id uuid REFERENCES public.contacts(id) ON DELETE RESTRICT,
 notes text NOT NULL DEFAULT '',
 order_reference text NOT NULL DEFAULT '',
 CHECK(NOT enabled OR (organization_id IS NOT NULL OR contact_id IS NOT NULL)),
 CHECK(organization_id IS NULL OR contact_id IS NULL)
);
ALTER TABLE public.event_partner_arrangements ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_partner_read ON public.event_partner_arrangements FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id));
CREATE POLICY event_partner_write ON public.event_partner_arrangements FOR ALL TO authenticated
 USING(EXISTS(SELECT 1 FROM public.events e JOIN public.employees actor ON (actor.id=auth.uid() OR actor.auth_user_id=auth.uid()) WHERE e.id=event_id AND actor.is_active AND NOT public.current_session_is_seller_portal() AND (e.created_by=actor.id OR actor.role::text='admin' OR actor.access_level::text='admin' OR coalesce(actor.permissions,'{}') && ARRAY['admin','events_manage'])))
 WITH CHECK(EXISTS(SELECT 1 FROM public.events e JOIN public.employees actor ON (actor.id=auth.uid() OR actor.auth_user_id=auth.uid()) WHERE e.id=event_id AND actor.is_active AND NOT public.current_session_is_seller_portal() AND (e.created_by=actor.id OR actor.role::text='admin' OR actor.access_level::text='admin' OR coalesce(actor.permissions,'{}') && ARRAY['admin','events_manage'])));
GRANT SELECT,INSERT,UPDATE ON public.event_partner_arrangements TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
