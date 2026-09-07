/*
  Porządkuje wymagania produktów do jednego, kategoryzowanego źródła prawdy.
  Migracja zachowuje pełną treść dotychczasowych wpisów i jest idempotentna.
*/

WITH legacy_requirements AS (
  SELECT
    product.id AS product_id,
    requirement.description,
    CASE
      WHEN lower(requirement.description) ~ '(zasil|230[[:space:]]*v|400[[:space:]]*v|3[[:space:]]*faz|trójfaz|siła|gniazd|prąd|obwod)' THEN 'power'
      WHEN lower(requirement.description) ~ '(internet|łącze|ethernet|wi[ -]?fi|sieciow)' THEN 'internet'
      WHEN lower(requirement.description) ~ '(zgod.*obiekt|akceptac.*obiekt|dopuszcz|czujek|przeciwpożar)' THEN 'venue_approval'
      WHEN lower(requirement.description) ~ '(kontakt|koordyn|osob.*decyzyjn|osob.*technicz)' THEN 'coordination'
      WHEN lower(requirement.description) ~ '(montaż|demontaż|próba|wcześniejsz.*wejśc|wyprzedzeniem)' THEN 'setup'
      WHEN lower(requirement.description) ~ '(harmonogram|scenariusz|moment|program wydarzenia|materiał)' THEN 'schedule'
      WHEN lower(requirement.description) ~ '(dostęp|dojazd|wniesien|transportow|rozład)' THEN 'access'
      WHEN lower(requirement.description) ~ '(równe|stabilne|suche|podłoże|stanowisko|powierzchni)' THEN 'surface'
      WHEN lower(requirement.description) ~ '(bezpiecz|strefa|ewakuac|łatwopal)' THEN 'safety'
      ELSE 'technical'
    END AS category
  FROM public.offer_products product
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(product.offer_requirements, '[]'::jsonb)) requirement(description)
  WHERE btrim(requirement.description) <> ''
), missing_requirements AS (
  SELECT legacy.*
  FROM legacy_requirements legacy
  WHERE NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE((
      SELECT offer_additional_requirements
      FROM public.offer_products
      WHERE id = legacy.product_id
    ), '[]'::jsonb)) existing
    WHERE lower(btrim(existing->>'description')) = lower(btrim(legacy.description))
  )
), grouped AS (
  SELECT
    product_id,
    jsonb_agg(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'category', category,
      'title', CASE category
        WHEN 'power' THEN 'ZASILANIE'
        WHEN 'internet' THEN 'ŁĄCZE INTERNETOWE'
        WHEN 'venue_approval' THEN 'ZGODA OBIEKTU'
        WHEN 'coordination' THEN 'KOORDYNACJA Z OBIEKTEM'
        WHEN 'setup' THEN 'MONTAŻ I PRÓBA'
        WHEN 'schedule' THEN 'HARMONOGRAM I MATERIAŁY'
        WHEN 'access' THEN 'DOSTĘP I ROZŁADUNEK'
        WHEN 'surface' THEN 'MIEJSCE REALIZACJI'
        WHEN 'safety' THEN 'BEZPIECZEŃSTWO'
        ELSE 'WARUNEK TECHNICZNY'
      END,
      'description', description
    )) AS requirements
  FROM missing_requirements
  GROUP BY product_id
)
UPDATE public.offer_products product
SET offer_additional_requirements = COALESCE(product.offer_additional_requirements, '[]'::jsonb) || grouped.requirements
FROM grouped
WHERE product.id = grouped.product_id;

-- Po przeniesieniu treści kategoryzowana lista staje się jedynym źródłem prawdy.
UPDATE public.offer_products
SET offer_requirements = '[]'::jsonb
WHERE jsonb_array_length(COALESCE(offer_requirements, '[]'::jsonb)) > 0;

COMMENT ON COLUMN public.offer_products.offer_additional_requirements IS
  'Kategoryzowane wymagania produktu: techniczne i organizacyjne. Tablica obiektów id, category, title, description; agregowana w ofercie bez duplikatów.';
