/*
  # Fix ambiguous event_id in import_costs_from_accepted_offer

  1. Problem
    - Column reference "event_id" is ambiguous
    - Could refer to either function parameter or table column
    
  2. Solution
    - Add table prefix to all event_id column references
*/

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
    SELECT 1 FROM event_costs ec
    WHERE ec.event_id = p_event_id 
    AND ec.notes LIKE '%Automatycznie z oferty%' || p_offer_id::text || '%'
  ) THEN
    RETURN 0;
  END IF;

  -- Pobierz ID kategorii
  SELECT id INTO v_product_category_id FROM event_cost_categories WHERE name ILIKE '%produkt%' OR name ILIKE '%sprzęt%' LIMIT 1;
  SELECT id INTO v_transport_category_id FROM event_cost_categories WHERE name ILIKE '%transport%' LIMIT 1;
  SELECT id INTO v_logistics_category_id FROM event_cost_categories WHERE name ILIKE '%logistyk%' LIMIT 1;
  SELECT id INTO v_staff_category_id FROM event_cost_categories WHERE name ILIKE '%personel%' OR name ILIKE '%pracown%' LIMIT 1;
  
  IF v_staff_category_id IS NULL THEN
    INSERT INTO event_cost_categories (name, description, icon, color)
    VALUES ('Personel', 'Koszty wynagrodzeń pracowników', 'users', '#10b981')
    RETURNING id INTO v_staff_category_id;
  END IF;

  IF v_product_category_id IS NULL THEN
    SELECT id INTO v_product_category_id FROM event_cost_categories LIMIT 1;
  END IF;

  FOR product_record IN 
    SELECT 
      op.*,
      ofc.name as category_name
    FROM offer_products op
    LEFT JOIN offer_categories ofc ON op.category_id = ofc.id
    WHERE op.offer_id = p_offer_id
  LOOP
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

  FOR staff_record IN
    SELECT 
      ops.*,
      op.name as product_name
    FROM offer_product_staff ops
    JOIN offer_products op ON ops.product_id = op.id
    WHERE op.offer_id = p_offer_id
  LOOP
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