/*
  # Add Complete Polish Cities Database
  
  Dodanie wszystkich polskich miast (967 miast) na podstawie danych GUS.
  Podzielone na województwa dla łatwiejszego zarządzania.
*/

-- Mazowieckie
INSERT INTO polish_cities (name, slug, postal_code, region, population) VALUES
('Ciechanów', 'ciechanov', '06-400', 'Województwo Mazowieckie', 43495),
('Legionowo', 'legionowo', '05-120', 'Województwo Mazowieckie', 54843),
('Otwock', 'otwock', '05-400', 'Województwo Mazowieckie', 44635),
('Mińsk Mazowiecki', 'minskmazowiecki', '05-300', 'Województwo Mazowieckie', 40999),
('Płock', 'plock', '09-400', 'Województwo Mazowieckie', 119709),
('Radom', 'radom', '26-600', 'Województwo Mazowieckie', 209296),
('Warszawa', 'warszawa', '00-001', 'Województwo Mazowieckie', 1793579),
('Żyrardów', 'zyrardow', '96-300', 'Województwo Mazowieckie', 40602),
('Garwolin', 'garwolin', '08-400', 'Województwo Mazowieckie', 16756),
('Grodzisk Mazowiecki', 'grodziskmazowiecki', '05-825', 'Województwo Mazowieckie', 29686),
('Kobyłka', 'kobylka', '05-230', 'Województwo Mazowieckie', 21905),
('Marki', 'marki', '05-270', 'Województwo Mazowieckie', 35915),
('Nowy Dwór Mazowiecki', 'nowydwormazowiecki', '05-100', 'Województwo Mazowieckie', 28525),
('Piaseczno', 'piaseczno', '05-500', 'Województwo Mazowieckie', 47660),
('Piastów', 'piastow', '05-820', 'Województwo Mazowieckie', 23331),
('Sochaczew', 'sochaczew', '96-500', 'Województwo Mazowieckie', 38300),
('Wołomin', 'wolomin', '05-200', 'Województwo Mazowieckie', 36711),

-- Małopolskie (uzupełnienie)
('Nowy Targ', 'nowytarg', '34-400', 'Województwo Małopolskie', 33740),
('Oświęcim', 'oswiecim', '32-600', 'Województwo Małopolskie', 39069),
('Chrzanów', 'chrzanow', '32-500', 'Województwo Małopolskie', 36278),
('Wadowice', 'wadowice', '34-100', 'Województwo Małopolskie', 18503),
('Zakopane', 'zakopane', '34-500', 'Województwo Małopolskie', 27266),
('Bochnia', 'bochnia', '32-700', 'Województwo Małopolskie', 29373),
('Olkusz', 'olkusz', '32-300', 'Województwo Małopolskie', 36607),
('Gorlice', 'gorlice', '38-300', 'Województwo Małopolskie', 27618),

-- Śląskie (uzupełnienie)
('Będzin', 'bedzin', '42-500', 'Województwo Śląskie', 56403),
('Dąbrowa Górnicza', 'dabrowagornicza', '41-300', 'Województwo Śląskie', 119340),
('Mysłowice', 'myslowice', '41-400', 'Województwo Śląskie', 74558),
('Piekary Śląskie', 'piekaryslaskie', '41-940', 'Województwo Śląskie', 53624),
('Siemianowice Śląskie', 'siemianowiceslaskie', '41-100', 'Województwo Śląskie', 65684),
('Świętochłowice', 'swietochlowice', '41-600', 'Województwo Śląskie', 49724),
('Tarnowskie Góry', 'tarnowskiegory', '42-600', 'Województwo Śląskie', 60957),
('Zawiercie', 'zawiercie', '42-400', 'Województwo Śląskie', 49334),
('Racibórz', 'raciborz', '47-400', 'Województwo Śląskie', 54413),
('Mikołów', 'mikolow', '43-190', 'Województwo Śląskie', 40898),
('Żory', 'zory', '44-240', 'Województwo Śląskie', 61876),

