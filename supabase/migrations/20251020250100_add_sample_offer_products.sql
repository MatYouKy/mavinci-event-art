/*
  # Przykładowe dane dla katalogu produktów

  1. Przykładowe kategorie
    - DJ i prowadzenie
    - Nagłośnienie
    - Oświetlenie
    - Multimedia
    - Dekoracje

  2. Przykładowe produkty
    - DJ Standard, DJ Premium
    - Pakiety nagłośnienia
    - Pakiety oświetlenia
    - itp.

  3. Domyślny szablon oferty
*/

-- Kategorie produktów
INSERT INTO offer_product_categories (name, description, icon, display_order) VALUES
  ('DJ i prowadzenie', 'Usługi DJ i prowadzenia imprez', 'Music', 1),
  ('Nagłośnienie', 'Systemy nagłośnieniowe i audio', 'Volume2', 2),
  ('Oświetlenie', 'Systemy oświetlenia scenicznego', 'Lightbulb', 3),
  ('Multimedia', 'Projektory, ekrany, LED', 'Monitor', 4),
  ('Dekoracje', 'Dekoracje świetlne i scenograficzne', 'Sparkles', 5)
ON CONFLICT DO NOTHING;

-- Przykładowe produkty - DJ
DO $$
DECLARE
  v_category_dj uuid;
BEGIN
  SELECT id INTO v_category_dj FROM offer_product_categories WHERE name = 'DJ i prowadzenie';

  INSERT INTO offer_products (
    category_id, name, description,
    base_price, cost_price,
    transport_cost, logistics_cost,
    setup_time_hours, teardown_time_hours,
    requires_vehicle, requires_driver,
    tags
  ) VALUES
    (
      v_category_dj,
      'DJ Standard',
      'Podstawowy pakiet DJ - profesjonalny DJ z podstawowym sprzętem',
      2500.00, 800.00,
      200.00, 100.00,
      1.5, 1.0,
      true, true,
      ARRAY['dj', 'wesele', 'impreza']
    ),
    (
      v_category_dj,
      'DJ Premium',
      'Pakiet premium - doświadczony DJ z zaawansowanym sprzętem i oświetleniem',
      4500.00, 1500.00,
      300.00, 150.00,
      2.0, 1.5,
      true, true,
      ARRAY['dj', 'premium', 'wesele']
    ),
    (
      v_category_dj,
      'Konferansjer',
      'Profesjonalny konferansjer na imprezę',
      1500.00, 500.00,
      0.00, 0.00,
      0.5, 0.5,
      false, false,
      ARRAY['konferansjer', 'prowadzenie', 'wesele']
    )
  ON CONFLICT DO NOTHING;
END $$;

-- Przykładowe produkty - Nagłośnienie
DO $$
DECLARE
  v_category_audio uuid;
BEGIN
  SELECT id INTO v_category_audio FROM offer_product_categories WHERE name = 'Nagłośnienie';

  INSERT INTO offer_products (
    category_id, name, description,
    base_price, cost_price,
    transport_cost, logistics_cost,
    setup_time_hours, teardown_time_hours,
    unit,
    requires_vehicle, requires_driver,
    tags
  ) VALUES
    (
      v_category_audio,
      'Nagłośnienie Basic',
      'Podstawowy zestaw nagłośnieniowy do 100 osób',
      1500.00, 600.00,
      250.00, 100.00,
      2.0, 1.5,
      'komplet',
      true, true,
      ARRAY['audio', 'nagłośnienie', 'basic']
    ),
    (
      v_category_audio,
      'Nagłośnienie Standard',
      'Zestaw nagłośnieniowy do 200 osób',
      2500.00, 1000.00,
      350.00, 150.00,
      3.0, 2.0,
      'komplet',
      true, true,
      ARRAY['audio', 'nagłośnienie', 'standard']
    ),
    (
      v_category_audio,
      'Nagłośnienie Premium',
      'Profesjonalny system line array do 500 osób',
      5000.00, 2000.00,
      500.00, 250.00,
      4.0, 3.0,
      'komplet',
      true, true,
      ARRAY['audio', 'nagłośnienie', 'premium', 'line-array']
    ),
    (
      v_category_audio,
      'Mikrofon bezprzewodowy',
      'Mikrofon bezprzewodowy (dodatkowy)',
      150.00, 50.00,
      0.00, 0.00,
      0.5, 0.5,
      'szt',
      false, false,
      ARRAY['mikrofon', 'bezprzewodowy']
    )
  ON CONFLICT DO NOTHING;
