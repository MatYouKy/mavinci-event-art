/*
  # Naprawa triggera status umowy - dodanie ELSE

  1. Zmiany
    - Dodanie ELSE do CASE statement w triggerze
    - Zapobiega błędowi "case not found" dla statusu draft
*/

CREATE OR REPLACE FUNCTION update_contract_status_dates()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    CASE NEW.status::text
      WHEN 'issued' THEN
        NEW.issued_at = COALESCE(NEW.issued_at, now());
      WHEN 'sent' THEN
        NEW.sent_at = COALESCE(NEW.sent_at, now());
      WHEN 'signed_by_client' THEN
        NEW.signed_by_client_at = COALESCE(NEW.signed_by_client_at, now());
      WHEN 'signed_returned' THEN
        NEW.signed_returned_at = COALESCE(NEW.signed_returned_at, now());
      WHEN 'cancelled' THEN
        NEW.cancelled_at = COALESCE(NEW.cancelled_at, now());
      ELSE
        -- draft lub inne statusy - nic nie rób
        NULL;
    END CASE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
