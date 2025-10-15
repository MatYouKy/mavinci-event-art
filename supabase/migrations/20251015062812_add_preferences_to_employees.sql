/*
  # Add Preferences to Employees

  ## Purpose
  - Store user preferences for different modules and features
  - Each preference is scoped to a specific module (e.g., clients, equipment, events)
  - Preferences include view mode (list/grid), notifications settings, etc.
  
  ## Structure
  preferences = {
    "clients": {
      "viewMode": "list",
      "sortBy": "name",
      "sortOrder": "asc"
    },
    "equipment": {
      "viewMode": "grid",
      "sortBy": "name"
    },
    "notifications": {
      "email": true,
      "push": false,
      "categories": {
        "messages": true,
        "events": true,
        "tasks": false
      }
    }
  }
  
  ## Notes
  - NULL means use system defaults
  - Each module can have its own preferences
  - Changes in one module don't affect others
*/

-- Add preferences column to employees
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'preferences'
  ) THEN
    ALTER TABLE employees 
    ADD COLUMN preferences JSONB DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Add comment
COMMENT ON COLUMN employees.preferences IS 'User preferences stored as JSONB with module-specific settings';

-- Create index for faster JSONB queries
CREATE INDEX IF NOT EXISTS idx_employees_preferences ON employees USING gin(preferences);
