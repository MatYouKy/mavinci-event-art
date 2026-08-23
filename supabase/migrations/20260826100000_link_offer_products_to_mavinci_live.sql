-- Powiązanie katalogu produktów oferty z rozszerzalnym rejestrem modułów Mavinci LIVE.

CREATE TABLE IF NOT EXISTS public.mavinci_live_modules (
  module_key text PRIMARY KEY,
  name text NOT NULL,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.mavinci_live_modules (module_key, name, description, display_order)
VALUES
  ('wedding_show', 'Wedding Show', 'Scenariusz wesela, muzyka, ekrany i przebieg całej realizacji.', 10),
  ('quiz_show', 'Quiz Show', 'Kategorie, quizy, gracze i ustawienia ekranów.', 20),
  ('familiada', 'Familiada', 'Pytania, rundy, drużyny i oprawa teleturnieju.', 30),
  ('light_magic', 'Light Magic', 'Sterowanie światłem, patch, MIDI, Resolume i presety.', 40),
  ('streaming', 'Streaming', 'Dostęp uczestników i prywatne transmisje.', 50)
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order;

CREATE TABLE IF NOT EXISTS public.offer_product_mavinci_live_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.offer_products(id) ON DELETE CASCADE,
  module_key text NOT NULL REFERENCES public.mavinci_live_modules(module_key) ON UPDATE CASCADE ON DELETE RESTRICT,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_offer_product_live_modules_product
  ON public.offer_product_mavinci_live_modules(product_id);
CREATE INDEX IF NOT EXISTS idx_offer_product_live_modules_module
  ON public.offer_product_mavinci_live_modules(module_key);

-- Dotychczasowy CHECK blokował dodawanie kolejnych modułów bez zmiany schematu.
ALTER TABLE public.mavinci_event_module_access
  DROP CONSTRAINT IF EXISTS mavinci_event_module_access_module_key_check;

ALTER TABLE public.mavinci_event_module_access
  DROP CONSTRAINT IF EXISTS mavinci_event_module_access_module_key_fkey;

ALTER TABLE public.mavinci_event_module_access
  ADD CONSTRAINT mavinci_event_module_access_module_key_fkey
  FOREIGN KEY (module_key)
  REFERENCES public.mavinci_live_modules(module_key)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.can_manage_mavinci_live_catalog()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = public.current_mavinci_employee_id()
      AND employee.is_active = true
      AND (
        employee.role = 'admin'
        OR 'offers_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR 'mavinci_live_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      )
  )
$$;

ALTER TABLE public.mavinci_live_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_product_mavinci_live_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mavinci_live_modules_select ON public.mavinci_live_modules;
CREATE POLICY mavinci_live_modules_select
ON public.mavinci_live_modules FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS mavinci_live_modules_manage ON public.mavinci_live_modules;
CREATE POLICY mavinci_live_modules_manage
ON public.mavinci_live_modules FOR ALL TO authenticated
USING (public.can_manage_mavinci_live_catalog())
WITH CHECK (public.can_manage_mavinci_live_catalog());

DROP POLICY IF EXISTS offer_product_live_modules_select ON public.offer_product_mavinci_live_modules;
CREATE POLICY offer_product_live_modules_select
ON public.offer_product_mavinci_live_modules FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS offer_product_live_modules_manage ON public.offer_product_mavinci_live_modules;
CREATE POLICY offer_product_live_modules_manage
ON public.offer_product_mavinci_live_modules FOR ALL TO authenticated
USING (public.can_manage_mavinci_live_catalog())
WITH CHECK (public.can_manage_mavinci_live_catalog());

