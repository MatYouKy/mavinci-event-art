/*
  # Fix Events RLS and Category Colors

  1. Changes
    - Fix events SELECT policy so admins with events_manage can see ALL events
    - Fix event_categories policy so all authenticated users can see categories
    - This fixes the issue where:
      a) Admins couldn't see all events (were filtered like regular users)
      b) Team members couldn't see event category colors

  2. Security
    - Maintains security for non-admin users (they see only their events)
    - Admins with events_manage get full visibility
    - Event categories are public info (just names and colors)
*/

-- Drop and recreate the SELECT policy with proper admin access
DROP POLICY IF EXISTS "Users can view own and assigned events" ON events;

CREATE POLICY "Users can view own and assigned events"
  ON events FOR SELECT
  TO authenticated
  USING (
    -- Admins with events_manage can see ALL events
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND 'events_manage' = ANY(emp.permissions)
    )
    -- OR user is the creator
    OR auth.uid() = created_by
    -- OR user is assigned to the event
    OR EXISTS (
      SELECT 1 FROM employee_assignments ea
      WHERE ea.event_id = events.id
      AND ea.employee_id = auth.uid()
    )
  );

-- Fix event_categories SELECT policy - categories should be visible to all authenticated users
DROP POLICY IF EXISTS "Authenticated employees can view event categories" ON event_categories;

CREATE POLICY "Authenticated employees can view event categories"
  ON event_categories FOR SELECT
  TO authenticated
  USING (true);  -- All authenticated users can view categories (they're just names and colors)
