-- Pair Mavinci View installations with Mavinci LIVE without a CRM login on the device.
-- The public client key only opens these narrow RPCs. Every device request is
-- additionally authenticated with a high-entropy secret stored in SecureStore.

ALTER TABLE public.mavinci_view_devices
  ALTER COLUMN user_id DROP NOT NULL,
  ALTER COLUMN user_id DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS device_secret_hash bytea,
  ADD COLUMN IF NOT EXISTS pairing_code_hash bytea,
  ADD COLUMN IF NOT EXISTS pairing_code_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS paired_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mavinci_view_devices_installation_unique
  ON public.mavinci_view_devices(installation_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mavinci_view_devices_pairing_code
  ON public.mavinci_view_devices(pairing_code_hash)
  WHERE pairing_code_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mavinci_view_device_sync(
  p_installation_id text,
  p_device_secret text,
  p_name text,
  p_platform text,
  p_app_version text,
  p_state jsonb,
  p_project_snapshot jsonb,
  p_force_pairing_code boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  installation_id text,
  paired boolean,
  access_status text,
  access_valid_until timestamptz,
  pairing_code text,
  pairing_code_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  current_device public.mavinci_view_devices%ROWTYPE;
  secret_hash bytea;
  generated_code text;
BEGIN
  IF char_length(COALESCE(p_installation_id, '')) NOT BETWEEN 24 AND 160 THEN
    RAISE EXCEPTION 'Invalid installation id';
  END IF;
  IF char_length(COALESCE(p_device_secret, '')) NOT BETWEEN 48 AND 240 THEN
    RAISE EXCEPTION 'Invalid device secret';
  END IF;
  IF char_length(COALESCE(p_name, '')) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Invalid device name';
  END IF;
  IF char_length(COALESCE(p_platform, '')) > 80 OR char_length(COALESCE(p_app_version, '')) > 80 THEN
    RAISE EXCEPTION 'Invalid device metadata';
  END IF;
  IF pg_column_size(COALESCE(p_state, '{}'::jsonb)) > 65536
    OR pg_column_size(COALESCE(p_project_snapshot, '{}'::jsonb)) > 1048576 THEN
    RAISE EXCEPTION 'Device state is too large';
  END IF;

  secret_hash := digest(p_device_secret, 'sha256');

  SELECT d.* INTO current_device
  FROM public.mavinci_view_devices AS d
  WHERE d.installation_id = p_installation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.mavinci_view_devices (
      user_id,
      installation_id,
      name,
      platform,
      app_version,
      state,
      project_snapshot,
      last_seen,
      device_secret_hash
    ) VALUES (
      NULL,
      p_installation_id,
      p_name,
      p_platform,
      p_app_version,
      COALESCE(p_state, '{}'::jsonb),
      COALESCE(p_project_snapshot, '{}'::jsonb),
      now(),
      secret_hash
    )
    RETURNING * INTO current_device;
  ELSIF current_device.device_secret_hash IS NULL THEN
    -- Seamless upgrade for installations registered by the former CRM-login flow.
    -- Their installation id already contains two random UUIDs and lives in SecureStore.
    UPDATE public.mavinci_view_devices AS d
    SET device_secret_hash = secret_hash
    WHERE d.id = current_device.id
    RETURNING * INTO current_device;
  ELSIF current_device.device_secret_hash <> secret_hash THEN
    RAISE EXCEPTION 'Invalid device identity';
  END IF;

  IF current_device.user_id IS NULL
    AND (
      p_force_pairing_code
      OR current_device.pairing_code_hash IS NULL
      OR current_device.pairing_code_expires_at IS NULL
      OR current_device.pairing_code_expires_at <= now()
    ) THEN
    LOOP
      generated_code := upper(encode(gen_random_bytes(6), 'hex'));
      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM public.mavinci_view_devices AS candidate
        WHERE candidate.pairing_code_hash = digest(generated_code, 'sha256')
      );
    END LOOP;

    UPDATE public.mavinci_view_devices AS d
    SET
      pairing_code_hash = digest(generated_code, 'sha256'),
      pairing_code_expires_at = now() + interval '15 minutes'
    WHERE d.id = current_device.id
    RETURNING * INTO current_device;
  END IF;

  UPDATE public.mavinci_view_devices AS d
  SET
    name = p_name,
    platform = p_platform,
    app_version = p_app_version,
    state = COALESCE(p_state, '{}'::jsonb),
    project_snapshot = COALESCE(p_project_snapshot, '{}'::jsonb),
    last_seen = now()
  WHERE d.id = current_device.id
    AND d.device_secret_hash = secret_hash
  RETURNING * INTO current_device;

  RETURN QUERY SELECT
    current_device.id,
    current_device.installation_id,
    current_device.user_id IS NOT NULL,
    current_device.access_status,
    current_device.access_valid_until,
    generated_code,
    current_device.pairing_code_expires_at;
END
$$;

CREATE OR REPLACE FUNCTION public.mavinci_view_claim_device(
  p_pairing_code text,
  p_valid_until timestamptz
)
RETURNS TABLE (device_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  normalized_code text;
  claimed_device public.mavinci_view_devices%ROWTYPE;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.can_access_mavinci_desktop() THEN
    RAISE EXCEPTION 'Mavinci access required';
  END IF;
  IF p_valid_until IS NULL OR p_valid_until <= now() THEN
    RAISE EXCEPTION 'Active access requires a future expiration date';
  END IF;

  normalized_code := regexp_replace(upper(COALESCE(p_pairing_code, '')), '[^A-F0-9]', '', 'g');
  IF char_length(normalized_code) <> 12 THEN
    RAISE EXCEPTION 'Invalid pairing code';
  END IF;

  UPDATE public.mavinci_view_devices AS d
  SET
    user_id = current_user_id,
    paired_at = now(),
    pairing_code_hash = NULL,
    pairing_code_expires_at = NULL,
    access_status = 'active',
    access_valid_until = p_valid_until,
    access_activated_at = now(),
    access_revoked_at = NULL,
    access_updated_at = now(),
    access_updated_by = current_user_id
  WHERE d.user_id IS NULL
    AND d.pairing_code_hash = digest(normalized_code, 'sha256')
    AND d.pairing_code_expires_at > now()
  RETURNING d.* INTO claimed_device;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pairing code is invalid or expired';
  END IF;

  INSERT INTO public.mavinci_view_device_access_log (
    device_id,
    user_id,
    status,
    valid_until,
    changed_by
  ) VALUES (
    claimed_device.id,
    current_user_id,
    'active',
    p_valid_until,
    current_user_id
  );

  RETURN QUERY SELECT claimed_device.id;
END
$$;

CREATE OR REPLACE FUNCTION public.mavinci_view_device_pending_commands(
  p_installation_id text,
  p_device_secret text
)
RETURNS TABLE (
  id uuid,
  device_id uuid,
  command text,
  payload jsonb,
  status text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT c.id, c.device_id, c.command, c.payload, c.status, c.created_at
  FROM public.mavinci_view_commands AS c
  JOIN public.mavinci_view_devices AS d ON d.id = c.device_id
  WHERE d.installation_id = p_installation_id
    AND d.device_secret_hash = digest(p_device_secret, 'sha256')
    AND d.user_id IS NOT NULL
    AND d.access_status = 'active'
    AND d.access_valid_until > now()
    AND c.status = 'pending'
    AND c.expires_at > now()
  ORDER BY c.created_at ASC
  LIMIT 20
$$;

CREATE OR REPLACE FUNCTION public.mavinci_view_device_claim_command(
  p_installation_id text,
  p_device_secret text,
  p_command_id uuid
)
RETURNS TABLE (
  id uuid,
  device_id uuid,
  command text,
  payload jsonb,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.mavinci_view_commands AS c
  SET status = 'processing', claimed_at = now()
  FROM public.mavinci_view_devices AS d
  WHERE c.id = p_command_id
    AND c.device_id = d.id
    AND d.installation_id = p_installation_id
    AND d.device_secret_hash = digest(p_device_secret, 'sha256')
    AND d.user_id IS NOT NULL
    AND d.access_status = 'active'
    AND d.access_valid_until > now()
    AND c.status = 'pending'
    AND c.expires_at > now()
  RETURNING c.id, c.device_id, c.command, c.payload, c.status, c.created_at;
END
$$;

CREATE OR REPLACE FUNCTION public.mavinci_view_device_finish_command(
  p_installation_id text,
  p_device_secret text,
  p_command_id uuid,
  p_result jsonb,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  changed integer;
BEGIN
  IF char_length(COALESCE(p_error, '')) > 2000 OR pg_column_size(COALESCE(p_result, '{}'::jsonb)) > 65536 THEN
    RAISE EXCEPTION 'Command result is too large';
  END IF;

  UPDATE public.mavinci_view_commands AS c
  SET
    status = CASE WHEN p_error IS NULL THEN 'succeeded' ELSE 'failed' END,
    result = COALESCE(p_result, '{}'::jsonb),
    error = p_error,
    completed_at = now()
  FROM public.mavinci_view_devices AS d
  WHERE c.id = p_command_id
    AND c.device_id = d.id
    AND d.installation_id = p_installation_id
    AND d.device_secret_hash = digest(p_device_secret, 'sha256')
    AND c.status = 'processing';

  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END
$$;

REVOKE ALL ON FUNCTION public.mavinci_view_device_sync(text, text, text, text, text, jsonb, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mavinci_view_claim_device(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mavinci_view_device_pending_commands(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mavinci_view_device_claim_command(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mavinci_view_device_finish_command(text, text, uuid, jsonb, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mavinci_view_device_sync(text, text, text, text, text, jsonb, jsonb, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_view_claim_device(text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_view_device_pending_commands(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_view_device_claim_command(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mavinci_view_device_finish_command(text, text, uuid, jsonb, text) TO anon, authenticated;

REVOKE ALL ON public.mavinci_view_devices FROM anon;
REVOKE ALL ON public.mavinci_view_commands FROM anon;
REVOKE ALL ON public.mavinci_view_media FROM anon;

