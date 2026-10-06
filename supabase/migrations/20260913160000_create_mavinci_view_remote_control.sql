-- Internetowy panel sterowania Mavinci View.
-- Urządzenia, polecenia i pliki są zawsze odseparowane przez auth.uid().

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.mavinci_view_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 8 AND 160),
  name text NOT NULL DEFAULT 'Mavinci View' CHECK (char_length(name) BETWEEN 1 AND 120),
  platform text NOT NULL DEFAULT 'android' CHECK (char_length(platform) <= 80),
  app_version text NOT NULL DEFAULT '',
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  project_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, installation_id),
  UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS public.mavinci_view_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 240),
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  bytes bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, storage_path),
  UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS public.mavinci_view_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  command text NOT NULL CHECK (command IN (
    'add_assets', 'set_order',
    'play', 'pause', 'resume', 'stop', 'next', 'previous', 'go_to'
  )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  claimed_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT mavinci_view_commands_owned_device_fk
    FOREIGN KEY (device_id, user_id)
    REFERENCES public.mavinci_view_devices(id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mavinci_view_devices_owner_seen
  ON public.mavinci_view_devices(user_id, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_mavinci_view_commands_device_queue
  ON public.mavinci_view_commands(device_id, status, expires_at, created_at);
CREATE INDEX IF NOT EXISTS idx_mavinci_view_media_owner_created
  ON public.mavinci_view_media(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.mavinci_view_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mavinci_view_devices_touch ON public.mavinci_view_devices;
CREATE TRIGGER trg_mavinci_view_devices_touch
BEFORE UPDATE ON public.mavinci_view_devices
FOR EACH ROW EXECUTE FUNCTION public.mavinci_view_touch_updated_at();

ALTER TABLE public.mavinci_view_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavinci_view_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mavinci_view_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mavinci_view_devices_owner ON public.mavinci_view_devices;
CREATE POLICY mavinci_view_devices_owner ON public.mavinci_view_devices
FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS mavinci_view_media_owner ON public.mavinci_view_media;
CREATE POLICY mavinci_view_media_owner ON public.mavinci_view_media
FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS mavinci_view_commands_owner ON public.mavinci_view_commands;
CREATE POLICY mavinci_view_commands_owner ON public.mavinci_view_commands
FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mavinci-view',
  'mavinci-view',
  false,
  2147483648,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/x-matroska',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS mavinci_view_storage_select ON storage.objects;
CREATE POLICY mavinci_view_storage_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'mavinci-view'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS mavinci_view_storage_insert ON storage.objects;
CREATE POLICY mavinci_view_storage_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'mavinci-view'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS mavinci_view_storage_update ON storage.objects;
CREATE POLICY mavinci_view_storage_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'mavinci-view'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'mavinci-view'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS mavinci_view_storage_delete ON storage.objects;
CREATE POLICY mavinci_view_storage_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'mavinci-view'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavinci_view_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavinci_view_media TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mavinci_view_commands TO authenticated;
