/*
  # Disable RLS for Team Members (Development)

  This migration disables Row Level Security for the team_members table
  to allow the admin interface to work without authentication during development.

  ## Changes
  - Disable RLS for team_members table

  ## Security Note
  In production, enable RLS and create proper authenticated admin-only policies.
*/

-- Disable Row Level Security for team_members (development only)
ALTER TABLE team_members DISABLE ROW LEVEL SECURITY;
