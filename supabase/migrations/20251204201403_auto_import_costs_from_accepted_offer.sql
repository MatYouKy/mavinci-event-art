/*
  # Automatyczny import kosztów z zaakceptowanej oferty

  1. Funkcja importująca koszty
    - Tworzy event_costs z offer_products gdy oferta jest zaakceptowana
    - Uwzględnia: koszt produktu, transport, logistyka, personel
    - Działa z SECURITY DEFINER aby ominąć RLS
    
  2. Trigger na offers
    - Automatycznie wywołuje import gdy status zmienia się na 'accepted'
    - Pomija duplikaty (sprawdza czy koszty już istnieją)
    
  3. Kategorie kosztów
    - Automatycznie przypisuje właściwe kategorie
*/

-- Dodaj politykę dla service role aby trigger mógł działać
CREATE POLICY "Allow service_role to manage event_costs"
ON event_costs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Funkcja importująca koszty z oferty
CREATE OR REPLACE FUNCTION import_costs_from_accepted_offer(p_offer_id uuid, p_event_id uuid)
RETURNS integer AS $$
DECLARE
  v_costs_added integer := 0;
  v_product_category_id uuid;
  v_transport_category_id uuid;
  v_logistics_category_id uuid;
  v_staff_category_id uuid;
  offer_record record;
  product_record record;
  staff_record record;
BEGIN
  -- Sprawdź czy już nie zaimportowano kosztów z tej oferty
  IF EXISTS (
    SELECT 1 FROM event_costs 
    WHERE event_id = p_event_id 
    AND notes LIKE '%Automatycznie z oferty%' || p_offer_id::text || '%'
  ) THEN
    RETURN 0; -- Już zaimportowano
  END IF;

  -- Pobierz ID kategorii
  SELECT id INTO v_product_category_id FROM event_cost_categories WHERE name ILIKE '%produkt%' OR name ILIKE '%sprzęt%' LIMIT 1;
  SELECT id INTO v_transport_category_id FROM event_cost_categories WHERE name ILIKE '%transport%' LIMIT 1;
  SELECT id INTO v_logistics_category_id FROM event_cost_categories WHERE name ILIKE '%logistyk%' LIMIT 1;
  SELECT id INTO v_staff_category_id FROM event_cost_categories WHERE name ILIKE '%personel%' OR name ILIKE '%pracown%' LIMIT 1;
  
  -- Jeśli nie ma kategorii "Personel", stwórz ją
  IF v_staff_category_id IS NULL THEN
    INSERT INTO event_cost_categories (name, description, icon, color)
    VALUES ('Personel', 'Koszty wynagrodzeń pracowników', 'users', '#10b981')
    RETURNING id INTO v_staff_category_id;
  END IF;

  -- Użyj pierwszej dostępnej kategorii jako domyślnej
  IF v_product_category_id IS NULL THEN
    SELECT id INTO v_product_category_id FROM event_cost_categories LIMIT 1;
  END IF;

  -- Importuj koszty z offer_products
  FOR product_record IN 
    SELECT 
      op.*,
      ofc.name as category_name
    FROM offer_products op
    LEFT JOIN offer_categories ofc ON op.category_id = ofc.id
    WHERE op.offer_id = p_offer_id
  LOOP
    -- Koszt podstawowy produktu (cost_net lub cost_gross)
    IF COALESCE(product_record.cost_net, 0) > 0 THEN
      INSERT INTO event_costs (
        event_id,
        category_id,
        name,
        description,
        amount,
        cost_date,
        status,
        payment_method,
        notes
      ) VALUES (
        p_event_id,
        v_product_category_id,
        product_record.name || ' (koszt produktu)',
        'Koszt jednostkowy: ' || COALESCE(product_record.cost_net, 0)::text || ' PLN netto, Ilość: ' || product_record.quantity::text,
        COALESCE(product_record.cost_net, 0) * product_record.quantity,
        CURRENT_DATE,
        'pending',
        'transfer',
        'Automatycznie z oferty ' || p_offer_id::text
      );
      v_costs_added := v_costs_added + 1;
    END IF;

    -- Koszt transportu
    IF COALESCE(product_record.transport_cost_net, 0) > 0 THEN
      INSERT INTO event_costs (
        event_id,
        category_id,
        name,
        description,
        amount,
        cost_date,
        status,
        payment_method,
        notes
      ) VALUES (
        p_event_id,
        COALESCE(v_transport_category_id, v_product_category_id),
        product_record.name || ' (transport)',
        'Koszt transportu dla ' || product_record.quantity::text || ' szt.',
        COALESCE(product_record.transport_cost_net, 0) * product_record.quantity,
        CURRENT_DATE,
        'pending',
        'transfer',
        'Automatycznie z oferty ' || p_offer_id::text
      );
      v_costs_added := v_costs_added + 1;
    END IF;

    -- Koszt logistyki
    IF COALESCE(product_record.logistics_cost_net, 0) > 0 THEN
      INSERT INTO event_costs (
        event_id,
        category_id,
        name,
        description,
        amount,
        cost_date,
        status,
        payment_method,
        notes
      ) VALUES (
        p_event_id,
        COALESCE(v_logistics_category_id, v_product_category_id),
        product_record.name || ' (logistyka)',
        'Koszt logistyki dla ' || product_record.quantity::text || ' szt.',
        COALESCE(product_record.logistics_cost_net, 0) * product_record.quantity,
        CURRENT_DATE,
        'pending',
        'transfer',
        'Automatycznie z oferty ' || p_offer_id::text
      );
      v_costs_added := v_costs_added + 1;
    END IF;

    -- Koszt personelu
    IF COALESCE(product_record.staff_cost_net, 0) > 0 THEN
      INSERT INTO event_costs (
        event_id,
        category_id,
        name,
        description,
        amount,
        cost_date,
        status,
        payment_method,
        notes
      ) VALUES (
        p_event_id,
        v_staff_category_id,
        product_record.name || ' (personel)',
        'Koszt personelu dla produktu',
        COALESCE(product_record.staff_cost_net, 0),
        CURRENT_DATE,
        'pending',
        'transfer',
        'Automatycznie z oferty ' || p_offer_id::text
      );
      v_costs_added := v_costs_added + 1;
    END IF;
  END LOOP;

  -- Importuj dodatkowe koszty personelu z offer_product_staff
  FOR staff_record IN
    SELECT 
      ops.*,
      op.name as product_name
    FROM offer_product_staff ops
    JOIN offer_products op ON ops.product_id = op.id
    WHERE op.offer_id = p_offer_id
  LOOP
    -- Oblicz koszt dla tego pracownika
    DECLARE
      staff_cost numeric;
    BEGIN
      staff_cost := staff_record.quantity * 
                    COALESCE(staff_record.hourly_rate, 0) * 
                    COALESCE(staff_record.estimated_hours, 0);
      
      IF staff_cost > 0 THEN
        INSERT INTO event_costs (
          event_id,
          category_id,
          name,
          description,
          amount,
          cost_date,
          status,
          payment_method,
          notes
        ) VALUES (
          p_event_id,
          v_staff_category_id,
          staff_record.role || ' - ' || staff_record.product_name,
          'Stawka: ' || COALESCE(staff_record.hourly_rate, 0)::text || ' PLN/h × ' || 
          COALESCE(staff_record.estimated_hours, 0)::text || 'h × ' || 
          staff_record.quantity::text || ' os. (' || staff_record.payment_type || ')',
          staff_cost,
          CURRENT_DATE,
          'pending',
          CASE 
            WHEN staff_record.payment_type = 'cash' THEN 'cash'
            ELSE 'transfer'
          END,
          'Automatycznie z oferty ' || p_offer_id::text || ' - ' || staff_record.role
        );
        v_costs_added := v_costs_added + 1;
      END IF;
    END;
  END LOOP;

  RETURN v_costs_added;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION import_costs_from_accepted_offer(uuid, uuid) TO authenticated;

