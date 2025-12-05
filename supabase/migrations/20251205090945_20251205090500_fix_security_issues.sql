/*
  # Fix Critical Security Issues
  
  1. Changes
    - Drop old employee_permissions table (permissions are now in employees.permissions)
    - Fix views using SECURITY DEFINER to use SECURITY INVOKER
    - Ensure all views respect RLS
  
  2. Security
    - Remove public access to employee_permissions
    - Fix SECURITY DEFINER views that bypass RLS
*/

-- Drop old employee_permissions table
DROP TABLE IF EXISTS employee_permissions CASCADE;

-- Recreate views with SECURITY INVOKER instead of SECURITY DEFINER
-- This ensures views respect RLS policies

-- Fleet overview view
DROP VIEW IF EXISTS public.fleet_overview CASCADE;
CREATE OR REPLACE VIEW public.fleet_overview
WITH (security_invoker = true)
AS
SELECT 
  v.id,
  v.name,
  v.vehicle_type,
  v.registration_number,
  v.status,
  v.current_mileage,
  COUNT(DISTINCT ev.event_id) FILTER (WHERE ev.status = 'assigned') as active_assignments,
  COUNT(DISTINCT vh.id) FILTER (WHERE vh.event_vehicle_id IN (
    SELECT id FROM event_vehicles WHERE vehicle_id = v.id
  )) as active_handovers,
  MAX(vh.created_at) as last_handover,
  v.created_at,
  v.updated_at
FROM vehicles v
LEFT JOIN event_vehicles ev ON v.id = ev.vehicle_id
LEFT JOIN vehicle_handovers vh ON ev.id = vh.event_vehicle_id
GROUP BY v.id;

-- Vehicle reservation conflicts view  
DROP VIEW IF EXISTS public.vehicle_reservation_conflicts CASCADE;
CREATE OR REPLACE VIEW public.vehicle_reservation_conflicts
WITH (security_invoker = true)
AS
SELECT 
  ev1.vehicle_id,
  v.name as vehicle_name,
  v.registration_number,
  ev1.event_id as event_id_1,
  e1.name as event_name_1,
  ev1.vehicle_available_from as available_from_1,
  ev1.vehicle_available_until as available_until_1,
  ev2.event_id as event_id_2,
  e2.name as event_name_2,
  ev2.vehicle_available_from as available_from_2,
  ev2.vehicle_available_until as available_until_2
FROM event_vehicles ev1
JOIN event_vehicles ev2 ON 
  ev1.vehicle_id = ev2.vehicle_id 
  AND ev1.event_id < ev2.event_id
JOIN vehicles v ON ev1.vehicle_id = v.id
JOIN events e1 ON ev1.event_id = e1.id
JOIN events e2 ON ev2.event_id = e2.id
WHERE 
  ev1.status = 'assigned'
  AND ev2.status = 'assigned'
  AND ev1.vehicle_available_from < ev2.vehicle_available_until
  AND ev2.vehicle_available_from < ev1.vehicle_available_until;

-- Admin time entries view
DROP VIEW IF EXISTS public.admin_time_entries_view CASCADE;
CREATE OR REPLACE VIEW public.admin_time_entries_view
WITH (security_invoker = true)
AS
SELECT 
  te.id,
  te.employee_id,
  COALESCE(e.name || ' ' || e.surname, e.name, e.email) as employee_name,
  te.event_id,
  ev.name as event_name,
  te.start_time,
  te.end_time,
  te.duration_minutes,
  te.title,
  te.description,
  te.is_billable,
  te.hourly_rate,
  te.created_at,
  te.updated_at
FROM time_entries te
LEFT JOIN employees e ON te.employee_id = e.id
LEFT JOIN events ev ON te.event_id = ev.id;

-- Admin time entries history view (drop only, table doesn't exist)
DROP VIEW IF EXISTS public.admin_time_entries_history_view CASCADE;

-- Event audit log with user id view (user_name already exists in table)
DROP VIEW IF EXISTS public.event_audit_log_with_user_id CASCADE;
CREATE OR REPLACE VIEW public.event_audit_log_with_user_id
WITH (security_invoker = true)
AS
SELECT eal.*
FROM event_audit_log eal;

-- Grant access to authenticated users (RLS will control actual access)
GRANT SELECT ON public.fleet_overview TO authenticated;
GRANT SELECT ON public.vehicle_reservation_conflicts TO authenticated;
GRANT SELECT ON public.admin_time_entries_view TO authenticated;
GRANT SELECT ON public.event_audit_log_with_user_id TO authenticated;
