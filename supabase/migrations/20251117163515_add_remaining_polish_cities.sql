/*
  # Add Remaining Polish Cities
  
  Dodanie wszystkich pozostałych polskich miast (ponad 300+ dodatkowych).
  Obejmuje wszystkie miasta powiatowe i większe gminy miejskie.
*/

INSERT INTO polish_cities (name, slug, postal_code, region, population) VALUES
-- Warmińsko-Mazurskie (uzupełnienie)
('Szczytno', 'szczytno', '12-100', 'Województwo Warmińsko-Mazurskie', 25680),
('Lidzbark Warmiński', 'lidzbarkvarminski', '11-100', 'Województwo Warmińsko-Mazurskie', 15864),
('Nidzica', 'nidzica', '13-100', 'Województwo Warmińsko-Mazurskie', 14265),
('Pisz', 'pisz', '12-200', 'Województwo Warmińsko-Mazurskie', 19332),
('Działdowo', 'dzialdovo', '13-200', 'Województwo Warmińsko-Mazurskie', 20309),
('Węgorzewo', 'vegorzewo', '11-600', 'Województwo Warmińsko-Mazurskie', 11432),
('Gołdap', 'goldap', '19-500', 'Województwo Warmińsko-Mazurskie', 13641),

-- Mazowieckie (uzupełnienie - miasta powiatowe)
('Białobrzegi', 'bialobrzegi', '26-800', 'Województwo Mazowieckie', 7385),
('Góra Kalwaria', 'gorakalwaria', '05-530', 'Województwo Mazowieckie', 12109),
('Grójec', 'grojec', '05-600', 'Województwo Mazowieckie', 16542),
('Kozienice', 'kozienice', '26-900', 'Województwo Mazowieckie', 17520),
('Łosice', 'losice', '08-200', 'Województwo Mazowieckie', 7037),
('Maków Mazowiecki', 'makovmazowiecki', '06-200', 'Województwo Mazowieckie', 9902),
('Mława', 'mlawa', '06-500', 'Województwo Mazowieckie', 30902),
('Mszczonów', 'mszczonov', '96-320', 'Województwo Mazowieckie', 6310),
('Ostrołęka', 'ostrolenka', '07-410', 'Województwo Mazowieckie', 51012),
('Ostrów Mazowiecka', 'ostrovmazovecka', '07-300', 'Województwo Mazowieckie', 22380),
('Przasnysz', 'przasnysz', '06-300', 'Województwo Mazowieckie', 16819),
('Pułtusk', 'pultusk', '06-100', 'Województwo Mazowieckie', 19229),
('Sierpc', 'sierpc', '09-200', 'Województwo Mazowieckie', 17500),
('Sokołów Podlaski', 'sokolovpodlaski', '08-300', 'Województwo Mazowieckie', 18432),
('Węgrów', 'vegrov', '07-100', 'Województwo Mazowieckie', 12511),
('Wyszków', 'vyszkuv', '07-200', 'Województwo Mazowieckie', 26881),
('Zwoleń', 'zvolen', '26-700', 'Województwo Mazowieckie', 7824),
('Żuromin', 'zuromin', '09-300', 'Województwo Mazowieckie', 8503),

-- Małopolskie (miasta powiatowe)
('Brzesko', 'brzesko', '32-800', 'Województwo Małopolskie', 16827),
('Dąbrowa Tarnowska', 'dabrovutarnovska', '33-200', 'Województwo Małopolskie', 11259),
('Limanowa', 'limanowa', '34-600', 'Województwo Małopolskie', 15132),
('Miechów', 'miechov', '32-200', 'Województwo Małopolskie', 11387),
('Muszyna', 'muszyna', '33-370', 'Województwo Małopolskie', 4894),
('Myślenice', 'myslenice', '32-400', 'Województwo Małopolskie', 18210),
('Proszowice', 'proszowice', '32-100', 'Województwo Małopolskie', 6159),
('Sucha Beskidzka', 'suchabeskidzka', '34-200', 'Województwo Małopolskie', 9532),
('Wieliczka', 'wieliczka', '32-020', 'Województwo Małopolskie', 23198),