-- Wersja oparta na rejestrze zamiast zamkniętej listy kluczy modułów.
CREATE OR REPLACE FUNCTION public.set_mavinci_module_access(
  p_event_id uuid,
  p_employee_id uuid,
  p_access jsonb,
  p_valid_from timestamptz DEFAULT NULL,
  p_valid_until timestamptz DEFAULT NULL
)
RETURNS SETOF public.mavinci_event_module_access
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_mavinci_event(p_event_id) THEN
    RAISE EXCEPTION 'Brak uprawnień do zarządzania dostępem Mavinci LIVE';
  END IF;
  IF p_valid_from IS NOT NULL AND p_valid_until IS NOT NULL AND p_valid_from >= p_valid_until THEN
    RAISE EXCEPTION 'Data końca dostępu musi być późniejsza niż data rozpoczęcia';
  END IF;

  DELETE FROM public.mavinci_event_module_access
  WHERE event_id = p_event_id AND employee_id = p_employee_id;

  INSERT INTO public.mavinci_event_module_access (
    event_id, employee_id, module_key, can_view, can_edit, can_run, can_admin,
    valid_from, valid_until, created_by
  )
  SELECT
    p_event_id,
    p_employee_id,
    item->>'module_key',
    true,
    item->>'level' IN ('edit', 'run', 'admin'),
    item->>'level' IN ('run', 'admin'),
    item->>'level' = 'admin',
    p_valid_from,
    p_valid_until,
    public.current_mavinci_employee_id()
  FROM jsonb_array_elements(COALESCE(p_access, '[]'::jsonb)) item
  JOIN public.mavinci_live_modules module
    ON module.module_key = item->>'module_key'
   AND module.is_active = true
  WHERE item->>'level' IN ('view', 'edit', 'run', 'admin');

  RETURN QUERY
  SELECT * FROM public.mavinci_event_module_access
  WHERE event_id = p_event_id AND employee_id = p_employee_id
  ORDER BY module_key;
END;
$$;

