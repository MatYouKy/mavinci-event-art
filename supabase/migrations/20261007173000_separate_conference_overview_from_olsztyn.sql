-- Separate the nationwide service overview from the Olsztyn landing page.
-- Match only the previously published copy; preserve later editorial changes.
-- The application provides the same fallback before this migration is applied.
BEGIN;

UPDATE public.schema_org_page_metadata
SET
  title = CASE
    WHEN NULLIF(btrim(title), '') IS NULL OR btrim(title) IN (
      'Obsługa konferencji Olsztyn – LED, streaming | MAVINCI',
      'MAVINCI Event & ART | Techniczna Obsługa Konferencji | Ekran Led | Streaming'
    ) THEN 'Obsługa techniczna konferencji – LED i streaming | MAVINCI'
    ELSE title
  END,
  description = CASE
    WHEN NULLIF(btrim(description), '') IS NULL OR btrim(description) IN (
      'Obsługa techniczna konferencji w Olsztynie i na Warmii i Mazurach. Własne nagłośnienie Meyer Sound, ekrany LED, oświetlenie, multimedia i streaming.',
      'Kompleksowa obsługa techniczna konferencji: nagłośnienie, projekcja, streaming, rejestracja wideo. Doświadczenie, profesjonalizm, nowoczesny sprzęt.'
    ) THEN 'Techniczna obsługa konferencji w całej Polsce: nagłośnienie Meyer Sound, ekrany LED, oświetlenie i streaming. Własny sprzęt, realizatorzy i przygotowanie wydarzenia.'
    ELSE description
  END,
  updated_at = now()
WHERE page_slug = 'oferta/konferencje'
  AND (
    NULLIF(btrim(title), '') IS NULL OR btrim(title) IN (
      'Obsługa konferencji Olsztyn – LED, streaming | MAVINCI',
      'MAVINCI Event & ART | Techniczna Obsługa Konferencji | Ekran Led | Streaming'
    )
    OR NULLIF(btrim(description), '') IS NULL OR btrim(description) IN (
      'Obsługa techniczna konferencji w Olsztynie i na Warmii i Mazurach. Własne nagłośnienie Meyer Sound, ekrany LED, oświetlenie, multimedia i streaming.',
      'Kompleksowa obsługa techniczna konferencji: nagłośnienie, projekcja, streaming, rejestracja wideo. Doświadczenie, profesjonalizm, nowoczesny sprzęt.'
    )
  );

COMMIT;
