-- Zapis ustawień sprzedawcy kończył się błędem `record "old" has no field "sales_partner_id"` (CRM i aplikacja na Maca).
-- Przyczyna: wspólna funkcja wyzwalacza `private.settlement_partner_terms_changed()` (tabele `sales_partner_brand_terms`
-- i `sales_partner_profiles`, migracja 20261105130000_event_settlement_commissions.sql) wybierała identyfikator sprzedawcy jednym
-- wyrażeniem CASE. PL/pgSQL rozpoznaje pola NEW/OLD całego wyrażenia przy jego przygotowaniu — także w gałęzi, która się nie
-- wykona — więc każda zmiana statusu, rodzaju współpracy albo kontaktu w `sales_partner_profiles` (tabela bez kolumny
-- `sales_partner_id`) przerywała zapis. Teraz każda tabela czyta swoje pole osobną instrukcją. Odświeżanie prowizji bez zmian.

CREATE OR REPLACE FUNCTION private.settlement_partner_terms_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r record;
  v_partner uuid;
BEGIN
  IF private.commission_engine_active() THEN RETURN NULL; END IF;
  -- Osobne instrukcje: pole wyrażenia jest sprawdzane tylko wtedy, gdy instrukcja się wykonuje.
  IF TG_TABLE_NAME = 'sales_partner_profiles' THEN
    IF TG_OP = 'DELETE' THEN v_partner := OLD.id; ELSE v_partner := NEW.id; END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_partner := OLD.sales_partner_id;
  ELSE
    v_partner := NEW.sales_partner_id;
  END IF;
  IF v_partner IS NULL THEN RETURN NULL; END IF;
  FOR r IN
    SELECT DISTINCT x.event_id FROM (
      SELECT c.event_id FROM public.event_commissions c WHERE c.sales_partner_id = v_partner AND c.status IN ('planned', 'cancelled')
      UNION SELECT e.id FROM public.events e WHERE e.referring_sales_partner_id = v_partner
      UNION SELECT a.event_id FROM public.event_partner_arrangements a JOIN public.sales_partner_profiles p ON p.contact_id = a.contact_id WHERE p.id = v_partner
      UNION SELECT b.event_id FROM public.event_billing_contacts b JOIN public.sales_partner_profiles p ON p.contact_id = b.contact_id WHERE p.id = v_partner
      UNION SELECT o.event_id FROM public.offers o WHERE o.sales_partner_id = v_partner AND o.status::text = 'accepted'
    ) x JOIN public.events e ON e.id = x.event_id
    WHERE e.status::text NOT IN ('cancelled', 'settled') AND private.event_settlement_status(x.event_id) <> 'approved'
  LOOP
    PERFORM private.refresh_event_commissions_safe(r.event_id);
  END LOOP;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION private.settlement_partner_terms_changed() FROM PUBLIC, anon, authenticated;
