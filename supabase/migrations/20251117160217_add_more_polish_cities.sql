/*
  # Add More Polish Cities
  
  Dodanie większej liczby polskich miast, w tym Brodnica i inne średnie miasta.
*/

INSERT INTO polish_cities (name, slug, postal_code, region, population) VALUES
('Brodnica', 'brodnica', '87-300', 'Województwo Kujawsko-Pomorskie', 27900),
('Elbląg', 'elblag', '82-300', 'Województwo Warmińsko-Mazurskie', 119317),
('Włocławek', 'wloclawek', '87-800', 'Województwo Kujawsko-Pomorskie', 109883),
('Tarnów', 'tarnow', '33-100', 'Województwo Małopolskie', 107498),
('Chorzów', 'chorzow', '41-500', 'Województwo Śląskie', 107007),
('Kalisz', 'kalisz', '62-800', 'Województwo Wielkopolskie', 99106),
('Koszalin', 'koszalin', '75-001', 'Województwo Zachodniopomorskie', 107680),
('Legnica', 'legnica', '59-220', 'Województwo Dolnośląskie', 99350),
('Grudziądz', 'grudziadz', '86-300', 'Województwo Kujawsko-Pomorskie', 92552),
('Słupsk', 'slupsk', '76-200', 'Województwo Pomorskie', 90891),
('Jaworzno', 'jaworzno', '43-600', 'Województwo Śląskie', 90122),
('Jastrzębie-Zdrój', 'jastrzebiezdroj', '44-330', 'Województwo Śląskie', 88958),
('Nowy Sącz', 'nowysacz', '33-300', 'Województwo Małopolskie', 83116),
('Konin', 'konin', '62-500', 'Województwo Wielkopolskie', 72950),
('Piła', 'pila', '64-920', 'Województwo Wielkopolskie', 71846),
('Piotrków Trybunalski', 'piotrkow', '97-300', 'Województwo Łódzkie', 72843),
('Inowrocław', 'inowroclaw', '88-100', 'Województwo Kujawsko-Pomorskie', 71423),
('Lubin', 'lubin', '59-300', 'Województwo Dolnośląskie', 71189),
('Ostrów Wielkopolski', 'ostrowwielkopolski', '63-400', 'Województwo Wielkopolskie', 71398),
('Suwałki', 'suwalki', '16-400', 'Województwo Podlaskie', 69371),
('Stargard', 'stargard', '73-110', 'Województwo Zachodniopomorskie', 67293),
('Gniezno', 'gniezno', '62-200', 'Województwo Wielkopolskie', 66769),
('Siedlce', 'siedlce', '08-110', 'Województwo Mazowieckie', 77990),
('Pabianice', 'pabianice', '95-200', 'Województwo Łódzkie', 63888),
('Jelenia Góra', 'jeleniagoraPage', '58-500', 'Województwo Dolnośląskie', 79480),
('Wałbrzych', 'walbrzych', '58-300', 'Województwo Dolnośląskie', 110449),
('Ełk', 'elk', '19-300', 'Województwo Warmińsko-Mazurskie', 61677),
('Zamość', 'zamosc', '22-400', 'Województwo Lubelskie', 62401),
('Pruszków', 'pruszkow', '05-800', 'Województwo Mazowieckie', 60955),
('Chełm', 'chelm', '22-100', 'Województwo Lubelskie', 60231),
('Tczew', 'tczew', '83-110', 'Województwo Pomorskie', 59168),
('Starogard Gdański', 'starogardgdanski', '83-200', 'Województwo Pomorskie', 47778),
('Malbork', 'malbork', '82-200', 'Województwo Pomorskie', 38478),
('Sopot', 'sopot', '81-704', 'Województwo Pomorskie', 35719)
ON CONFLICT (slug) DO NOTHING;
