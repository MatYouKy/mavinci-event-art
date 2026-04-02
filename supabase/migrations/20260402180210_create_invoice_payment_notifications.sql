/*
  # System powiadomień o terminach płatności faktur KSeF

  1. Funkcje
    - Funkcja do wysyłania powiadomień o zbliżających się terminach płatności
    - Powiadomienia wysyłane: 3 dni przed, 1 dzień przed, po terminie

  2. Triggery
    - Trigger do sprawdzania i wysyłania powiadomień

  3. Kategorie powiadomień
    - payment_reminder_3days - Przypomnienie 3 dni przed terminem
    - payment_reminder_1day - Przypomnienie 1 dzień przed terminem
    - payment_overdue - Płatność po terminie

  4. Security
    - Funkcja uruchamiana przez system (SECURITY DEFINER)
*/

-- Funkcja do sprawdzania i wysyłania powiadomień o płatnościach
CREATE OR REPLACE FUNCTION check_and_notify_invoice_payments()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invoice RECORD;
  v_admin_ids uuid[];
  v_notification_id uuid;
BEGIN
  -- Pobierz IDs administratorów którzy mają uprawnienie ksef_manage
  SELECT ARRAY_AGG(id)
  INTO v_admin_ids
  FROM employees
  WHERE permissions @> ARRAY['ksef_manage']::text[]
    OR permissions @> ARRAY['admin']::text[];

  IF v_admin_ids IS NULL OR array_length(v_admin_ids, 1) = 0 THEN
    RETURN;
  END IF;

  -- Sprawdź faktury z terminem płatności za 3 dni
  FOR v_invoice IN
    SELECT *
    FROM ksef_invoices
    WHERE payment_status = 'unpaid'
      AND payment_due_date = CURRENT_DATE + INTERVAL '3 days'
      AND NOT EXISTS (
        SELECT 1
        FROM notifications n
        INNER JOIN notification_recipients nr ON n.id = nr.notification_id
        WHERE n.entity_type = 'ksef_invoice'
          AND n.entity_id = ksef_invoices.id
          AND n.category = 'payment_reminder_3days'
          AND n.created_at::date = CURRENT_DATE
      )
  LOOP
    -- Utwórz powiadomienie
    INSERT INTO notifications (
      title,
      message,
      category,
      entity_type,
      entity_id,
      action_url,
      created_at
    ) VALUES (
      'Zbliża się termin płatności faktury',
      'Faktura ' || COALESCE(v_invoice.invoice_number, 'nr ' || v_invoice.ksef_reference_number) || 
      ' - termin płatności za 3 dni (' || TO_CHAR(v_invoice.payment_due_date, 'DD.MM.YYYY') || ')',
      'payment_reminder_3days',
      'ksef_invoice',
      v_invoice.id,
      '/crm/settings/ksef',
      NOW()
    ) RETURNING id INTO v_notification_id;

    -- Dodaj odbiorców (administratorów)
    INSERT INTO notification_recipients (notification_id, employee_id, is_read)
    SELECT v_notification_id, unnest(v_admin_ids), false;
  END LOOP;

  -- Sprawdź faktury z terminem płatności za 1 dzień
  FOR v_invoice IN
    SELECT *
    FROM ksef_invoices
    WHERE payment_status = 'unpaid'
      AND payment_due_date = CURRENT_DATE + INTERVAL '1 day'
      AND NOT EXISTS (
        SELECT 1
        FROM notifications n
        INNER JOIN notification_recipients nr ON n.id = nr.notification_id
        WHERE n.entity_type = 'ksef_invoice'
          AND n.entity_id = ksef_invoices.id
          AND n.category = 'payment_reminder_1day'
          AND n.created_at::date = CURRENT_DATE
      )
  LOOP
    INSERT INTO notifications (
      title,
      message,
      category,
      entity_type,
      entity_id,
      action_url,
      created_at
    ) VALUES (
      'PILNE: Jutro termin płatności faktury',
      'Faktura ' || COALESCE(v_invoice.invoice_number, 'nr ' || v_invoice.ksef_reference_number) || 
      ' - termin płatności jutro (' || TO_CHAR(v_invoice.payment_due_date, 'DD.MM.YYYY') || ')',
      'payment_reminder_1day',
      'ksef_invoice',
      v_invoice.id,
      '/crm/settings/ksef',
      NOW()
    ) RETURNING id INTO v_notification_id;

    INSERT INTO notification_recipients (notification_id, employee_id, is_read)
    SELECT v_notification_id, unnest(v_admin_ids), false;
  END LOOP;

  -- Sprawdź faktury po terminie (status zmienia się na overdue)
  FOR v_invoice IN
    SELECT *
    FROM ksef_invoices
    WHERE payment_status = 'unpaid'
      AND payment_due_date < CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1
        FROM notifications n
        INNER JOIN notification_recipients nr ON n.id = nr.notification_id
        WHERE n.entity_type = 'ksef_invoice'
          AND n.entity_id = ksef_invoices.id
          AND n.category = 'payment_overdue'
          AND n.created_at::date = CURRENT_DATE
      )
  LOOP
    -- Zmień status na overdue
    UPDATE ksef_invoices
    SET payment_status = 'overdue'
    WHERE id = v_invoice.id;

    -- Wyślij powiadomienie
    INSERT INTO notifications (
      title,
      message,
      category,
      entity_type,
      entity_id,
      action_url,
      created_at
    ) VALUES (
      'UWAGA: Płatność po terminie',
      'Faktura ' || COALESCE(v_invoice.invoice_number, 'nr ' || v_invoice.ksef_reference_number) || 
      ' - minął termin płatności (' || TO_CHAR(v_invoice.payment_due_date, 'DD.MM.YYYY') || ')',
      'payment_overdue',
      'ksef_invoice',
      v_invoice.id,
      '/crm/settings/ksef',
      NOW()
    ) RETURNING id INTO v_notification_id;

    INSERT INTO notification_recipients (notification_id, employee_id, is_read)
    SELECT v_notification_id, unnest(v_admin_ids), false;
  END LOOP;
END;
$$;

-- Komentarz
COMMENT ON FUNCTION check_and_notify_invoice_payments() IS 'Sprawdza faktury i wysyła powiadomienia o zbliżających się terminach płatności (3 dni, 1 dzień) oraz o płatnościach po terminie';
