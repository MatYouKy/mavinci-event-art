/*
  # Dodanie domyślnych szablonów stron ofert

  1. Szablony
    - Strona tytułowa (cover)
    - O nas (about)
    - Wycena (pricing)
    - Strona końcowa (final)
  
  2. Zawartość każdego szablonu
*/

DO $$
DECLARE
  v_cover_template_id uuid;
  v_about_template_id uuid;
  v_pricing_template_id uuid;
  v_final_template_id uuid;
BEGIN
  -- Szablon strony tytułowej
  INSERT INTO offer_page_templates (type, name, description, is_default, is_active)
  VALUES ('cover', 'Strona tytułowa - Standard', 'Standardowa strona tytułowa z logo i danymi oferty', true, true)
  RETURNING id INTO v_cover_template_id;

  -- Sekcje strony tytułowej
  INSERT INTO offer_page_template_content (template_id, section_type, content_html, display_order) VALUES
    (v_cover_template_id, 'logo', '<div style="text-align: center; margin-bottom: 40px;"><h1 style="color: #d3bb73; font-size: 48px; font-weight: 300;">MAVINCI</h1><p style="color: #666; font-size: 14px;">Profesjonalne rozwiązania eventowe</p></div>', 0),
    (v_cover_template_id, 'title', '<h1 style="color: #1c1f33; font-size: 42px; margin-bottom: 20px; text-align: center;">OFERTA CENOWA</h1>', 1),
    (v_cover_template_id, 'client_details', '<div style="margin: 40px 0;"><h3 style="color: #d3bb73;">Dla:</h3><p style="font-size: 18px; color: #1c1f33;">{{CLIENT_NAME}}</p><p style="color: #666;">{{CLIENT_ADDRESS}}</p></div>', 2),
    (v_cover_template_id, 'offer_details', '<div style="margin: 40px 0;"><p style="color: #666;">Numer oferty: <strong>{{OFFER_NUMBER}}</strong></p><p style="color: #666;">Data: <strong>{{OFFER_DATE}}</strong></p><p style="color: #666;">Ważna do: <strong>{{VALID_UNTIL}}</strong></p></div>', 3),
    (v_cover_template_id, 'background_image', '', 4);

  -- Szablon "O nas"
  INSERT INTO offer_page_templates (type, name, description, is_default, is_active)
  VALUES ('about', 'O firmie - Standard', 'Strona z informacjami o firmie i doświadczeniu', true, true)
  RETURNING id INTO v_about_template_id;

  -- Sekcje "O nas"
  INSERT INTO offer_page_template_content (template_id, section_type, content_html, display_order) VALUES
    (v_about_template_id, 'company_description', '<h2 style="color: #d3bb73; margin-bottom: 20px;">O nas</h2><p style="line-height: 1.8; color: #333;">Jesteśmy profesjonalną firmą eventową z wieloletnim doświadczeniem w organizacji wydarzeń biznesowych, kulturalnych i rozrywkowych. Nasz zespół składa się z doświadczonych specjalistów, którzy zadbają o każdy detal Twojego eventu.</p>', 0),
    (v_about_template_id, 'achievements', '<h3 style="color: #1c1f33; margin: 30px 0 15px;">Nasze osiągnięcia</h3><ul style="line-height: 2; color: #333;"><li>Ponad 500 zrealizowanych eventów</li><li>Współpraca z największymi markami w Polsce</li><li>Własny park sprzętowy najwyższej klasy</li><li>Zespół 20+ doświadczonych specjalistów</li></ul>', 1),
    (v_about_template_id, 'certifications', '<h3 style="color: #1c1f33; margin: 30px 0 15px;">Certyfikaty i nagrody</h3><p style="color: #666;">Posiadamy wszystkie niezbędne certyfikaty i uprawnienia do prowadzenia działalności eventowej.</p>', 2),
    (v_about_template_id, 'team', '', 3),
    (v_about_template_id, 'gallery', '', 4);

  -- Szablon wyceny
  INSERT INTO offer_page_templates (type, name, description, is_default, is_active)
  VALUES ('pricing', 'Wycena - Standard', 'Strona z podsumowaniem cenowym i warunkami', true, true)
  RETURNING id INTO v_pricing_template_id;

  -- Sekcje wyceny
  INSERT INTO offer_page_template_content (template_id, section_type, content_html, display_order) VALUES
    (v_pricing_template_id, 'summary_table', '<h2 style="color: #d3bb73; margin-bottom: 30px;">Podsumowanie cenowe</h2><p style="color: #666; margin-bottom: 20px;">Szczegółowy wykaz pozycji znajduje się w pozostałych częściach oferty.</p>', 0),
    (v_pricing_template_id, 'payment_terms', '<h3 style="color: #1c1f33; margin: 30px 0 15px;">Warunki płatności</h3><ul style="line-height: 2; color: #333;"><li>Zaliczka 50% przy podpisaniu umowy</li><li>Pozostała kwota 7 dni przed eventem</li><li>Możliwość płatności przelewem lub gotówką</li></ul>', 1),
    (v_pricing_template_id, 'validity', '<div style="background: #f8f9fa; padding: 20px; border-left: 4px solid #d3bb73; margin: 30px 0;"><p style="color: #666; margin: 0;">Oferta ważna przez <strong>14 dni</strong> od daty wystawienia.</p></div>', 2),
    (v_pricing_template_id, 'notes', '<h3 style="color: #1c1f33; margin: 30px 0 15px;">Uwagi</h3><p style="color: #666; line-height: 1.8;">Cena zawiera wszystkie pozycje wymienione w ofercie. Transport, montaż i obsługę techniczną. Nie obejmuje catringu ani wyposażenia dodatkowego niewymienionego w ofercie.</p>', 3);

  -- Szablon strony końcowej
  INSERT INTO offer_page_templates (type, name, description, is_default, is_active)
  VALUES ('final', 'Strona końcowa - Standard', 'Strona końcowa z warunkami technicznymi i danymi sprzedawcy', true, true)
  RETURNING id INTO v_final_template_id;

  -- Sekcje strony końcowej
  INSERT INTO offer_page_template_content (template_id, section_type, content_html, display_order) VALUES
    (v_final_template_id, 'technical_requirements', '<h2 style="color: #d3bb73; margin-bottom: 20px;">Wymagania techniczne</h2><h3 style="color: #1c1f33; margin: 20px 0 10px;">Zasilanie</h3><p style="color: #666;">Wymagane jest zapewnienie zasilania 230V/400V o mocy min. {{POWER_REQUIREMENT}}kW w odległości do 30m od sceny.</p><h3 style="color: #1c1f33; margin: 20px 0 10px;">Dostęp</h3><p style="color: #666;">Konieczny swobodny dojazd dla pojazdów transportowych (busów i samochodów ciężarowych) bezpośrednio do miejsca montażu sprzętu.</p><h3 style="color: #1c1f33; margin: 20px 0 10px;">Czas montażu</h3><p style="color: #666;">Montaż wymaga minimum {{SETUP_TIME}} godzin przed rozpoczęciem eventu. Demontaż około {{BREAKDOWN_TIME}} godziny.</p>', 0),
    (v_final_template_id, 'seller_details', '<h2 style="color: #d3bb73; margin: 40px 0 20px;">Dane sprzedawcy</h2><div style="color: #333; line-height: 2;"><p><strong>{{SELLER_NAME}}</strong></p><p>{{SELLER_POSITION}}</p><p>Tel: {{SELLER_PHONE}}</p><p>Email: {{SELLER_EMAIL}}</p></div>', 1),
    (v_final_template_id, 'contact_info', '<div style="margin: 40px 0;"><h3 style="color: #1c1f33; margin-bottom: 15px;">Dane kontaktowe firmy</h3><p style="color: #666; line-height: 2;">MAVINCI Sp. z o.o.<br>ul. Przykładowa 123<br>00-001 Warszawa<br>NIP: 1234567890<br>REGON: 123456789<br>Tel: +48 123 456 789<br>Email: biuro@mavinci.pl<br>www.mavinci.pl</p></div>', 2),
    (v_final_template_id, 'legal_terms', '<h3 style="color: #1c1f33; margin: 30px 0 15px;">Warunki prawne</h3><p style="color: #666; font-size: 12px; line-height: 1.6;">Niniejsza oferta nie stanowi oferty handlowej w rozumieniu art. 66 par. 1 Kodeksu Cywilnego. Podpisanie umowy jest równoznaczne z akceptacją naszych Ogólnych Warunków Świadczenia Usług.</p>', 3),
    (v_final_template_id, 'footer', '<div style="text-align: center; margin-top: 60px; padding-top: 30px; border-top: 1px solid #ddd;"><p style="color: #666; font-size: 14px;">Dziękujemy za zainteresowanie naszą ofertą!</p><p style="color: #999; font-size: 12px; margin-top: 10px;">Dokument wygenerowany automatycznie przez system CRM MAVINCI</p></div>', 4);

END $$;
