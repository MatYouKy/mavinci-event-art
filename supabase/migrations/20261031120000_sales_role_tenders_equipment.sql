BEGIN;

-- Rola „Sprzedaż / Opiekun klienta”: sprzedawca pozyskuje zlecenia także z przetargów
-- i wycenia sprzęt w ofertach, więc potrzebuje podglądu przetargów i magazynu.
-- Trigger z 20260907120000 przepisze uprawnienia pracownikom z role_permissions_inherited.
UPDATE public.access_levels
SET default_permissions = (
  SELECT array_agg(DISTINCT permission ORDER BY permission)
  FROM unnest(coalesce(default_permissions, '{}'::text[]) || ARRAY['tenders_view', 'equipment_view']::text[]) AS permission
)
WHERE slug = 'sales-specialist'
  AND NOT (coalesce(default_permissions, '{}'::text[]) @> ARRAY['tenders_view', 'equipment_view']::text[]);

-- Pracownicy tej roli z ręcznie dostosowanymi uprawnieniami: dopisujemy tylko brakujące,
-- niczego im nie odbierając.
UPDATE public.employees employee
SET permissions = (
  SELECT array_agg(DISTINCT permission ORDER BY permission)
  FROM unnest(coalesce(employee.permissions, '{}'::text[]) || ARRAY['tenders_view', 'equipment_view']::text[]) AS permission
)
FROM public.access_levels level
WHERE level.id = employee.access_level_id
  AND level.slug = 'sales-specialist'
  AND employee.role_permissions_inherited = false
  AND NOT (coalesce(employee.permissions, '{}'::text[]) @> ARRAY['tenders_view', 'equipment_view']::text[]);

NOTIFY pgrst, 'reload schema';
COMMIT;