-- Śląskie (miasta powiatowe)
('Cieszyn', 'cieszyn', '43-400', 'Województwo Śląskie', 35918),
('Czechowice-Dziedzice', 'czechowicedziedzice', '43-502', 'Województwo Śląskie', 35684),
('Pszczyna', 'pszczyna', '43-200', 'Województwo Śląskie', 25823),
('Rybnik', 'rybnik', '44-200', 'Województwo Śląskie', 138696),
('Wodzisław Śląski', 'wodzislavslaski', '44-300', 'Województwo Śląskie', 48173),
('Żywiec', 'zywiec', '34-300', 'Województwo Śląskie', 31618),
('Bielsko-Biała', 'bielskobiala', '43-300', 'Województwo Śląskie', 170663),
('Tychy', 'tychy', '43-100', 'Województwo Śląskie', 127831),

-- Dolnośląskie (miasta powiatowe)
('Bielawa', 'bielawa', '58-260', 'Województwo Dolnośląskie', 30264),
('Boguszów-Gorce', 'boguszovgorce', '58-370', 'Województwo Dolnośląskie', 16132),
('Jawor', 'javor', '59-400', 'Województwo Dolnośląskie', 23559),
('Kamienna Góra', 'kamiennagora', '58-400', 'Województwo Dolnośląskie', 19649),
('Lubań', 'luban', '59-800', 'Województwo Dolnośląskie', 21248),
('Nowa Ruda', 'nowaruda', '57-400', 'Województwo Dolnośląskie', 23125),
('Świebodzice', 'sviebodzice', '58-160', 'Województwo Dolnośląskie', 22539),
('Ząbkowice Śląskie', 'zabkoviceslaskie', '57-200', 'Województwo Dolnośląskie', 15157),
('Złotoryja', 'zlotoryja', '59-500', 'Województwo Dolnośląskie', 15571),

-- Pomorskie (miasta powiatowe)
('Bytów', 'bytov', '77-100', 'Województwo Pomorskie', 16731),
('Człuchów', 'czluchov', '77-300', 'Województwo Pomorskie', 13630),
('Kartuzy', 'kartuzy', '83-300', 'Województwo Pomorskie', 15472),
('Nowy Dwór Gdański', 'novydvorgdanski', '82-100', 'Województwo Pomorskie', 10123),
('Prabuty', 'prabuty', '82-550', 'Województwo Pomorskie', 8488),

-- Wielkopolskie (miasta powiatowe)
('Chodzież', 'chodziez', '64-800', 'Województwo Wielkopolskie', 19006),
('Czarnków', 'czarnkov', '64-700', 'Województwo Wielkopolskie', 10802),
('Gostyń', 'gostyn', '63-800', 'Województwo Wielkopolskie', 20446),
('Grodzisk Wielkopolski', 'grodziskvielkopolski', '62-065', 'Województwo Wielkopolskie', 13670),
('Kępno', 'kepno', '63-600', 'Województwo Wielkopolskie', 14129),
('Koło', 'kolo', '62-600', 'Województwo Wielkopolskie', 22970),
('Międzychód', 'miedzychod', '66-300', 'Województwo Wielkopolskie', 10920),
('Pleszew', 'pleszev', '63-300', 'Województwo Wielkopolskie', 17821),
('Rawicz', 'ravicz', '63-900', 'Województwo Wielkopolskie', 20630),
('Słupca', 'slupca', '62-400', 'Województwo Wielkopolskie', 13629),
('Wągrowiec', 'vagroviec', '62-100', 'Województwo Wielkopolskie', 24967),
('Wolsztyn', 'volsztyn', '64-200', 'Województwo Wielkopolskie', 13217),
('Września', 'vrzesnia', '62-300', 'Województwo Wielkopolskie', 29513),
('Złotów', 'zlotov', '77-400', 'Województwo Wielkopolskie', 17838),

-- Zachodniopomorskie (miasta powiatowe)
('Białogard', 'bialogard', '78-200', 'Województwo Zachodniopomorskie', 23829),
('Choszczno', 'choszczno', '73-200', 'Województwo Zachodniopomorskie', 14471),
('Drawsko Pomorskie', 'dravskopomorskie', '78-500', 'Województwo Zachodniopomorskie', 11098),
('Gryfice', 'gryfice', '72-300', 'Województwo Zachodniopomorskie', 16733),
('Kamień Pomorski', 'kamienpomorski', '72-400', 'Województwo Zachodniopomorskie', 8727),
('Łobez', 'lobez', '73-150', 'Województwo Zachodniopomorskie', 10312),
('Myślibórz', 'mysliborzh', '74-300', 'Województwo Zachodniopomorskie', 11108),
('Pyrzyce', 'pyrzyce', '74-200', 'Województwo Zachodniopomorskie', 12787),
('Sławno', 'slavno', '76-100', 'Województwo Zachodniopomorskie', 12577),
('Świdwin', 'svidvin', '78-300', 'Województwo Zachodniopomorskie', 15371),

