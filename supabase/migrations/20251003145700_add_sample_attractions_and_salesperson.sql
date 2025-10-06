/*
  # Przykładowe dane dla systemu ofert
  
  - Katalog atrakcji Mavinci z cenami
  - Przykładowy sprzedawca
*/

-- SPRZEDAWCA (będzie powiązany z kontem auth później)
INSERT INTO salespeople (email, first_name, last_name, phone_number, is_active, commission_rate)
VALUES ('sprzedawca@mavinci.pl', 'Jan', 'Kowalski', '+48 600 100 200', true, 10.00)
ON CONFLICT (email) DO NOTHING;

-- ATRAKCJE - NAGŁOŚNIENIE
INSERT INTO attractions (name, description, category, base_price, unit, duration_hours, tags) VALUES
('Nagłośnienie podstawowe', 'System nagłośnieniowy do 100 osób, 2x kolumny, mikser', 'sound_system', 800.00, 'komplet', 8, ARRAY['nagłośnienie', 'podstawowe', 'małe eventy']),
('Nagłośnienie średnie', 'System dla 100-300 osób, 4x kolumny, subwoofer, mikser cyfrowy', 'sound_system', 1500.00, 'komplet', 8, ARRAY['nagłośnienie', 'średnie eventy', 'konferencje']),
('Nagłośnienie duże', 'Profesjonalny system dla 300-1000 osób, line array, stery, pełna obsługa', 'sound_system', 3500.00, 'komplet', 8, ARRAY['nagłośnienie', 'duże eventy', 'koncerty']),
('Mikrofon bezprzewodowy', 'Mikrofon ręczny Shure/Sennheiser', 'sound_system', 150.00, 'szt', 8, ARRAY['mikrofon', 'bezprzewodowy']),
('Mikrofon krawatowy', 'Mikrofon lavalier bezprzewodowy', 'sound_system', 200.00, 'szt', 8, ARRAY['mikrofon', 'krawatowy']),

-- OŚWIETLENIE
('Oświetlenie LED PAR', 'Zestaw 8x reflektor LED PAR RGB, kontroler DMX', 'lighting', 600.00, 'komplet', 8, ARRAY['oświetlenie', 'LED', 'dekoracyjne']),
('Moving Heads', 'Zestaw 4x ruchome głowy LED Spot/Beam', 'lighting', 1200.00, 'komplet', 8, ARRAY['oświetlenie', 'moving heads', 'efekty']),
('Oświetlenie architektoniczne', 'Podświetlenie ścian, kolumn, 12x LED BAR', 'lighting', 900.00, 'komplet', 8, ARRAY['oświetlenie', 'architektura', 'dekoracje']),
('Wytwornica dymu', 'Hazer/wytwornica efektów specjalnych', 'lighting', 250.00, 'szt', 8, ARRAY['efekty', 'dym', 'atmosfera']),
('Laser show', 'Profesjonalny system laserowy RGB 3W', 'lighting', 1500.00, 'komplet', 4, ARRAY['laser', 'efekty', 'show']),

-- DJ
('DJ - Pakiet Basic', 'DJ z podstawowym sprzętem, 4h gry', 'dj_services', 1200.00, 'usługa', 4, ARRAY['DJ', 'muzyka', 'basic']),
('DJ - Pakiet Standard', 'DJ z profesjonalnym sprzętem, 6h gry, konsultacja playlisty', 'dj_services', 1800.00, 'usługa', 6, ARRAY['DJ', 'muzyka', 'standard']),
('DJ - Pakiet Premium', 'DJ + VJ, 8h, sprzęt premium, dedykowana oprawa', 'dj_services', 3000.00, 'usługa', 8, ARRAY['DJ', 'VJ', 'premium']),
('Konferansjer', 'Prowadzenie imprezy, gry, zabawy', 'dj_services', 800.00, 'usługa', 4, ARRAY['konferansjer', 'prowadzenie', 'animacje']),

