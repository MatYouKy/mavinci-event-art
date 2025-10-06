/*
  # Sample Data for Site Images

  Populates site_images table with current images from the website:
  - Hero background
  - Divider backgrounds (4 sections)
  - Service page backgrounds
  - Process background
  - Team member photos
  - Portfolio project images
*/

-- Insert Hero section image
INSERT INTO site_images (section, name, description, desktop_url, mobile_url, alt_text, position, order_index)
VALUES
(
  'hero',
  'Hero Background',
  'Main hero section background image on homepage',
  'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Profesjonalna organizacja eventów biznesowych',
  'center',
  1
);

-- Insert Divider section images
INSERT INTO site_images (section, name, description, desktop_url, mobile_url, alt_text, position, order_index)
VALUES
(
  'divider1',
  'Divider 1 Background',
  'First divider section background',
  'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Event decoration and setup',
  'center',
  1
),
(
  'divider2',
  'Divider 2 Background',
  'Second divider section background',
  'https://images.pexels.com/photos/2608517/pexels-photo-2608517.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/2608517/pexels-photo-2608517.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Professional event lighting',
  'center',
  1
),
(
  'divider3',
  'Divider 3 Background',
  'Third divider section background',
  'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Corporate event venue',
  'center',
  1
),
(
  'divider4',
  'Divider 4 Background',
  'Fourth divider section background',
  'https://images.pexels.com/photos/1157557/pexels-photo-1157557.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/1157557/pexels-photo-1157557.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Event stage and audio equipment',
  'center',
  1
);

-- Insert Process section image
INSERT INTO site_images (section, name, description, desktop_url, mobile_url, alt_text, position, order_index)
VALUES
(
  'process',
  'Process Section Background',
  'Background for process/how we work section',
  'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Conference and event setup',
  'center',
  1
);

-- Insert Service page hero images
INSERT INTO site_images (section, name, description, desktop_url, mobile_url, alt_text, position, order_index)
VALUES
(
  'service_konferencje',
  'Konferencje Hero',
  'Hero background for conferences service page',
  'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Conference room setup',
  'center',
  1
),
(
  'service_integracje',
  'Integracje Hero',
  'Hero background for company integrations service page',
  'https://images.pexels.com/photos/1395967/pexels-photo-1395967.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/1395967/pexels-photo-1395967.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Company integration party',
  'center',
  1
),
(
  'service_wieczory',
  'Wieczory Tematyczne Hero',
  'Hero background for themed evenings service page',
  'https://images.pexels.com/photos/1679618/pexels-photo-1679618.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/1679618/pexels-photo-1679618.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Themed party event',
  'center',
  1
),
(
  'service_quizy',
  'Quizy Hero',
  'Hero background for quizzes and game shows service page',
  'https://images.pexels.com/photos/3184418/pexels-photo-3184418.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/3184418/pexels-photo-3184418.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Quiz event setup',
  'center',
  1
),
(
  'service_kasyno',
  'Kasyno Hero',
  'Hero background for casino service page',
  'https://images.pexels.com/photos/262508/pexels-photo-262508.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/262508/pexels-photo-262508.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Casino cards and chips',
  'center',
  1
),
(
  'service_vr',
  'Symulatory VR Hero',
  'Hero background for VR simulators service page',
  'https://images.pexels.com/photos/2007647/pexels-photo-2007647.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/2007647/pexels-photo-2007647.jpeg?auto=compress&cs=tinysrgb&w=800',
  'VR headset',
  'center',
  1
),
(
  'service_technika',
  'Technika Sceniczna Hero',
  'Hero background for stage technology service page',
  'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Stage lighting equipment',
  'center',
  1
),
(
  'service_naglosnienie',
  'Nagłośnienie Hero',
  'Hero background for sound system service page',
  'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Professional sound equipment',
  'center',
  1
),
(
  'service_streaming',
  'Streaming Hero',
  'Hero background for streaming service page',
  'https://images.pexels.com/photos/3184360/pexels-photo-3184360.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/3184360/pexels-photo-3184360.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Streaming equipment setup',
  'center',
  1
);

-- Insert About page hero images
INSERT INTO site_images (section, name, description, desktop_url, mobile_url, alt_text, position, order_index)
VALUES
(
  'about_hero',
  'O Nas Hero',
  'Hero background for about page',
  'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=800',
  'About us background',
  'center',
  1
),
(
  'about_gallery1',
  'O Nas Galeria 1',
  'First gallery image on about page',
  'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=600',
  'Our event setup',
  'center',
  1
),
(
  'about_gallery2',
  'O Nas Galeria 2',
  'Second gallery image on about page',
  'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=1200',
  'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=600',
  'Our team at work',
  'center',
  2
);

-- Insert Team page hero
INSERT INTO site_images (section, name, description, desktop_url, mobile_url, alt_text, position, order_index)
VALUES
(
  'team_hero',
  'Zespół Hero',
  'Hero background for team page',
  'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Team background',
  'center',
  1
);

-- Insert Portfolio page hero
INSERT INTO site_images (section, name, description, desktop_url, mobile_url, alt_text, position, order_index)
VALUES
(
  'portfolio_hero',
  'Portfolio Hero',
  'Hero background for portfolio page',
  'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920',
  'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=800',
  'Portfolio showcase',
  'center',
  1
);
