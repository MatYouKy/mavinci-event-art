/*
  # Add is_visible column to team_members

  1. Changes
    - Add `is_visible` boolean column to team_members table
    - Default value: true (all members visible by default)
    - Set all existing members to visible

  2. Notes
    - Existing members will remain visible
    - New members will be visible by default
    - Can be toggled in edit form
*/

-- Add is_visible column with default true
ALTER TABLE team_members
ADD COLUMN IF NOT EXISTS is_visible boolean DEFAULT true NOT NULL;

-- Ensure all existing members are visible
UPDATE team_members SET is_visible = true WHERE is_visible IS NULL;
