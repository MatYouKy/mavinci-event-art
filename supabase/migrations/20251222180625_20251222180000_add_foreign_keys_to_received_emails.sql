/*
  # Add Foreign Keys to received_emails
  
  1. Changes
    - Add foreign key constraint from assigned_to to employees(id)
    - Add foreign key constraint from assigned_by to employees(id)
    - This fixes PostgREST relationship lookup for joins
    
  2. Security
    - No RLS changes, just referential integrity
*/

-- Add foreign key for assigned_to
ALTER TABLE received_emails
  DROP CONSTRAINT IF EXISTS received_emails_assigned_to_fkey;

ALTER TABLE received_emails
  ADD CONSTRAINT received_emails_assigned_to_fkey
  FOREIGN KEY (assigned_to)
  REFERENCES employees(id)
  ON DELETE SET NULL;

-- Add foreign key for assigned_by
ALTER TABLE received_emails
  DROP CONSTRAINT IF EXISTS received_emails_assigned_by_fkey;

ALTER TABLE received_emails
  ADD CONSTRAINT received_emails_assigned_by_fkey
  FOREIGN KEY (assigned_by)
  REFERENCES employees(id)
  ON DELETE SET NULL;
