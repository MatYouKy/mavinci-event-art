-- Warehouse has event-specific operational contacts, not the CRM contact/seller directory.
-- Existing propagation updates only employees inheriting this package.
UPDATE public.access_levels
SET default_permissions=array_remove(array_remove(array_remove(
 coalesce(default_permissions,'{}'::text[]),'contacts_view'),'contacts_manage'),'contacts_create')
WHERE slug='warehouse';
