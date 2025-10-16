-- Make user_name nullable since we may not always have it
ALTER TABLE event_audit_log ALTER COLUMN user_name DROP NOT NULL;

-- Set default empty string if needed
ALTER TABLE event_audit_log ALTER COLUMN user_name SET DEFAULT '';