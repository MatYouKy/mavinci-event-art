/*
  # Add Sample Data to Services Catalog

  Populates services_catalog with existing services from /oferta page.
  Each service has hero image from corresponding page_images table.
*/

INSERT INTO services_catalog (slug, title, description, icon_name, color_from, color_to, border_color, hero_image_url, order_index) VALUES
  ('naglosnienie', 'Nagłośnienie', 'Profesjonalne systemy audio i nagłośnienie eventów', 'Mic', 'blue-500/20', 'blue-600/20', 'border-blue-500/30', 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=800', 1),
  ('konferencje', 'Konferencje', 'Kompleksowa obsługa techniczna konferencji', 'Presentation', 'green-500/20', 'green-600/20', 'border-green-500/30', 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=800', 2),
  ('streaming', 'Streaming', 'Transmisje live i produkcja wideo online', 'Video', 'red-500/20', 'red-600/20', 'border-red-500/30', 'https://images.pexels.com/photos/3184360/pexels-photo-3184360.jpeg?auto=compress&cs=tinysrgb&w=800', 3),
  ('symulatory-vr', 'Symulatory VR', 'Wirtualna rzeczywistość i symulatory na eventy', 'Gamepad2', 'purple-500/20', 'purple-600/20', 'border-purple-500/30', 'https://images.pexels.com/photos/3913025/pexels-photo-3913025.jpeg?auto=compress&cs=tinysrgb&w=800', 4),
  ('quizy-teleturnieje', 'Quizy & Teleturnieje', 'Interaktywne quizy i gry dla gości', 'Sparkles', 'yellow-500/20', 'yellow-600/20', 'border-yellow-500/30', 'https://images.pexels.com/photos/3861969/pexels-photo-3861969.jpeg?auto=compress&cs=tinysrgb&w=800', 5),
  ('integracje', 'Integracje', 'Eventy integracyjne i team building', 'Users', 'pink-500/20', 'pink-600/20', 'border-pink-500/30', 'https://images.pexels.com/photos/1595385/pexels-photo-1595385.jpeg?auto=compress&cs=tinysrgb&w=800', 6),
  ('kasyno', 'Kasyno', 'Profesjonalne stoły do gier kasynowych', 'Sparkles', 'orange-500/20', 'orange-600/20', 'border-orange-500/30', 'https://images.pexels.com/photos/3989818/pexels-photo-3989818.jpeg?auto=compress&cs=tinysrgb&w=800', 7),
  ('wieczory-tematyczne', 'Wieczory Tematyczne', 'Organizacja eventów tematycznych', 'Lamp', 'cyan-500/20', 'cyan-600/20', 'border-cyan-500/30', 'https://images.pexels.com/photos/2263436/pexels-photo-2263436.jpeg?auto=compress&cs=tinysrgb&w=800', 8),
  ('technika-sceniczna', 'Technika Sceniczna', 'Oświetlenie, sceny i efekty specjalne', 'Monitor', 'indigo-500/20', 'indigo-600/20', 'border-indigo-500/30', 'https://images.pexels.com/photos/2102568/pexels-photo-2102568.jpeg?auto=compress&cs=tinysrgb&w=800', 9)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  icon_name = EXCLUDED.icon_name,
  color_from = EXCLUDED.color_from,
  color_to = EXCLUDED.color_to,
  border_color = EXCLUDED.border_color,
  hero_image_url = EXCLUDED.hero_image_url,
  order_index = EXCLUDED.order_index,
  updated_at = now();