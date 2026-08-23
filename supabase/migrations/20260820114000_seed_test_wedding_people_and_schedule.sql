/* Sample content only for the explicitly marked Wedding Portal test event. */

WITH test_card AS (
  SELECT wc.id
  FROM public.wedding_cards wc
  JOIN public.events e ON e.id = wc.event_id
  WHERE e.description = '[TEST-STREFA-PARY-MLODEJ]'
  LIMIT 1
)
INSERT INTO public.wedding_card_people
  (wedding_card_id, side, role, first_name, last_name, phone, notes, sort_order, source)
SELECT test_card.id, person.side, person.role, person.first_name, person.last_name,
       person.phone, person.notes, person.sort_order, 'crm'
FROM test_card
CROSS JOIN (VALUES
  ('bride', 'bride',   'Anna',     'Testowa',     '+48 500 100 101', 'Panna Młoda – dane testowe', 1),
  ('bride', 'witness', 'Karolina', 'Przykładowa', '+48 500 100 102', 'Świadkowa Panny Młodej', 2),
  ('bride', 'mother',  'Ewa',      'Testowa',     '+48 500 100 103', 'Mama Panny Młodej', 3),
  ('bride', 'father',  'Jan',      'Testowy',     '+48 500 100 104', 'Tata Panny Młodej', 4),
  ('groom', 'groom',   'Mateusz',  'Testowy',     '+48 500 200 201', 'Pan Młody – dane testowe', 1),
  ('groom', 'witness', 'Michał',   'Przykładowy', '+48 500 200 202', 'Świadek Pana Młodego', 2),
  ('groom', 'mother',  'Maria',     'Testowa',     '+48 500 200 203', 'Mama Pana Młodego', 3),
  ('groom', 'father',  'Piotr',     'Testowy',     '+48 500 200 204', 'Tata Pana Młodego', 4)
) AS person(side, role, first_name, last_name, phone, notes, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.wedding_card_people existing
  WHERE existing.wedding_card_id = test_card.id
);

WITH test_card AS (
  SELECT wc.id
  FROM public.wedding_cards wc
  JOIN public.events e ON e.id = wc.event_id
  WHERE e.description = '[TEST-STREFA-PARY-MLODEJ]'
  LIMIT 1
)
INSERT INTO public.wedding_schedule_items
  (wedding_card_id, title, scheduled_at, category, location, responsible_person,
   notes, is_confirmed, sort_order, source)
SELECT test_card.id, item.title, item.scheduled_at::timestamptz, item.category,
       item.location, item.responsible_person, item.notes, true, item.sort_order, 'crm'
FROM test_card
CROSS JOIN (VALUES
  ('Przygotowania Panny Młodej', '2027-06-12 10:00:00+02', 'preparation', 'Hotel – pokój Panny Młodej', 'Fotograf', 'Zdjęcia z przygotowań', 1),
  ('Przygotowania Pana Młodego', '2027-06-12 11:00:00+02', 'preparation', 'Hotel – pokój Pana Młodego', 'Fotograf', NULL, 2),
  ('Ceremonia zaślubin',         '2027-06-12 15:00:00+02', 'ceremony', 'Kościół / USC – lokalizacja testowa', 'Świadkowie', NULL, 3),
  ('Przyjazd na salę',           '2027-06-12 16:30:00+02', 'arrival', 'Sala testowa Event Rulers', 'Manager sali', 'Powitanie chlebem i solą', 4),
  ('Obiad weselny',              '2027-06-12 17:00:00+02', 'meal', 'Sala główna', 'Manager sali', NULL, 5),
  ('Pierwszy taniec',            '2027-06-12 18:30:00+02', 'first_dance', 'Parkiet', 'DJ / konferansjer', 'Utwór do uzupełnienia', 6),
  ('Podziękowania dla rodziców', '2027-06-12 21:30:00+02', 'parents_thanks', 'Parkiet', 'DJ / konferansjer', NULL, 7),
  ('Tort weselny',               '2027-06-12 22:30:00+02', 'cake', 'Taras / parkiet', 'Obsługa sali', 'Godzina do potwierdzenia', 8),
  ('Oczepiny',                   '2027-06-13 00:00:00+02', 'oczepiny', 'Parkiet', 'DJ / konferansjer', NULL, 9),
  ('Planowane zakończenie',      '2027-06-13 04:00:00+02', 'ending', 'Sala główna', 'Manager wydarzenia', NULL, 10)
) AS item(title, scheduled_at, category, location, responsible_person, notes, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.wedding_schedule_items existing
  WHERE existing.wedding_card_id = test_card.id
);
