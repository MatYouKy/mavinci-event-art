/*
  # Add Team Categories to Notifications

  Dodaje kategorie team_invitation i team_response do dozwolonych kategorii powiadomień.
*/

ALTER TABLE notifications 
DROP CONSTRAINT IF EXISTS notifications_category_check;

ALTER TABLE notifications 
ADD CONSTRAINT notifications_category_check 
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
  'absence_rejected'::text,
  'team_invitation'::text,
  'team_response'::text
]));