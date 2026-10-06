/*
  Wynajem nieruchomości i pomieszczeń jest odrębnym kosztem od wynajmu sprzętu.
  Formularze korzystają bezpośrednio z finance_categories; category_id jest FK,
  dlatego nowa opcja wymaga rekordu słownika, a nie sztucznej wartości w UI.
  Nie zmieniamy istniejących kategorii przypisanych ręcznie do dokumentów.
*/

BEGIN;

INSERT INTO public.finance_categories (code, name, kind, color, sort_order)
VALUES ('property_rental', 'Wynajem nieruchomości / pomieszczeń', 'expense', '#d3bb73', 45)
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.finance_detect_category(
  p_source_type text,
  p_source_id uuid,
  p_text text,
  p_default text DEFAULT 'other'
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT fc.code
      FROM public.financial_source_categories fsc
      JOIN public.finance_categories fc ON fc.id = fsc.category_id
      WHERE fsc.source_type = p_source_type AND fsc.source_id = p_source_id
      LIMIT 1
    ),
    CASE
      -- Require an explicit property-rental phrase. A company name mentioning
      -- an office, or equipment rented for an office, is not sufficient.
      -- This precedes equipment keywords (e.g. a hall rented with lighting).
      WHEN lower(COALESCE(p_text, '')) ~ '(wynajem|wynajmu|najem|najmu|dzierżawa|dzierżawy|dzierżawę|dzierzawa|dzierzawy|czynsz)([[:space:]]+(za|dotyczący|dotyczacy))?[[:space:]]+(nieruchomo|pomieszcze|lokal|biur|magazyn|powierzchni|budyn|sali\M|salę\M|sale\M|sal\M)'
        OR lower(COALESCE(p_text, '')) ~ '(property|premises|office|warehouse|building|room|hall)[[:space:]-]+(rent|rental|lease)'
        OR lower(COALESCE(p_text, '')) ~ '(rent|rental|lease)([[:space:]]+(of|for))?[[:space:]]+(property|premises|office|warehouse|building|room|hall)'
        THEN 'property_rental'
      WHEN lower(COALESCE(p_text, '')) ~ '(wynagrodz|pensj|wypłat|umowa zlecen|lista płac)' THEN 'personnel'
      WHEN lower(COALESCE(p_text, '')) ~ '(podwykon|dj |fotograf|kamerzyst|hostess|ochron|technik)' THEN 'subcontractors'
      WHEN lower(COALESCE(p_text, '')) ~ '(zakup.*sprzęt|kolumn|mikrofon|oświetlen|ekran led|projektor|komputer|laptop|tablet)' THEN 'equipment_purchase'
      WHEN lower(COALESCE(p_text, '')) ~ '(wynajem|rental)' THEN 'equipment_rental'
      WHEN lower(COALESCE(p_text, '')) ~ '(paliw|benzyn|diesel|orlen|circle k|bp )' THEN 'fuel'
      WHEN lower(COALESCE(p_text, '')) ~ '(transport|kurier|parking|autostrad|logistyk|taxi)' THEN 'transport'
      WHEN lower(COALESCE(p_text, '')) ~ '(hotel|nocleg|apartament)' THEN 'accommodation'
      WHEN lower(COALESCE(p_text, '')) ~ '(catering|restaurac|jedzenie|wyżywienie)' THEN 'catering'
      WHEN lower(COALESCE(p_text, '')) ~ '(reklam|marketing|facebook|google ads|meta ads)' THEN 'marketing'
      WHEN lower(COALESCE(p_text, '')) ~ '(subskrypc|software|oprogramowan|hosting|domena|licencj|apple.com/bill)' THEN 'software'
      WHEN lower(COALESCE(p_text, '')) ~ '(ubezpiec|polisa| oc | ac )' THEN 'insurance'
      WHEN lower(COALESCE(p_text, '')) ~ '(serwis|napraw|warsztat|części)' THEN 'service'
      WHEN lower(COALESCE(p_text, '')) ~ '(zus|podatek|urząd skarbow|vat|pit|cit)' THEN 'taxes'
      WHEN lower(COALESCE(p_text, '')) ~ '(przelew własny|transfer wewnętrzny|zasilenie rachunku)' THEN 'internal_transfer'
      ELSE p_default
    END
  );
$$;

COMMIT;
