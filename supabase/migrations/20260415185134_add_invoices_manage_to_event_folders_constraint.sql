/*
  # Add invoices_manage permission to event_folders check constraint

  1. Changes
    - Updates the `event_folders_required_permission_check` constraint to include `invoices_manage`
    - This allows creating invoice-related subfolders in the event documents structure

  2. Reason
    - Invoice PDF generation needs to create a "Faktury" subfolder with `invoices_manage` permission
    - The existing constraint only allowed: contracts_manage, finances_manage, offers_create, events_manage
*/

ALTER TABLE event_folders DROP CONSTRAINT IF EXISTS event_folders_required_permission_check;

ALTER TABLE event_folders ADD CONSTRAINT event_folders_required_permission_check
  CHECK (
    required_permission IS NULL
    OR required_permission = ANY (ARRAY[
      'contracts_manage',
      'finances_manage',
      'offers_create',
      'events_manage',
      'invoices_manage'
    ]::text[])
  );
