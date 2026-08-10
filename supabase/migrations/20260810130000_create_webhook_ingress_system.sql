-- Universal inbound webhook sources and event log.

CREATE OR REPLACE FUNCTION can_manage_webhooks()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM employees
    WHERE id = auth.uid()
      AND (
        role = 'admin'
        OR access_level = 'admin'
        OR 'webhooks_manage' = ANY(permissions)
      )
  );
$$;

CREATE OR REPLACE FUNCTION can_view_webhooks()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM employees
    WHERE id = auth.uid()
      AND (
        role = 'admin'
        OR access_level = 'admin'
        OR 'webhooks_manage' = ANY(permissions)
        OR 'webhooks_view' = ANY(permissions)
      )
  );
$$;

CREATE TABLE IF NOT EXISTS webhook_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  api_key_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  allowed_event_types text[] NOT NULL DEFAULT '{}',
  default_notify_permissions text[] NOT NULL DEFAULT '{}',
  description text,
  created_by uuid REFERENCES employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE webhook_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "webhook_sources_select" ON webhook_sources;
CREATE POLICY "webhook_sources_select" ON webhook_sources
  FOR SELECT TO authenticated
  USING (can_view_webhooks());

DROP POLICY IF EXISTS "webhook_sources_insert" ON webhook_sources;
CREATE POLICY "webhook_sources_insert" ON webhook_sources
  FOR INSERT TO authenticated
  WITH CHECK (can_manage_webhooks());

DROP POLICY IF EXISTS "webhook_sources_update" ON webhook_sources;
CREATE POLICY "webhook_sources_update" ON webhook_sources
  FOR UPDATE TO authenticated
  USING (can_manage_webhooks())
  WITH CHECK (can_manage_webhooks());

DROP POLICY IF EXISTS "webhook_sources_delete" ON webhook_sources;
CREATE POLICY "webhook_sources_delete" ON webhook_sources
  FOR DELETE TO authenticated
  USING (can_manage_webhooks());

CREATE TABLE IF NOT EXISTS inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES webhook_sources(id) ON DELETE CASCADE,
  external_event_id text NOT NULL,
  event_type text NOT NULL,
  title text NOT NULL,
  body text,
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  detail_url text,
  event_time timestamptz DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
  notification_id uuid REFERENCES notifications(id) ON DELETE SET NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id, external_event_id)
);

ALTER TABLE inbound_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbound_events_select" ON inbound_events;
CREATE POLICY "inbound_events_select" ON inbound_events
  FOR SELECT TO authenticated
  USING (can_view_webhooks());

DROP POLICY IF EXISTS "inbound_events_insert" ON inbound_events;
CREATE POLICY "inbound_events_insert" ON inbound_events
  FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "inbound_events_update" ON inbound_events;
CREATE POLICY "inbound_events_update" ON inbound_events
  FOR UPDATE TO authenticated
  USING (can_manage_webhooks())
  WITH CHECK (can_manage_webhooks());

DROP POLICY IF EXISTS "inbound_events_delete" ON inbound_events;
CREATE POLICY "inbound_events_delete" ON inbound_events
  FOR DELETE TO authenticated
  USING (can_manage_webhooks());

CREATE INDEX IF NOT EXISTS idx_inbound_events_source_external
  ON inbound_events(source_id, external_event_id);

CREATE INDEX IF NOT EXISTS idx_inbound_events_status
  ON inbound_events(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbound_events_source_created
  ON inbound_events(source_id, created_at DESC);