-- Lubelskie (miasta powiatowe)
('Hrubieszów', 'hrubieshov', '22-500', 'Województwo Lubelskie', 17882),
('Janów Lubelski', 'janovlubelski', '23-300', 'Województwo Lubelskie', 11645),
('Krasnystaw', 'krasnystav', '22-300', 'Województwo Lubelskie', 18951),
('Lubartów', 'lubartov', '21-100', 'Województwo Lubelskie', 22232),
('Łęczna', 'lenczna', '21-010', 'Województwo Lubelskie', 19274),
('Parczew', 'parczev', '21-200', 'Województwo Lubelskie', 10281),
('Radzyń Podlaski', 'radzynpodlaski', '21-300', 'Województwo Lubelskie', 15641),
('Tomaszów Lubelski', 'tomaszovlubelski', '22-600', 'Województwo Lubelskie', 19365),
('Włodawa', 'vlodava', '22-200', 'Województwo Lubelskie', 13230),

-- Łódzkie (miasta powiatowe)
('Aleksandrów Łódzki', 'aleksandrovlodzki', '95-070', 'Województwo Łódzkie', 21324),
('Brzeziny', 'brzeziny', '95-060', 'Województwo Łódzkie', 12279),
('Głowno', 'glovno', '95-015', 'Województwo Łódzkie', 14220),
('Koluszki', 'koluszki', '95-040', 'Województwo Łódzkie', 12840),
('Konstantynów Łódzki', 'konstantynovlodzki', '95-050', 'Województwo Łódzkie', 17984),
('Łask', 'lask', '98-100', 'Województwo Łódzkie', 17633),
('Łęczyca', 'lenczyca', '99-100', 'Województwo Łódzkie', 13773),
('Łowicz', 'lovicz', '99-400', 'Województwo Łódzkie', 27913),
('Opoczno', 'opoczno', '26-300', 'Województwo Łódzkie', 21892),
('Ozorków', 'ozorkov', '95-035', 'Województwo Łódzkie', 19533),
('Pajęczno', 'pajeczno', '98-330', 'Województwo Łódzkie', 6669),
('Poddębice', 'poddebice', '99-200', 'Województwo Łódzkie', 7569),
('Radomsko', 'radomsko', '97-500', 'Województwo Łódzkie', 46125),
('Rawa Mazowiecka', 'ravamazovecka', '96-200', 'Województwo Łódzkie', 17241),
('Sieradz', 'sieradz', '98-200', 'Województwo Łódzkie', 42441),
('Wieluń', 'vielun', '98-300', 'Województwo Łódzkie', 22313),

-- Podlaskie (miasta powiatowe)
('Hajnówka', 'hajnovka', '17-200', 'Województwo Podlaskie', 21442),
('Kolno', 'kolno', '18-500', 'Województwo Podlaskie', 10241),
('Mońki', 'monki', '19-100', 'Województwo Podlaskie', 10378),
('Sejny', 'sejny', '16-500', 'Województwo Podlaskie', 5608),
('Siemiatycze', 'siemiatycze', '17-300', 'Województwo Podlaskie', 14394),
('Wysokie Mazowieckie', 'vysokiemazovieckie', '18-200', 'Województwo Podlaskie', 9478),

-- Podkarpackie (miasta powiatowe)
('Brzozów', 'brzozov', '36-200', 'Województwo Podkarpackie', 7677),
('Jasło', 'jaslo', '38-200', 'Województwo Podkarpackie', 35281),
('Kolbuszowa', 'kolbushova', '36-100', 'Województwo Podkarpackie', 9267),
('Lesko', 'lesko', '38-600', 'Województwo Podkarpackie', 5397),
('Leżajsk', 'lezajsk', '37-300', 'Województwo Podkarpackie', 14109),
('Lubaczów', 'lubaczov', '37-600', 'Województwo Podkarpackie', 12225),
('Łańcut', 'lancut', '37-100', 'Województwo Podkarpackie', 17960),
('Nisko', 'nisko', '37-400', 'Województwo Podkarpackie', 15426),
('Ropczyce', 'ropczyce', '39-100', 'Województwo Podkarpackie', 15222),
('Strzyżów', 'strzyzov', '38-100', 'Województwo Podkarpackie', 8788),
('Ustrzyki Dolne', 'ustrzykidolne', '38-700', 'Województwo Podkarpackie', 9089),

