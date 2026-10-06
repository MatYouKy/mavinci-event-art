-- Bezpieczne usuwanie urządzenia z Mavinci LIVE.
-- Usunięcie kasuje powiązanie, historię dostępu i kolejkę poleceń.
-- Działające View zarejestruje się ponownie jako nowe, nieprzypisane urządzenie
-- i pokaże kolejny kod aktywacyjny.

CREATE OR REPLACE FUNCTION public.mavinci_view_delete_device(
  p_device_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  deleted_count integer;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.can_access_mavinci_desktop() THEN
    RAISE EXCEPTION 'Mavinci access required';
  END IF;

  DELETE FROM public.mavinci_view_devices
  WHERE id = p_device_id
    AND user_id = current_user_id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count <> 1 THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.mavinci_view_delete_device(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mavinci_view_delete_device(uuid) TO authenticated;
