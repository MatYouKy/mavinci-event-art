-- Update event_audit_log to match new structure
DO $$
BEGIN
  -- Add employee_id if it doesn't exist (rename from user_id)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_audit_log' AND column_name = 'user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_audit_log' AND column_name = 'employee_id'
  ) THEN
    ALTER TABLE event_audit_log RENAME COLUMN user_id TO employee_id;
  END IF;

  -- Add employee_id column if it still doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_audit_log' AND column_name = 'employee_id'
  ) THEN
    ALTER TABLE event_audit_log ADD COLUMN employee_id uuid REFERENCES employees(id) ON DELETE CASCADE;
  END IF;

  -- Add missing columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_audit_log' AND column_name = 'entity_type'
  ) THEN
    ALTER TABLE event_audit_log ADD COLUMN entity_type text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_audit_log' AND column_name = 'entity_id'
  ) THEN
    ALTER TABLE event_audit_log ADD COLUMN entity_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_audit_log' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE event_audit_log ADD COLUMN metadata jsonb DEFAULT '{}';
  END IF;

  -- Update old_value and new_value to jsonb if they're text
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_audit_log' 
    AND column_name = 'old_value' 
    AND data_type = 'text'
  ) THEN
    ALTER TABLE event_audit_log ALTER COLUMN old_value TYPE jsonb USING old_value::jsonb;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_audit_log' 
    AND column_name = 'new_value' 
    AND data_type = 'text'
  ) THEN
    ALTER TABLE event_audit_log ALTER COLUMN new_value TYPE jsonb USING new_value::jsonb;
  END IF;
END $$;

-- Add indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_event_audit_log_event_id ON event_audit_log(event_id);
CREATE INDEX IF NOT EXISTS idx_event_audit_log_employee_id ON event_audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_event_audit_log_created_at ON event_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_audit_log_action ON event_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_event_audit_log_entity_type ON event_audit_log(entity_type);

-- Enable RLS if not already enabled
ALTER TABLE event_audit_log ENABLE ROW LEVEL SECURITY;

-- Drop old policies
DROP POLICY IF EXISTS "Authenticated users can view audit logs" ON event_audit_log;
DROP POLICY IF EXISTS "System can insert audit logs" ON event_audit_log;

-- Create new policies
CREATE POLICY "Authenticated users can view audit logs"
  ON event_audit_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can insert audit logs"
  ON event_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (true);