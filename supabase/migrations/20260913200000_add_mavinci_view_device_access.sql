-- Ręczna aktywacja instalacji Mavinci View z poziomu Mavinci LIVE.
-- View może rejestrować heartbeat, ale nie może samodzielnie zmieniać licencji.

ALTER TABLE public.mavinci_view_devices
  ADD COLUMN IF NOT EXISTS access_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS access_valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS access_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mavinci_view_devices_access_status_check'
      AND conrelid = 'public.mavinci_view_devices'::regclass
  ) THEN
    ALTER TABLE public.mavinci_view_devices
      ADD CONSTRAINT mavinci_view_devices_access_status_check
      CHECK (access_status IN ('pending', 'active', 'blocked'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_mavinci_view_devices_owner_access
  ON public.mavinci_view_devices(user_id, access_status, access_valid_until);

CREATE TABLE IF NOT EXISTS public.mavinci_view_device_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('active', 'blocked')),
  valid_until timestamptz,
  changed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mavinci_view_device_access_log_device_fk
    FOREIGN KEY (device_id, user_id)
    REFERENCES public.mavinci_view_devices(id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mavinci_view_device_access_log_device
  ON public.mavinci_view_device_access_log(device_id, created_at DESC);

ALTER TABLE public.mavinci_view_device_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mavinci_view_device_access_log_owner ON public.mavinci_view_device_access_log;
CREATE POLICY mavinci_view_device_access_log_owner
ON public.mavinci_view_device_access_log
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.mavinci_view_register_device(
  p_installation_id text,
  p_name text,
  p_platform text,
  p_app_version text,
  p_state jsonb,
  p_project_snapshot jsonb
)
RETURNS SETOF public.mavinci_view_devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.can_access_mavinci_desktop() THEN
    RAISE EXCEPTION 'Mavinci access required';
  END IF;
  IF char_length(COALESCE(p_installation_id, '')) NOT BETWEEN 8 AND 160 THEN
    RAISE EXCEPTION 'Invalid installation id';
  END IF;
  IF char_length(COALESCE(p_name, '')) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Invalid device name';
  END IF;
  IF char_length(COALESCE(p_platform, '')) > 80 OR char_length(COALESCE(p_app_version, '')) > 80 THEN
    RAISE EXCEPTION 'Invalid device metadata';
  END IF;

  RETURN QUERY
  INSERT INTO public.mavinci_view_devices (
    user_id,
    installation_id,
    name,
    platform,
    app_version,
    state,
    project_snapshot,
    last_seen
  )
  VALUES (
    current_user_id,
    p_installation_id,
    p_name,
    p_platform,
    p_app_version,
    COALESCE(p_state, '{}'::jsonb),
    COALESCE(p_project_snapshot, '{}'::jsonb),
    now()
  )
  ON CONFLICT (user_id, installation_id) DO UPDATE SET
    name = EXCLUDED.name,
    platform = EXCLUDED.platform,
    app_version = EXCLUDED.app_version,
    state = EXCLUDED.state,
    project_snapshot = EXCLUDED.project_snapshot,
    last_seen = now()
  RETURNING *;
END
$$;

CREATE OR REPLACE FUNCTION public.mavinci_view_set_device_access(
  p_device_id uuid,
  p_status text,
  p_valid_until timestamptz DEFAULT NULL
)
RETURNS SETOF public.mavinci_view_devices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  updated_device public.mavinci_view_devices%ROWTYPE;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.can_access_mavinci_desktop() THEN
    RAISE EXCEPTION 'Mavinci access required';
  END IF;
  IF p_status NOT IN ('active', 'blocked') THEN
    RAISE EXCEPTION 'Invalid access status';
  END IF;
  IF p_status = 'active' AND (p_valid_until IS NULL OR p_valid_until <= now()) THEN
    RAISE EXCEPTION 'Active access requires a future expiration date';
  END IF;

  UPDATE public.mavinci_view_devices
  SET
    access_status = p_status,
    access_valid_until = CASE WHEN p_status = 'active' THEN p_valid_until ELSE access_valid_until END,
    access_activated_at = CASE WHEN p_status = 'active' THEN now() ELSE access_activated_at END,
    access_revoked_at = CASE WHEN p_status = 'blocked' THEN now() ELSE NULL END,
    access_updated_at = now(),
    access_updated_by = current_user_id
  WHERE id = p_device_id
    AND user_id = current_user_id
  RETURNING * INTO updated_device;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  INSERT INTO public.mavinci_view_device_access_log (
    device_id,
    user_id,
    status,
    valid_until,
    changed_by
  ) VALUES (
    updated_device.id,
    updated_device.user_id,
    p_status,
    updated_device.access_valid_until,
    current_user_id
  );

  RETURN NEXT updated_device;
END
$$;

-- Bezpośredni zapis urządzenia jest wyłączony. View korzysta wyłącznie z
-- mavinci_view_register_device, a licencję może zmienić tylko osobne RPC Live.
REVOKE INSERT, UPDATE, DELETE ON public.mavinci_view_devices FROM authenticated;
GRANT SELECT ON public.mavinci_view_devices TO authenticated;
GRANT SELECT ON public.mavinci_view_device_access_log TO authenticated;
REVOKE ALL ON FUNCTION public.mavinci_view_register_device(text, text, text, text, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mavinci_view_set_device_access(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mavinci_view_register_device(text, text, text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_view_set_device_access(uuid, text, timestamptz) TO authenticated;
