-- MIGRATION: add_loading_confirmation_system
-- Apply this SQL to the Supabase database using the apply_migration MCP tool
-- when it becomes available again.

ALTER TABLE events
ADD COLUMN IF NOT EXISTS loading_confirmed boolean NOT NULL DEFAULT false;

ALTER TABLE events
ADD COLUMN IF NOT EXISTS loading_confirmed_at timestamptz;

ALTER TABLE events
ADD COLUMN IF NOT EXISTS loading_confirmed_by uuid REFERENCES employees(id);

ALTER TABLE events
ADD COLUMN IF NOT EXISTS loading_notes text;

ALTER TABLE events
ADD COLUMN IF NOT EXISTS loading_locked boolean NOT NULL DEFAULT false;

ALTER TABLE events
ADD COLUMN IF NOT EXISTS loading_unlock_requested boolean NOT NULL DEFAULT false;

ALTER TABLE events
ADD COLUMN IF NOT EXISTS loading_unlock_requested_at timestamptz;

ALTER TABLE events
ADD COLUMN IF NOT EXISTS loading_unlock_requested_by uuid REFERENCES employees(id);

ALTER TABLE events
ADD COLUMN IF NOT EXISTS loading_unlock_reason text;
