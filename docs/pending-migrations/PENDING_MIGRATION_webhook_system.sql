/*
# Create Webhook Sources & Inbound Events System

INSTRUKCJA: Skopiuj cały ten plik i wykonaj go w Supabase SQL Editor:
1. Otwórz dashboard Supabase → SQL Editor
2. Wklej cały kod SQL
3. Kliknij "Run"

1. New Tables
  - `webhook_sources` — registered external sources that can send events
    - `id` (uuid, PK)
    - `name` (text) — human-readable name
    - `slug` (text, UNIQUE) — URL-safe identifier used in API calls
    - `api_key_hash` (text) — SHA-256 hash of the API key
    - `is_active` (boolean, default true)
    - `allowed_event_types` (text[]) — restrict which event types this source can send
    - `default_notify_permissions` (text[]) — which permission groups get notified
    - `description` (text) — notes about the source
    - `created_by` (uuid, FK→employees)
    - `created_at`, `updated_at` (timestamptz)

  - `inbound_events` — log of all received webhook events
    - `id` (uuid, PK)
    - `source_id` (uuid, FK→webhook_sources CASCADE)
    - `external_event_id` (text) — unique event ID from the source
    - `event_type` (text) — e.g. 'contact_form', 'order', 'payment'
    - `title` (text) — short summary
    - `body` (text) — full message
    - `priority` (text) — low/normal/high/critical
    - `detail_url` (text) — link to details on source site
    - `event_time` (timestamptz) — when the event occurred
    - `metadata` (jsonb) — flexible extra data
    - `status` (text) — received/processed/failed/ignored
    - `notification_id` (uuid, FK→notifications)
    - `processed_at` (timestamptz)
    - `created_at` (timestamptz)
    - UNIQUE(source_id, external_event_id) for idempotent deduplication

2. Security
  - RLS enabled on both tables
  - webhook_sources: admin + webhooks_manage can CRUD; webhooks_view can SELECT
  - inbound_events: admin + webhooks_manage/webhooks_view can SELECT; INSERT only via service role
  - Helper functions: can_manage_webhooks(), can_view_webhooks()
*/

-- Helper: can this user manage webhooks?
CREATE OR REPLACE FUNCTION can_manage_webhooks()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE user_id = auth.uid()
      AND (
        is_admin = true
        OR 'webhooks_manage' = ANY(permissions)
      )
  );
$$;

-- Helper: can this user view webhooks?
CREATE OR REPLACE FUNCTION can_view_webhooks()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM employees
    WHERE user_id = auth.uid()
      AND (
        is_admin = true
        OR 'webhooks_manage' = ANY(permissions)
        OR 'webhooks_view' = ANY(permissions)
      )
  );
$$;

-- ============================================================
-- webhook_sources
-- ============================================================
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

-- ============================================================
-- inbound_events
-- ============================================================
CREATE TABLE IF NOT EXISTS inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES webhook_sources(id) ON DELETE CASCADE,
  external_event_id text NOT NULL,
  event_type text NOT NULL,
  title text NOT NULL,
  body text,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  detail_url text,
  event_time timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
  notification_id uuid REFERENCES notifications(id),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id, external_event_id)
);

ALTER TABLE inbound_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbound_events_select" ON inbound_events;
CREATE POLICY "inbound_events_select" ON inbound_events
  FOR SELECT TO authenticated
  USING (can_view_webhooks());

-- INSERT only via service role (edge function) - blocked for regular users
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_inbound_events_source_external
  ON inbound_events(source_id, external_event_id);

CREATE INDEX IF NOT EXISTS idx_inbound_events_status
  ON inbound_events(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbound_events_source_created
  ON inbound_events(source_id, created_at DESC);
