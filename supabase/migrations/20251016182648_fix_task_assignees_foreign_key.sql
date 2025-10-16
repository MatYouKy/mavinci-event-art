/*
  # Fix missing foreign key in task_assignees

  1. Problem
    - task_assignees.employee_id doesn't have foreign key constraint to employees
    - This causes Supabase REST API to not recognize the relationship
    
  2. Solution
    - Add foreign key constraint for employee_id -> employees(id)
    - This will enable proper joining in queries
*/

-- Add foreign key constraint for employee_id if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'task_assignees_employee_id_fkey'
  ) THEN
    ALTER TABLE task_assignees 
    ADD CONSTRAINT task_assignees_employee_id_fkey 
    FOREIGN KEY (employee_id) 
    REFERENCES employees(id) 
    ON DELETE CASCADE;
  END IF;
END $$;

-- Also ensure assigned_by has proper foreign key
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'task_assignees_assigned_by_fkey'
  ) THEN
    ALTER TABLE task_assignees 
    ADD CONSTRAINT task_assignees_assigned_by_fkey 
    FOREIGN KEY (assigned_by) 
    REFERENCES employees(id) 
    ON DELETE SET NULL;
  END IF;
END $$;
