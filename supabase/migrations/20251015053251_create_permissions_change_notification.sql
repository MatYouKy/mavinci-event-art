/*
  # Notification System for Permission Changes

  ## Purpose
  - Notify employees when their permissions are changed
  - Show which permissions were added/removed
  - Create one notification with detailed breakdown
  
  ## Strategy
  1. Create helper function to compare old/new permissions arrays
  2. Create trigger that fires on UPDATE of employees.permissions
  3. Generate human-readable message listing changes
  4. Create notification + recipient for affected employee
*/

-- Function to translate permission keys to Polish labels
CREATE OR REPLACE FUNCTION translate_permission_key(perm_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN CASE perm_key
    -- Equipment
    WHEN 'equipment_view' THEN 'Sprzęt - Przeglądanie'
    WHEN 'equipment_manage' THEN 'Sprzęt - Zarządzanie'
    WHEN 'equipment_create' THEN 'Sprzęt - Tworzenie'
    
    -- Employees
    WHEN 'employees_view' THEN 'Pracownicy - Przeglądanie'
    WHEN 'employees_manage' THEN 'Pracownicy - Zarządzanie'
    WHEN 'employees_create' THEN 'Pracownicy - Tworzenie'
    WHEN 'employees_permissions' THEN 'Pracownicy - Uprawnienia'
    
    -- Clients
    WHEN 'clients_view' THEN 'Klienci - Przeglądanie'
    WHEN 'clients_manage' THEN 'Klienci - Zarządzanie'
    WHEN 'clients_create' THEN 'Klienci - Tworzenie'
    
    -- Events
    WHEN 'events_view' THEN 'Wydarzenia - Przeglądanie'
    WHEN 'events_manage' THEN 'Wydarzenia - Zarządzanie'
    WHEN 'events_create' THEN 'События - Tworzenie'
    
    -- Calendar
    WHEN 'calendar_view' THEN 'Kalendarz - Przeglądanie'
    WHEN 'calendar_manage' THEN 'Kalendarz - Zarządzanie'
    
    -- Tasks
    WHEN 'tasks_view' THEN 'Zadania - Przeglądanie'
    WHEN 'tasks_manage' THEN 'Zadania - Zarządzanie'
    WHEN 'tasks_create' THEN 'Zadania - Tworzenie'
    
    -- Offers
    WHEN 'offers_view' THEN 'Oferty - Przeglądanie'
    WHEN 'offers_manage' THEN 'Oferty - Zarządzanie'
    WHEN 'offers_create' THEN 'Oferty - Tworzenie'
    
    -- Contracts
    WHEN 'contracts_view' THEN 'Umowy - Przeglądanie'
    WHEN 'contracts_manage' THEN 'Umowy - Zarządzanie'
    WHEN 'contracts_create' THEN 'Umowy - Tworzenie'
    
    -- Attractions
    WHEN 'attractions_view' THEN 'Atrakcje - Przeglądanie'
    WHEN 'attractions_manage' THEN 'Atrakcje - Zarządzanie'
    WHEN 'attractions_create' THEN 'Atrakcje - Tworzenie'
    
    -- Messages
    WHEN 'messages_view' THEN 'Wiadomości - Przeglądanie'
    WHEN 'messages_manage' THEN 'Wiadomości - Zarządzanie'
    WHEN 'messages_assign' THEN 'Wiadomości - Przypisywanie'
    
    -- Financials
    WHEN 'financials_view' THEN 'Finanse - Przeglądanie'
    WHEN 'financials_manage' THEN 'Finanse - Zarządzanie'
    
    ELSE perm_key
  END;
END;
$$;

-- Trigger function for permission changes
CREATE OR REPLACE FUNCTION notify_permission_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_perms TEXT[] := COALESCE(OLD.permissions, ARRAY[]::TEXT[]);
  new_perms TEXT[] := COALESCE(NEW.permissions, ARRAY[]::TEXT[]);
  added_perms TEXT[];
  removed_perms TEXT[];
  perm TEXT;
  added_list TEXT := '';
  removed_list TEXT := '';
  notification_message TEXT;
  new_notification_id UUID;
BEGIN
  -- Skip if permissions didn't change
  IF old_perms = new_perms THEN
    RETURN NEW;
  END IF;

  -- Find added permissions
  added_perms := ARRAY(
    SELECT unnest(new_perms)
    EXCEPT
    SELECT unnest(old_perms)
  );

  -- Find removed permissions
  removed_perms := ARRAY(
    SELECT unnest(old_perms)
    EXCEPT
    SELECT unnest(new_perms)
  );

  -- Build added permissions list
  IF array_length(added_perms, 1) > 0 THEN
    added_list := E'\n\nDodane uprawnienia:';
    FOREACH perm IN ARRAY added_perms
    LOOP
      added_list := added_list || E'\n• ' || translate_permission_key(perm);
    END LOOP;
  END IF;

  -- Build removed permissions list
  IF array_length(removed_perms, 1) > 0 THEN
    removed_list := E'\n\nUsunięte uprawnienia:';
    FOREACH perm IN ARRAY removed_perms
    LOOP
      removed_list := removed_list || E'\n• ' || translate_permission_key(perm);
    END LOOP;
  END IF;

  -- Combine message
  notification_message := format(
    'Twoje uprawnienia zostały zaktualizowane.%s%s',
    added_list,
    removed_list
  );

  -- Create notification
  INSERT INTO notifications (
    title,
    message,
    type,
    category,
    action_url,
    related_entity_type,
    related_entity_id,
    created_at
  )
  VALUES (
    'Zmiana uprawnień',
    notification_message,
    'info',
    'system',
    '/crm/employees/' || NEW.id,
    'employees',
    NEW.id::text,
    NOW()
  )
  RETURNING id INTO new_notification_id;

  -- Create recipient for the employee
  INSERT INTO notification_recipients (
    notification_id,
    user_id,
    is_read,
    created_at
  )
  VALUES (
    new_notification_id,
    NEW.id,
    false,
    NOW()
  )
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Drop old trigger if exists
DROP TRIGGER IF EXISTS trigger_notify_permission_changes ON employees;

-- Create trigger
CREATE TRIGGER trigger_notify_permission_changes
  AFTER UPDATE OF permissions ON employees
  FOR EACH ROW
  EXECUTE FUNCTION notify_permission_changes();
