/*
  # Dodanie nowych wartości do statusu umowy - część 1

  1. Zmiany
    - Dodanie nowych wartości do typu contract_status
    
  2. Nowe statusy
    - issued (wystawiona)
    - signed_by_client (podpisana przez klienta)
    - signed_returned (podpisana odesłana)
*/

-- Dodaj nowe wartości do enum (jeśli nie istnieją)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'issued' 
    AND enumtypid = 'contract_status'::regtype
  ) THEN
    ALTER TYPE contract_status ADD VALUE 'issued' AFTER 'draft';
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'signed_by_client' 
    AND enumtypid = 'contract_status'::regtype
  ) THEN
    ALTER TYPE contract_status ADD VALUE 'signed_by_client' AFTER 'sent';
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'signed_returned' 
    AND enumtypid = 'contract_status'::regtype
  ) THEN
    ALTER TYPE contract_status ADD VALUE 'signed_returned' AFTER 'signed_by_client';
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