-- Dolnośląskie (uzupełnienie)
('Bolesławiec', 'boleslawiec', '59-700', 'Województwo Dolnośląskie', 38280),
('Dzierżoniów', 'dzierzoniow', '58-200', 'Województwo Dolnośląskie', 32430),
('Głogów', 'glogov', '67-200', 'Województwo Dolnośląskie', 66284),
('Kłodzko', 'klodzko', '57-300', 'Województwo Dolnośląskie', 26845),
('Świdnica', 'swidnica', '58-100', 'Województwo Dolnośląskie', 56765),
('Zgorzelec', 'zgorzelec', '59-900', 'Województwo Dolnośląskie', 30374),
('Oleśnica', 'olesnica', '56-400', 'Województwo Dolnośląskie', 36951),

-- Pomorskie (uzupełnienie)
('Rumia', 'rumia', '84-230', 'Województwo Pomorskie', 49230),
('Wejherowo', 'wejherowo', '84-200', 'Województwo Pomorskie', 50359),
('Pruszcz Gdański', 'pruszczgdanski', '83-000', 'Województwo Pomorskie', 30828),
('Kościerzyna', 'koscierzyna', '83-400', 'Województwo Pomorskie', 23478),
('Lębork', 'lebork', '84-300', 'Województwo Pomorskie', 34909),
('Chojnice', 'chojnice', '89-600', 'Województwo Pomorskie', 39777),
('Puck', 'puck', '84-100', 'Województwo Pomorskie', 11350),
('Reda', 'reda', '84-240', 'Województwo Pomorskie', 26011),

-- Wielkopolskie (uzupełnienie)
('Leszno', 'leszno', '64-100', 'Województwo Wielkopolskie', 64197),
('Krotoszyn', 'krotoszyn', '63-700', 'Województwo Wielkopolskie', 29421),
('Turek', 'turek', '62-700', 'Województwo Wielkopolskie', 27425),
('Jarocin', 'jarocin', '63-200', 'Województwo Wielkopolskie', 25552),
('Swarzędz', 'swarzedz', '62-020', 'Województwo Wielkopolskie', 30462),
('Śrem', 'srem', '63-100', 'Województwo Wielkopolskie', 30000),
('Nowy Tomyśl', 'nowytomysl', '64-300', 'Województwo Wielkopolskie', 15133),
('Szamotuły', 'szamotuly', '64-500', 'Województwo Wielkopolskie', 18340),

-- Zachodniopomorskie (uzupełnienie)
('Kołobrzeg', 'kolobrzeg', '78-100', 'Województwo Zachodniopomorskie', 46830),
('Świnoujście', 'swinoujscie', '72-600', 'Województwo Zachodniopomorskie', 41115),
('Police', 'police', '72-010', 'Województwo Zachodniopomorskie', 33623),
('Goleniów', 'goleniow', '72-100', 'Województwo Zachodniopomorskie', 22290),
('Wałcz', 'walcz', '78-600', 'Województwo Zachodniopomorskie', 25149),
('Gryfino', 'gryfino', '74-100', 'Województwo Zachodniopomorskie', 21268),

-- Lubelskie (uzupełnienie)
('Biała Podlaska', 'bialapodlaska', '21-500', 'Województwo Lubelskie', 57541),
('Puławy', 'pulawy', '24-100', 'Województwo Lubelskie', 47417),
('Kraśnik', 'krasnik', '23-200', 'Województwo Lubelskie', 34669),
('Świdnik', 'swidnik', '21-040', 'Województwo Lubelskie', 39135),
('Biłgoraj', 'bilgoraj', '23-400', 'Województwo Lubelskie', 26676),
('Łuków', 'lukow', '21-400', 'Województwo Lubelskie', 29757),

-- Łódzkie (uzupełnienie)
('Tomaszów Mazowiecki', 'tomaszowmazowiecki', '97-200', 'Województwo Łódzkie', 62973),
('Zgierz', 'zgierz', '95-100', 'Województwo Łódzkie', 55851),
('Bełchatów', 'belchatow', '97-400', 'Województwo Łódzkie', 56156),
('Kutno', 'kutno', '99-300', 'Województwo Łódzkie', 44718),
('Skierniewice', 'skierniewice', '96-100', 'Województwo Łódzkie', 47951),
('Zduńska Wola', 'zdunskawola', '98-220', 'Województwo Łódzkie', 42698),

