/*
  # Add Absence Categories to Notifications

  1. Changes
    - Update notifications_category_check constraint to include absence categories
    - Add: absence_request, absence_approved, absence_rejected
*/

-- Drop old constraint
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;

-- Add new constraint with absence categories
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check 
  CHECK (category = ANY (ARRAY[
    'client'::text,
    'event'::text,
    'offer'::text,
    'employee'::text,
    'system'::text,
    'global'::text,
    'contact_form'::text,
    'tasks'::text,
    'event_assignment'::text,
    'event_update'::text,
    'message_assignment'::text,
    'email_received'::text,
    'vehicle_conflict'::text,
    'absence_request'::text,
    'absence_approved'::text,
    'absence_rejected'::text
  ]));
