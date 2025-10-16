/*
  # Create event audit log table

  1. New Tables
    - `event_audit_log` - Track all changes to events
      - `id` (uuid, primary key)
      - `event_id` (uuid, foreign key to events)
      - `user_id` (uuid, foreign key to employees)
      - `user_name` (text) - Store name for history
      - `action` (text) - Type of action (created, updated, status_changed, etc.)
      - `field_name` (text) - Name of changed field
      - `old_value` (text) - Old value
      - `new_value` (text) - New value
      - `description` (text) - Description of change
      - `created_at` (timestamptz)
  
  2. Security
    - Enable RLS
    - Allow employees with events_manage to view audit log
*/

-- Create event_audit_log table
CREATE TABLE IF NOT EXISTS event_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  user_name text NOT NULL,
  action text NOT NULL,
  field_name text,
  old_value text,
  new_value text,
  description text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_event_audit_log_event_id ON event_audit_log(event_id);
CREATE INDEX IF NOT EXISTS idx_event_audit_log_created_at ON event_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_audit_log_user_id ON event_audit_log(user_id);

-- Enable RLS
ALTER TABLE event_audit_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users with events_manage can view audit log"
  ON event_audit_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Users with events_manage can insert audit log"
  ON event_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        employees.role = 'admin'
        OR 'events_manage' = ANY(employees.permissions)
      )
    )
  );

-- Service role can always access (for triggers)
CREATE POLICY "Service role can manage audit log"
  ON event_audit_log
  TO service_role
  USING (true)
  WITH CHECK (true);
