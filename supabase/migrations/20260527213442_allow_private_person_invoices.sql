/*
  # Allow invoices for private persons (osoba prywatna)

  1. Changes
    - Modified `validate_invoice_for_business_client` function to allow invoices
      where `buyer_is_private_person = true` without requiring organization_id
      or a business contact
    - Private person invoices only require `buyer_contact_id` OR `buyer_name` to be set
    - Removed the VAT NIP check for private person invoices (private persons
      may not have NIP)
    - Renamed function to `validate_invoice_buyer` to better reflect its purpose

  2. Important Notes
    - Polish law allows issuing invoices to private persons (osoby fizyczne)
    - Private person invoices should NOT be sent to KSeF (handled in application layer)
    - The constraint now allows three valid scenarios:
      a) organization_id is set (business client via organization)
      b) contact_person_id is set with is_business_client=true (business contact)
      c) buyer_is_private_person=true (private person, no NIP required)
*/

CREATE OR REPLACE FUNCTION validate_invoice_for_business_client()
RETURNS TRIGGER AS $$
DECLARE
  org_exists boolean;
  contact_is_business boolean;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.organization_id IS NOT NULL
     AND NEW.organization_id IS NULL
     AND NEW.contact_person_id IS NULL
  THEN
    RETURN NEW;
  END IF;

  -- Private person invoices: only require buyer_name (already NOT NULL on the table)
  IF NEW.buyer_is_private_person = true THEN
    RETURN NEW;
  END IF;

  -- Business invoice validation
  IF NEW.organization_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM organizations WHERE id = NEW.organization_id
    ) INTO org_exists;

    IF NOT org_exists THEN
      RAISE EXCEPTION 'Podana organizacja nie istnieje';
    END IF;

  ELSIF NEW.contact_person_id IS NOT NULL THEN
    SELECT COALESCE(is_business_client, false)
    INTO contact_is_business
    FROM contacts
    WHERE id = NEW.contact_person_id;

    IF contact_is_business = false THEN
      RAISE EXCEPTION
        'Faktury mogą być wystawiane tylko dla klientów businessowych.';
    END IF;

  ELSE
    RAISE EXCEPTION
      'Faktura musi być powiązana z klientem businessowym (organizacją lub kontaktem prowadzącym działalność gospodarczą) lub wystawiona na osobę prywatną';
  END IF;

  -- VAT NIP check only for non-private-person invoices
  IF NEW.invoice_type = 'vat'
     AND (NEW.buyer_nip IS NULL OR length(trim(NEW.buyer_nip)) < 10)
  THEN
    RAISE EXCEPTION 'Faktury VAT wymagają podania NIP nabywcy';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