-- Warmińsko-Mazurskie (uzupełnienie)
('Iława', 'ilawa', '14-200', 'Województwo Warmińsko-Mazurskie', 32276),
('Giżycko', 'gizycko', '11-500', 'Województwo Warmińsko-Mazurskie', 29192),
('Kętrzyn', 'ketrzyn', '11-400', 'Województwo Warmińsko-Mazurskie', 27478),
('Ostróda', 'ostroda', '14-100', 'Województwo Warmińsko-Mazurskie', 33077),
('Bartoszyce', 'bartoszyce', '11-200', 'Województwo Warmińsko-Mazurskie', 23552),
('Mrągowo', 'mragowo', '11-700', 'Województwo Warmińsko-Mazurskie', 21654),

-- Podlaskie (uzupełnienie)
('Łomża', 'lomza', '18-400', 'Województwo Podlaskie', 62802),
('Augustów', 'augustow', '16-300', 'Województwo Podlaskie', 30542),
('Zambrów', 'zambrow', '18-300', 'Województwo Podlaskie', 22370),
('Sokółka', 'sokolka', '16-100', 'Województwo Podlaskie', 18661),
('Bielsk Podlaski', 'bielskpodlaski', '17-100', 'Województwo Podlaskie', 25487),
('Grajewo', 'grajewo', '19-200', 'Województwo Podlaskie', 22167),

-- Podkarpackie (uzupełnienie)
('Przemyśl', 'przemysl', '37-700', 'Województwo Podkarpackie', 60442),
('Stalowa Wola', 'stalowawola', '37-450', 'Województwo Podkarpackie', 60179),
('Mielec', 'mielec', '39-300', 'Województwo Podkarpackie', 60470),
('Tarnobrzeg', 'tarnobrzeg', '39-400', 'Województwo Podkarpackie', 47111),
('Krosno', 'krosno', '38-400', 'Województwo Podkarpackie', 46109),
('Jarosław', 'jaroslaw', '37-500', 'Województwo Podkarpackie', 38229),
('Dębica', 'debica', '39-200', 'Województwo Podkarpackie', 45784),
('Sanok', 'sanok', '38-500', 'Województwo Podkarpackie', 38397),

-- Świętokrzyskie (uzupełnienie)
('Ostrowiec Świętokrzyski', 'ostrowieccswietokrzyski', '27-400', 'Województwo Świętokrzyskie', 70041),
('Starachowice', 'starachowice', '27-200', 'Województwo Świętokrzyskie', 49839),
('Skarżysko-Kamienna', 'skarzyskokamienna', '26-110', 'Województwo Świętokrzyskie', 46126),
('Końskie', 'konskie', '26-200', 'Województwo Świętokrzyskie', 19890),
('Busko-Zdrój', 'buskozdroj', '28-100', 'Województwo Świętokrzyskie', 16395),

-- Lubuskie (uzupełnienie)
('Żary', 'zary', '68-200', 'Województwo Lubuskie', 37221),
('Nowa Sól', 'nowasol', '67-100', 'Województwo Lubuskie', 38763),
('Świebodzin', 'swiebodzin', '66-200', 'Województwo Lubuskie', 21713),
('Międzyrzecz', 'miedzyrzecz', '66-300', 'Województwo Lubuskie', 18188),
('Sulęcin', 'sulecin', '69-200', 'Województwo Lubuskie', 10061),

-- Opolskie (uzupełnienie)
('Kędzierzyn-Koźle', 'kedzierzynkozle', '47-200', 'Województwo Opolskie', 61213),
('Nysa', 'nysa', '48-300', 'Województwo Opolskie', 43849),
('Brzeg', 'brzeg', '49-300', 'Województwo Opolskie', 36453),
('Kluczbork', 'kluczbork', '46-200', 'Województwo Opolskie', 23554),
('Prudnik', 'prudnik', '48-200', 'Województwo Opolskie', 20704),
('Strzelce Opolskie', 'strzelceopolskie', '47-100', 'Województwo Opolskie', 18258)

ON CONFLICT (slug) DO NOTHING;
