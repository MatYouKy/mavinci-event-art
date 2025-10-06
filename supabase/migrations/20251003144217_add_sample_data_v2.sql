/*
  # Przykładowe dane CRM - poprawione
*/

-- KLIENCI
INSERT INTO clients (
  client_type, company_name, company_nip, first_name, last_name,
  email, phone_number, address_city, category, status, source, total_events
) VALUES 
(
  'company', 'Tech Solutions Sp. z o.o.', '1234567890', 'Anna', 'Kowalska',
  'kontakt@techsolutions.pl', '+48 123 456 789', 'Warszawa',
  'corporate_events', 'active', 'Rekomendacja', 3
),
(
  'company', 'MediaGroup SA', '9876543210', 'Piotr', 'Wiśniewski',
  'office@mediagroup.pl', '+48 987 654 321', 'Kraków',
  'conferences', 'active', 'Strona www', 2
),
(
  'individual', NULL, NULL, 'Jan', 'Nowak',
  'jan.nowak@email.pl', '+48 600 123 456', 'Gdańsk',
  'weddings', 'potential', 'Facebook', 0
),
(
  'individual', NULL, NULL, 'Maria', 'Kowalczyk',
  'maria.k@gmail.com', '+48 700 234 567', 'Wrocław',
  'private_parties', 'active', 'Instagram', 1
);

-- PRACOWNICY
INSERT INTO employees (
  name, surname, nickname, email, phone_number, 
  role, access_level, occupation, region,
  address_city, is_active, skills
) VALUES 
(
  'Michał', 'Nowicki', 'DJ Mike', 'michal.nowicki@mavinci.pl', '+48 600 111 222',
  'dj', 'operator', 'DJ / Konferansjer', 'Mazowieckie',
  'Warszawa', true, ARRAY['DJ', 'Konferansjer', 'Nagłośnienie']
),
(
  'Karolina', 'Zielińska', NULL, 'karolina.z@mavinci.pl', '+48 700 333 444',
  'event_manager', 'manager', 'Menedżer Eventów', 'Małopolskie',
  'Kraków', true, ARRAY['Zarządzanie projektami', 'Organizacja eventów']
),
(
  'Adam', 'Kowalski', 'Technik Adam', 'adam.k@mavinci.pl', '+48 600 555 666',
  'technician', 'operator', 'Technik Sceny', 'Wielkopolskie',
  'Poznań', true, ARRAY['Oświetlenie', 'Nagłośnienie', 'Projekcje']
),
(
  'Natalia', 'Wójcik', NULL, 'natalia.w@mavinci.pl', '+48 500 777 888',
  'sales', 'lead', 'Specjalista ds. Sprzedaży', 'Pomorskie',
  'Gdańsk', true, ARRAY['Sprzedaż', 'Obsługa klienta']
);

-- WYDARZENIA
INSERT INTO events (name, event_date, status, location, budget, description, client_id) 
SELECT 'Konferencja Tech Summit 2025', (CURRENT_DATE + INTERVAL '30 days')::timestamptz,
  'in_preparation', 'Centrum Kongresowe, Warszawa', 50000,
  'Doroczna konferencja branży IT', id
FROM clients WHERE company_name = 'Tech Solutions Sp. z o.o.' LIMIT 1;

INSERT INTO events (name, event_date, status, location, budget, description, client_id) 
SELECT 'Impreza integracyjna MediaGroup', (CURRENT_DATE + INTERVAL '15 days')::timestamptz,
  'in_preparation', 'Hotel Grand, Kraków', 25000,
  'Integracja zespołu', id
FROM clients WHERE company_name = 'MediaGroup SA' LIMIT 1;

INSERT INTO events (name, event_date, status, location, budget, description, client_id) 
SELECT 'Wesele Marii i Tomasza', (CURRENT_DATE + INTERVAL '60 days')::timestamptz,
  'offer_accepted', 'Sala Balowa Prestige, Wrocław', 35000,
  'Eleganckie wesele', id
FROM clients WHERE first_name = 'Maria' AND last_name = 'Kowalczyk' LIMIT 1;

INSERT INTO events (name, event_date, status, location, description) 
VALUES ('Event zakończenie projektu', (CURRENT_DATE - INTERVAL '10 days')::timestamptz,
  'completed', 'Restauracja Panorama, Warszawa', 
  'Świętowanie zakończenia projektu');

-- ZADANIA
INSERT INTO tasks (title, description, status, priority, due_date) VALUES 
('Przygotowanie oferty dla Tech Summit', 'Oferta z wyceną sprzętu', 
  'in_progress', 'high', CURRENT_DATE + INTERVAL '3 days'),
('Rezerwacja sprzętu na wesele', 'Nagłośnienie i oświetlenie', 
  'todo', 'medium', CURRENT_DATE + INTERVAL '50 days'),
('Kontakt z DJ', 'Potwierdzić dostępność', 
  'in_progress', 'high', CURRENT_DATE + INTERVAL '10 days'),
('Wysłać invoice', 'Faktura za event', 
  'todo', 'urgent', CURRENT_DATE + INTERVAL '2 days');

-- PRZYPISANIA
INSERT INTO employee_event_assignments (employee_id, event_id, role_in_event, hours_worked, hourly_rate)
SELECT e.id, ev.id, 'Menedżer eventu', 10, 150
FROM employees e, events ev
WHERE e.email = 'karolina.z@mavinci.pl' AND ev.name = 'Konferencja Tech Summit 2025' LIMIT 1;

INSERT INTO employee_event_assignments (employee_id, event_id, role_in_event, hours_worked, hourly_rate)
SELECT e.id, ev.id, 'DJ', 8, 120
FROM employees e, events ev
WHERE e.email = 'michal.nowicki@mavinci.pl' AND ev.name = 'Impreza integracyjna MediaGroup' LIMIT 1;

-- HISTORIA
INSERT INTO client_history (client_id, interaction_type, title, description, performed_by)
SELECT c.id, 'meeting', 'Spotkanie w sprawie konferencji', 'Omówienie wymagań', e.id
FROM clients c, employees e
WHERE c.company_name = 'Tech Solutions Sp. z o.o.' AND e.email = 'karolina.z@mavinci.pl' LIMIT 1;

-- Daty kontaktów
UPDATE clients SET last_contact_date = CURRENT_TIMESTAMP - INTERVAL '2 days'
WHERE company_name = 'Tech Solutions Sp. z o.o.';

UPDATE clients SET last_contact_date = CURRENT_TIMESTAMP - INTERVAL '1 day'
WHERE company_name = 'MediaGroup SA';
