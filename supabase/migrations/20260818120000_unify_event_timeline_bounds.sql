/*
  Jedno źródło prawdy dla zakresu czasu wydarzenia.

  Zakres obejmuje deklarowane godziny wydarzenia oraz wszystkie jego fazy.
  Widoki kalendarza, wydarzenia i floty mogą dzięki temu prezentować dokładnie
  ten sam początek i koniec bez wybierania przypadkowej pierwszej fazy.
*/
CREATE OR REPLACE VIEW public.event_timeline_bounds
WITH (security_invoker = true)
AS
WITH phase_bounds AS (
  SELECT
    event_id,
    MIN(start_time) AS first_phase_start,
    MAX(end_time) AS last_phase_end
  FROM public.event_phases
  GROUP BY event_id
), calculated AS (
  SELECT
    e.id AS event_id,
    LEAST(
      e.event_date,
      pb.first_phase_start
    ) AS timeline_start,
    GREATEST(
      COALESCE(e.event_end_date, e.event_date),
      pb.last_phase_end
    ) AS timeline_end
  FROM public.events e
  LEFT JOIN phase_bounds pb ON pb.event_id = e.id
)
SELECT
  event_id,
  timeline_start,
  GREATEST(timeline_start, timeline_end) AS timeline_end
FROM calculated;

COMMENT ON VIEW public.event_timeline_bounds IS
  'Kanoniczny zakres wydarzenia: deklarowany termin rozszerzony o najwcześniejszą i najpóźniejszą fazę.';

GRANT SELECT ON public.event_timeline_bounds TO authenticated;
GRANT SELECT ON public.event_timeline_bounds TO service_role;