-- Trigger automatycznego importu kosztów
CREATE OR REPLACE FUNCTION trigger_auto_import_costs_from_offer()
RETURNS TRIGGER AS $$
DECLARE
  costs_count integer;
BEGIN
  -- Gdy oferta jest zaakceptowana i powiązana z eventem
  IF NEW.status = 'accepted' AND NEW.event_id IS NOT NULL THEN
    -- Sprawdź czy to zmiana statusu (nie było accepted wcześniej)
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status != 'accepted') THEN
      -- Importuj koszty
      SELECT import_costs_from_accepted_offer(NEW.id, NEW.event_id) INTO costs_count;
      
      RAISE NOTICE 'Zaimportowano % kosztów z oferty % do eventu %', costs_count, NEW.id, NEW.event_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_auto_import_costs_from_offer ON offers;
CREATE TRIGGER trigger_auto_import_costs_from_offer
  AFTER INSERT OR UPDATE OF status ON offers
  FOR EACH ROW
  EXECUTE FUNCTION trigger_auto_import_costs_from_offer();

COMMENT ON FUNCTION import_costs_from_accepted_offer IS 'Importuje koszty z zaakceptowanej oferty do event_costs';
COMMENT ON FUNCTION trigger_auto_import_costs_from_offer IS 'Automatycznie importuje koszty gdy oferta jest zaakceptowana';