DROP FUNCTION IF EXISTS public.get_event_required_mavinci_live_modules(uuid);
CREATE FUNCTION public.get_event_required_mavinci_live_modules(p_event_id uuid)
RETURNS TABLE (
  module_key text,
  name text,
  description text,
  display_order integer,
  product_names text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.can_access_mavinci_event(p_event_id)
    OR public.can_manage_mavinci_event(p_event_id)
  ) THEN
    RAISE EXCEPTION 'Brak dostępu do wydarzenia';
  END IF;

  RETURN QUERY
  WITH selected_offer AS (
    SELECT offer_candidate.id
    FROM public.offers offer_candidate
    WHERE offer_candidate.event_id = p_event_id
      AND offer_candidate.status::text NOT IN ('rejected', 'cancelled')
    ORDER BY
      CASE WHEN offer_candidate.status::text = 'accepted' THEN 0 ELSE 1 END,
      offer_candidate.created_at DESC
    LIMIT 1
  )
  SELECT
    module.module_key,
    module.name,
    module.description,
    module.display_order,
    array_agg(DISTINCT product.name ORDER BY product.name) AS product_names
  FROM selected_offer selected
  JOIN public.offers offer_row ON offer_row.id = selected.id
  JOIN public.offer_items offer_item ON offer_item.offer_id = offer_row.id
  JOIN public.offer_products product ON product.id = offer_item.product_id
  JOIN public.offer_product_mavinci_live_modules link ON link.product_id = product.id
  JOIN public.mavinci_live_modules module ON module.module_key = link.module_key
  WHERE module.is_active = true
  GROUP BY module.module_key, module.name, module.description, module.display_order
  ORDER BY module.display_order, module.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_event_mavinci_live_modules(p_event_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH selected_offer AS (
    SELECT offer_candidate.id
    FROM public.offers offer_candidate
    WHERE offer_candidate.event_id = p_event_id
      AND offer_candidate.status::text NOT IN ('rejected', 'cancelled')
    ORDER BY
      CASE WHEN offer_candidate.status::text = 'accepted' THEN 0 ELSE 1 END,
      offer_candidate.created_at DESC
    LIMIT 1
  )
  UPDATE public.mavinci_event_projects project
  SET enabled_modules = COALESCE((
    SELECT array_agg(DISTINCT link.module_key ORDER BY link.module_key)
    FROM selected_offer selected
    JOIN public.offers offer_row ON offer_row.id = selected.id
    JOIN public.offer_items offer_item ON offer_item.offer_id = offer_row.id
    JOIN public.offer_product_mavinci_live_modules link ON link.product_id = offer_item.product_id
    JOIN public.mavinci_live_modules module ON module.module_key = link.module_key
    WHERE module.is_active = true
  ), '{}'::text[])
  WHERE project.event_id = p_event_id
$$;

CREATE OR REPLACE FUNCTION public.refresh_mavinci_modules_after_offer_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_event_id uuid;
  new_event_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT event_id INTO old_event_id FROM public.offers WHERE id = OLD.offer_id;
    IF old_event_id IS NOT NULL THEN
      PERFORM public.refresh_event_mavinci_live_modules(old_event_id);
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT event_id INTO new_event_id FROM public.offers WHERE id = NEW.offer_id;
    IF new_event_id IS NOT NULL THEN
      PERFORM public.refresh_event_mavinci_live_modules(new_event_id);
    END IF;
    RETURN NEW;
  END IF;

  SELECT event_id INTO old_event_id FROM public.offers WHERE id = OLD.offer_id;
  SELECT event_id INTO new_event_id FROM public.offers WHERE id = NEW.offer_id;
  IF old_event_id IS NOT NULL THEN
    PERFORM public.refresh_event_mavinci_live_modules(old_event_id);
  END IF;
  IF new_event_id IS NOT NULL AND new_event_id IS DISTINCT FROM old_event_id THEN
    PERFORM public.refresh_event_mavinci_live_modules(new_event_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_mavinci_modules_offer_item ON public.offer_items;
CREATE TRIGGER trg_refresh_mavinci_modules_offer_item
AFTER INSERT OR UPDATE OF offer_id, product_id OR DELETE ON public.offer_items
FOR EACH ROW EXECUTE FUNCTION public.refresh_mavinci_modules_after_offer_item_change();

CREATE OR REPLACE FUNCTION public.refresh_mavinci_modules_after_offer_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.event_id IS NOT NULL THEN
      PERFORM public.refresh_event_mavinci_live_modules(OLD.event_id);
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.event_id IS NOT NULL THEN
      PERFORM public.refresh_event_mavinci_live_modules(NEW.event_id);
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.event_id IS NOT NULL THEN
    PERFORM public.refresh_event_mavinci_live_modules(OLD.event_id);
  END IF;
  IF NEW.event_id IS NOT NULL AND NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    PERFORM public.refresh_event_mavinci_live_modules(NEW.event_id);
  ELSIF NEW.event_id IS NOT NULL THEN
    PERFORM public.refresh_event_mavinci_live_modules(NEW.event_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_mavinci_modules_offer ON public.offers;
CREATE TRIGGER trg_refresh_mavinci_modules_offer
AFTER INSERT OR UPDATE OF status, event_id OR DELETE ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.refresh_mavinci_modules_after_offer_change();

CREATE OR REPLACE FUNCTION public.refresh_mavinci_modules_after_product_link_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_product_id uuid;
  affected_event_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected_product_id := OLD.product_id;
  ELSE
    affected_product_id := NEW.product_id;
  END IF;

  FOR affected_event_id IN
    SELECT DISTINCT offer_row.event_id
    FROM public.offers offer_row
    JOIN public.offer_items offer_item ON offer_item.offer_id = offer_row.id
    WHERE offer_item.product_id = affected_product_id
      AND offer_row.event_id IS NOT NULL
  LOOP
    PERFORM public.refresh_event_mavinci_live_modules(affected_event_id);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_mavinci_modules_product_link ON public.offer_product_mavinci_live_modules;
CREATE TRIGGER trg_refresh_mavinci_modules_product_link
AFTER INSERT OR UPDATE OF product_id, module_key OR DELETE ON public.offer_product_mavinci_live_modules
FOR EACH ROW EXECUTE FUNCTION public.refresh_mavinci_modules_after_product_link_change();

GRANT SELECT ON public.mavinci_live_modules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offer_product_mavinci_live_modules TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_required_mavinci_live_modules(uuid) TO authenticated;

COMMENT ON TABLE public.mavinci_live_modules IS
  'Rozszerzalny rejestr funkcji Mavinci LIVE. Nowe moduły dodaje się rekordem, bez zmian w formularzach produktów.';
COMMENT ON TABLE public.offer_product_mavinci_live_modules IS
  'Moduły Mavinci LIVE wymagane przez konkretny produkt katalogu ofertowego.';
