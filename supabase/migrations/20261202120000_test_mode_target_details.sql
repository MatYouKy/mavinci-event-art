-- Tryb testowy „widok jako” — więcej informacji o pracowniku na liście (docs/test-mode.md)
-- ===============================================================================================================
-- Można uruchomić ponownie. Ustawienia → „Tryb testowy”: karta pracownika po kliknięciu (zdjęcie, dział, poziom dostępu, rola,
-- przełożony, e-mail i telefon służbowy, ostatnia aktywność, lista uprawnień) — w CRM, na Macu i w telefonie.
-- `test_mode_targets` zwraca dotychczasowe pola bez zmian i dodatkowo: `email`, `phone`, `avatar_metadata` (kadrowanie zdjęcia),
-- `permission_keys` (uprawnienia pracownika), `supervisor` (imię i nazwisko przełożonego), `last_active_at`.
-- Nadal tylko administrator (`private.test_mode_admin_employee`), bez administratorów i bez siebie na liście.

BEGIN;

CREATE OR REPLACE FUNCTION public.test_mode_targets()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_admin uuid := private.test_mode_admin_employee(auth.uid());
BEGIN
  IF v_admin IS NULL THEN RAISE EXCEPTION 'Tryb testowy jest dostępny tylko dla administratora.' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'employees', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'kind', 'employee', 'id', e.id,
               'name', nullif(btrim(concat_ws(' ', e.name, e.surname)), ''),
               'nickname', e.nickname, 'avatar_url', e.avatar_url, 'occupation', e.occupation,
               'department', e.department, 'role', e.role::text,
               'access_level', coalesce(al.name, e.access_level::text),
               'permissions', cardinality(coalesce(e.permissions, '{}'::text[])),
               'email', nullif(btrim(e.email), ''),
               'phone', nullif(btrim(e.phone_number), ''),
               'avatar_metadata', e.avatar_metadata,
               'permission_keys', to_jsonb(coalesce(e.permissions, '{}'::text[])),
               'supervisor', nullif(btrim(concat_ws(' ', s.name, s.surname)), ''),
               'last_active_at', e.last_active_at)
             ORDER BY e.name, e.surname), '[]'::jsonb)
        FROM public.employees e
        LEFT JOIN public.access_levels al ON al.id = e.access_level_id
        LEFT JOIN public.employees s ON s.id = e.supervisor_id
       WHERE e.is_active AND e.auth_user_id IS NOT NULL AND e.id <> v_admin
         AND NOT private.test_mode_is_admin_employee(e.id)),
    'sellers', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'kind', 'seller', 'id', p.id,
               'name', coalesce(nullif(btrim(coalesce(c.full_name, concat_ws(' ', c.first_name, c.last_name))), ''), 'Sprzedawca'),
               'organization', g.name, 'partner_type', p.partner_type, 'status', p.status)
             ORDER BY coalesce(c.full_name, c.last_name)), '[]'::jsonb)
        FROM public.sales_partner_profiles p
        JOIN public.contacts c ON c.id = p.contact_id
        LEFT JOIN public.organizations g ON g.id = p.organization_id
       WHERE p.portal_enabled AND p.portal_auth_user_id IS NOT NULL));
END $$;

REVOKE ALL ON FUNCTION public.test_mode_targets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.test_mode_targets() TO authenticated;

COMMIT;
