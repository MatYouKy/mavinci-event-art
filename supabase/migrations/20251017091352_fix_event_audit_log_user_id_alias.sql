/*
  # Fix event_audit_log - add user_id alias

  1. Changes
    - Add computed column alias `user_id` pointing to `employee_id`
    - This maintains backwards compatibility with code expecting `user_id`
  
  2. Notes
    - The actual column is `employee_id` 
    - We add a view or use column alias in queries
*/

-- Add a view that exposes employee_id as user_id for compatibility
CREATE OR REPLACE VIEW event_audit_log_with_user_id AS
SELECT 
  id,
  event_id,
  employee_id as user_id,
  user_name,
  action,
  field_name,
  old_value,
  new_value,
  description,
  created_at,
  entity_type,
  entity_id,
  metadata
FROM event_audit_log;

-- Grant access to the view
GRANT SELECT ON event_audit_log_with_user_id TO authenticated, anon, service_role;