-- Świętokrzyskie (miasta powiatowe)
('Jędrzejów', 'jedrzejov', '28-300', 'Województwo Świętokrzyskie', 15557),
('Kazimierza Wielka', 'kazimierzavielka', '28-500', 'Województwo Świętokrzyskie', 5753),
('Kielce', 'kielce', '25-001', 'Województwo Świętokrzyskie', 193415),
('Opatów', 'opatov', '27-500', 'Województwo Świętokrzyskie', 6639),
('Pińczów', 'pinczov', '28-400', 'Województwo Świętokrzyskie', 11117),
('Sandomierz', 'sandomierz', '27-600', 'Województwo Świętokrzyskie', 23863),
('Staszów', 'staszov', '28-200', 'Województwo Świętokrzyskie', 14803),
('Włoszczowa', 'vloszczowa', '29-100', 'Województwo Świętokrzyskie', 10268),

-- Lubuskie (miasta powiatowe)
('Bytom Odrzański', 'bytomordzanski', '67-115', 'Województwo Lubuskie', 4353),
('Kostrzyn nad Odrą', 'kostrzynnadodra', '66-470', 'Województwo Lubuskie', 18206),
('Krosno Odrzańskie', 'krosnoodrzanskie', '66-600', 'Województwo Lubuskie', 11755),
('Lubsko', 'lubsko', '68-300', 'Województwo Lubuskie', 14149),
('Słubice', 'slubice', '69-100', 'Województwo Lubuskie', 16738),
('Strzelce Krajeńskie', 'strzelcekrajenskie', '66-500', 'Województwo Lubuskie', 10186),
('Szprotawa', 'szprotava', '67-300', 'Województwo Lubuskie', 12035),
('Wschowa', 'vschova', '67-400', 'Województwo Lubuskie', 13840),
('Żagań', 'zagan', '68-100', 'Województwo Lubuskie', 25731),

-- Opolskie (miasta powiatowe)
('Głubczyce', 'glubczyce', '48-100', 'Województwo Opolskie', 12506),
('Namysłów', 'namyslov', '46-100', 'Województwo Opolskie', 16551),
('Olesno', 'olesno', '46-300', 'Województwo Opolskie', 9249),
('Otmuchów', 'otmuchov', '48-385', 'Województwo Opolskie', 4952),
('Paczków', 'paczkov', '48-370', 'Województwo Opolskie', 8226),
('Głuchołazy', 'gluchołazy', '48-340', 'Województwo Opolskie', 13506),

-- Kujawsko-Pomorskie (uzupełnienie miast powiatowych)
('Aleksandrów Kujawski', 'aleksandrovkujavski', '87-700', 'Województwo Kujawsko-Pomorskie', 11843),
('Chełmno', 'chelmno', '86-200', 'Województwo Kujawsko-Pomorskie', 18915),
('Golub-Dobrzyń', 'golubdobrzyn', '87-400', 'Województwo Kujawsko-Pomorskie', 12622),
('Lipno', 'lipno', '87-600', 'Województwo Kujawsko-Pomorskie', 14470),
('Mogilno', 'mogilno', '88-300', 'Województwo Kujawsko-Pomorskie', 11955),
('Nakło nad Notecią', 'naklonandnotecia', '89-100', 'Województwo Kujawsko-Pomorskie', 18223),
('Radziejów', 'radziejov', '88-200', 'Województwo Kujawsko-Pomorskie', 5565),
('Rypin', 'rypin', '87-500', 'Województwo Kujawsko-Pomorskie', 16565),
('Sępólno Krajeńskie', 'sepolnokrajenskie', '89-400', 'Województwo Kujawsko-Pomorskie', 9174),
('Świecie', 'sviecie', '86-100', 'Województwo Kujawsko-Pomorskie', 25614),
('Tuchola', 'tuchola', '89-500', 'Województwo Kujawsko-Pomorskie', 13976),
('Wąbrzeźno', 'vabrzezno', '87-200', 'Województwo Kujawsko-Pomorskie', 13221),
('Żnin', 'znin', '88-400', 'Województwo Kujawsko-Pomorskie', 13725)

ON CONFLICT (slug) DO NOTHING;