END $$;

-- Przykładowe produkty - Oświetlenie
DO $$
DECLARE
  v_category_light uuid;
BEGIN
  SELECT id INTO v_category_light FROM offer_product_categories WHERE name = 'Oświetlenie';

  INSERT INTO offer_products (
    category_id, name, description,
    base_price, cost_price,
    transport_cost, logistics_cost,
    setup_time_hours, teardown_time_hours,
    requires_vehicle, requires_driver,
    tags
  ) VALUES
    (
      v_category_light,
      'Oświetlenie parkiet Basic',
      'Podstawowe oświetlenie parkietu - 4 reflektory LED',
      800.00, 300.00,
      150.00, 50.00,
      1.5, 1.0,
      true, true,
      ARRAY['oświetlenie', 'parkiet', 'basic']
    ),
    (
      v_category_light,
      'Oświetlenie parkiet Premium',
      'Zaawansowane oświetlenie parkietu - 8 reflektorów LED + moving heads',
      1800.00, 700.00,
      200.00, 100.00,
      2.0, 1.5,
      true, true,
      ARRAY['oświetlenie', 'parkiet', 'premium']
    ),
    (
      v_category_light,
      'Ciężki dym',
      'Wytwornica ciężkiego dymu na pierwszy taniec',
      500.00, 150.00,
      50.00, 25.00,
      0.5, 0.5,
      false, false,
      ARRAY['efekty', 'dym', 'pierwszy-taniec']
    )
  ON CONFLICT DO NOTHING;
END $$;

-- Przykładowe produkty - Multimedia
DO $$
DECLARE
  v_category_multimedia uuid;
BEGIN
  SELECT id INTO v_category_multimedia FROM offer_product_categories WHERE name = 'Multimedia';

  INSERT INTO offer_products (
    category_id, name, description,
    base_price, cost_price,
    transport_cost, logistics_cost,
    setup_time_hours, teardown_time_hours,
    requires_vehicle, requires_driver,
    tags
  ) VALUES
    (
      v_category_multimedia,
      'Projektor + ekran 3m',
      'Projektor Full HD z ekranem 3m',
      600.00, 250.00,
      100.00, 50.00,
      1.0, 0.5,
      false, false,
      ARRAY['projektor', 'ekran', 'prezentacja']
    ),
    (
      v_category_multimedia,
      'Ekran LED 2x3m',
      'Ekran LED modułowy 2x3m',
      3500.00, 1500.00,
      400.00, 200.00,
      3.0, 2.0,
      true, true,
      ARRAY['led', 'ekran', 'premium']
    )
  ON CONFLICT DO NOTHING;
END $$;

-- Domyślny szablon oferty
INSERT INTO offer_templates (
  name, description,
  is_default, is_active,
  show_logo, show_company_details, show_client_details, show_terms, show_payment_info,
  terms_text,
  payment_info_text,
  footer_text
) VALUES (
  'Szablon standardowy',
  'Domyślny szablon oferty dla wszystkich klientów',
  true, true,
  true, true, true, true, true,
  E'WARUNKI OFERTY:\n\n1. Oferta ważna 14 dni od daty wystawienia.\n2. Ceny zawierają podatek VAT 23%.\n3. Termin płatności: 50% zaliczki przy potwierdzeniu, 50% na 7 dni przed wydarzeniem.\n4. Warunki techniczne:\n   - Miejsce przygotowane zgodnie z wymaganiami technicznymi\n   - Dostęp do zasilania 230V\n   - Czas na montaż i demontaż zgodnie z ofertą\n5. Odwołanie wydarzenia:\n   - Do 30 dni przed: zwrot 100% zaliczki\n   - 14-29 dni przed: zwrot 50% zaliczki\n   - Poniżej 14 dni: brak zwrotu',
  E'DANE DO PRZELEWU:\n\nMavinci Sp. z o.o.\nul. Przykładowa 1, 00-000 Warszawa\nNIP: 1234567890\n\nBank: PKO BP\nNr konta: 12 3456 7890 1234 5678 9012 3456',
  'Dziękujemy za zainteresowanie naszą ofertą. W razie pytań prosimy o kontakt.'
)
ON CONFLICT DO NOTHING;
