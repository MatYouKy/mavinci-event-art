-- Logo do druku w brandbooku firmy (faktury, kalkulacje i inne wydruki na papierze).
-- Jedno zaznaczone logo na firmę; wybór w /crm/settings/my-companies/<firma>/brandbook („Logo do druku”).
-- Do czasu zaznaczenia wydruki używają dotychczasowej reguły (logo „primary-black”), więc migracja niczego nie psuje.

ALTER TABLE public.company_brandbook_logos
  ADD COLUMN IF NOT EXISTS use_for_print boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.company_brandbook_logos.use_for_print IS
  'Logo używane na wydrukach (faktury, kalkulacje). Najwyżej jedno na firmę.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_brandbook_logos_print
  ON public.company_brandbook_logos (company_id)
  WHERE use_for_print;

-- Przeniesienie dotychczasowej reguły: logo o nazwie (lub wariancie) primary-black zostaje logo do druku.
UPDATE public.company_brandbook_logos AS logo
SET use_for_print = true, updated_at = now()
WHERE logo.id IN (
  SELECT DISTINCT ON (candidate.company_id) candidate.id
  FROM public.company_brandbook_logos AS candidate
  CROSS JOIN LATERAL (
    SELECT
      regexp_replace(regexp_replace(lower(btrim(coalesce(candidate.label, ''))), '\.(svg|png|webp|jpe?g)$', ''), '[[:space:]_]+', '-', 'g') AS label_key,
      regexp_replace(lower(btrim(coalesce(candidate.variant, ''))), '[[:space:]_]+', '-', 'g') AS variant_key
  ) AS normalized
  WHERE (normalized.label_key = 'primary-black' OR normalized.variant_key = 'primary-black')
    AND btrim(coalesce(candidate.url, '')) <> ''
  ORDER BY candidate.company_id,
    (normalized.label_key = 'primary-black') DESC,
    candidate.is_default DESC NULLS LAST,
    candidate.order_index ASC NULLS LAST,
    candidate.created_at ASC
)
AND NOT EXISTS (
  SELECT 1 FROM public.company_brandbook_logos AS chosen
  WHERE chosen.company_id = logo.company_id AND chosen.use_for_print
);

-- Zmiana logo do druku jednym wywołaniem (odznaczenie poprzedniego i zaznaczenie nowego w jednej transakcji).
-- SECURITY INVOKER: obowiązują istniejące uprawnienia RLS do edycji brandbooka.
CREATE OR REPLACE FUNCTION public.set_company_print_logo(p_company_id uuid, p_logo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Brak firmy.' USING ERRCODE = '22023';
  END IF;

  IF p_logo_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_brandbook_logos
    WHERE id = p_logo_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Nie znaleziono tego logo w brandbooku firmy.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.company_brandbook_logos
  SET use_for_print = false, updated_at = now()
  WHERE company_id = p_company_id
    AND use_for_print
    AND id IS DISTINCT FROM p_logo_id;

  IF p_logo_id IS NOT NULL THEN
    UPDATE public.company_brandbook_logos
    SET use_for_print = true, updated_at = now()
    WHERE id = p_logo_id
      AND company_id = p_company_id
      AND NOT use_for_print;

    IF NOT EXISTS (
      SELECT 1 FROM public.company_brandbook_logos
      WHERE id = p_logo_id AND use_for_print
    ) THEN
      RAISE EXCEPTION 'Nie masz uprawnień do zmiany logo do druku tej firmy.' USING ERRCODE = '42501';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM public.company_brandbook_logos
    WHERE company_id = p_company_id AND use_for_print
  ) THEN
    RAISE EXCEPTION 'Nie masz uprawnień do zmiany logo do druku tej firmy.' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_company_print_logo(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_company_print_logo(uuid, uuid) TO authenticated;