-- TECHNIKA SCENICZNA
('Scena modułowa 4x3m', 'Scena podestowa z zadaszeniem', 'stage_tech', 1500.00, 'komplet', 8, ARRAY['scena', 'podest', 'konstrukcja']),
('Scena modułowa 6x4m', 'Scena podestowa z pełnym zadaszeniem i bokami', 'stage_tech', 2500.00, 'komplet', 8, ARRAY['scena', 'duża', 'konstrukcja']),
('Ekran LED 3x2m', 'Ścianka LED do prezentacji, transmisji', 'stage_tech', 2000.00, 'szt', 8, ARRAY['LED', 'ekran', 'prezentacje']),
('Projektor + ekran', 'Projektor Full HD 5000 ANSI + ekran 3x2m', 'stage_tech', 600.00, 'komplet', 8, ARRAY['projektor', 'prezentacje']),

-- DEKORACJE
('Tkaniny dekoracyjne', 'Dekoracja sali tkaniną, 50m2', 'decorations', 800.00, 'komplet', 8, ARRAY['dekoracje', 'tkaniny', 'wystrój']),
('Girlandy świetlne', 'Oświetlenie dekoracyjne, 100m', 'decorations', 400.00, 'komplet', 8, ARRAY['girlandy', 'światła', 'dekoracje']),
('Balonowa dekoracja', 'Brama balonowa lub dekoracja ściany', 'decorations', 600.00, 'komplet', 2, ARRAY['balony', 'dekoracje']),

-- ATRAKCJE
('Fotobudka', 'Fotobudka z gadżetami, wydruki unlimited', 'entertainment', 1200.00, 'usługa', 4, ARRAY['fotobudka', 'zdjęcia', 'atrakcje']),
('Barman na event', 'Profesjonalny barman, bar mobilny', 'entertainment', 1000.00, 'usługa', 6, ARRAY['barman', 'drinki', 'obsługa']),
('Candy bar', 'Słodki stół z dekoracją', 'entertainment', 800.00, 'komplet', 8, ARRAY['candy bar', 'słodycze', 'catering']),

-- KASYNO
('Stoły kasynowe - zestaw 3', '3 stoły: Ruletka, Black Jack, Poker + krupierzy', 'casino', 2500.00, 'komplet', 4, ARRAY['kasyno', 'gry', 'rozrywka']),
('Stoły kasynowe - zestaw 5', '5 stołów różne gry + krupierzy', 'casino', 3500.00, 'komplet', 4, ARRAY['kasyno', 'gry', 'duży event']),

-- SYMULATORY
('Symulator VR - 2 stanowiska', 'Gogle VR z grami + obsługa', 'simulators', 1500.00, 'komplet', 4, ARRAY['VR', 'symulatory', 'nowoczesne']),
('Symulator rajdowy', 'Fotel z kierownicą i pedałami + ekran', 'simulators', 1200.00, 'szt', 4, ARRAY['symulator', 'racing', 'gry']),

-- KONFERENCJE
('System konferencyjny', 'Mikrofony konferencyjne + jednostka centralna dla 20 osób', 'conference', 1000.00, 'komplet', 8, ARRAY['konferencja', 'mikrofony', 'dyskusja']),
('Tłumaczenie symultaniczne', 'Sprzęt + kabina dla 2 tłumaczy', 'conference', 2000.00, 'komplet', 8, ARRAY['tłumaczenie', 'konferencja', 'języki']),
('System do głosowania', 'Piloty + oprogramowanie dla 100 osób', 'conference', 1500.00, 'komplet', 4, ARRAY['głosowanie', 'interaktywne', 'konferencja']),

-- STREAMING
('Streaming - pakiet basic', 'Kamera + komputer + operator, stream 1080p', 'streaming', 1500.00, 'usługa', 4, ARRAY['streaming', 'transmisja', 'online']),
('Streaming - pakiet pro', '3 kamery + mixer video + realizator, stream 4K', 'streaming', 3500.00, 'usługa', 6, ARRAY['streaming', 'transmisja', 'profesjonalne']),

-- INNE
('Technik/operator', 'Technik do obsługi sprzętu', 'other', 150.00, 'godz', 1, ARRAY['technik', 'obsługa', 'personel']),
('Transport sprzętu', 'Transport, załadunek, rozładunek w promieniu 50km', 'other', 400.00, 'usługa', 0, ARRAY['transport', 'logistyka']),
('Montaż/demontaż', 'Montaż i demontaż konstrukcji scenicznych', 'other', 600.00, 'usługa', 0, ARRAY['montaż', 'praca', 'logistyka']);

-- Aktualizuj wszystkie jako aktywne
UPDATE attractions SET is_active = true;
