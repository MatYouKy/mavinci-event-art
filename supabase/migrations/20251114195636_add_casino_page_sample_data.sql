/*
  # Przykładowe dane dla strony Kasyno

  1. Dane
    - Popup prawny
    - 3 stoły kasynowe
    - Zasady gier
    - Features (zaktualizowane, bez punktacji/nagród)
*/

-- 1. Popup prawny
INSERT INTO casino_legal_popup (content, is_active) VALUES (
  'Informujemy, że firma Mavinci Sp. z o.o. nie prowadzi gier losowych w rozumieniu ustawy o grach losowych, zakładach wzajemnych i grach na automatach z dnia 29 lipca 1992 roku (tekst jednolity Dz. U. z 1998 roku, Nr 102, poz. 650 z późniejszymi zmianami).

Nasza firma to profesjonalna agencja eventowa, w której stoły kasynowe stanowią formę rozrywki, a nie hazardu. Wszystkie gry prowadzone są wyłącznie w celach rozrywkowych podczas eventów firmowych i imprez okolicznościowych.',
  true
) ON CONFLICT DO NOTHING;

-- 2. Stoły kasynowe
INSERT INTO casino_tables (name, slug, description, image_url, order_index, is_visible) VALUES
(
  'Ruletka',
  'ruletka',
  'Klasyczna ruletka europejska z profesjonalnym stołem i doświadczonym krupierem. Poczuj emocje prawdziwego kasyna podczas obstawiania swojego szczęśliwego numeru. Stół z prawdziwym kołem ruletki, żetonami i elegancką oprawą wizualną.',
  'https://images.pexels.com/photos/7594303/pexels-photo-7594303.jpeg?auto=compress&cs=tinysrgb&w=1920',
  1,
  true
),
(
  'Blackjack',
  'blackjack',
  'Najpopularniejsza gra karciana w kasynach na całym świecie. Zmierz się z krupierem w walce o 21 punktów. Profesjonalny stół do blackjacka z miejscem dla 5-7 graczy, eleganckie karty i żetony oraz doświadczony krupier prowadzący rozgrywkę.',
  'https://images.pexels.com/photos/3846457/pexels-photo-3846457.jpeg?auto=compress&cs=tinysrgb&w=1920',
  2,
  true
),
(
  'Poker Texas Hold''em',
  'poker',
  'Najbardziej emocjonująca odmiana pokera. Sprawdź swoje umiejętności w blefowaniu i strategicznym myśleniu. Pełnowymiarowy stół do pokera, profesjonalne karty, żetony turniejowe i atmosfera prawdziwego pokera z krupierem prowadzącym rozdania.',
  'https://images.pexels.com/photos/269630/pexels-photo-269630.jpeg?auto=compress&cs=tinysrgb&w=1920',
  3,
  true
) ON CONFLICT (slug) DO NOTHING;

-- 3. Zasady gier
INSERT INTO casino_game_rules (game_name, slug, short_description, rules_content, order_index, is_visible) VALUES
(
  'Poker Texas Hold''em',
  'poker-texas-holdem',
  'Najbardziej popularna odmiana pokera, wymagająca strategii i psychologii',
  '## Podstawowe zasady

Texas Hold''em to odmiana pokera, w której każdy gracz otrzymuje 2 karty zakryte, a na stole odkrywane są 5 kart wspólnych.

### Przebieg gry

1. **Rozdanie kart** - każdy gracz otrzymuje 2 karty zakryte
2. **Pre-flop** - pierwsza runda licytacji
3. **Flop** - odkrycie 3 kart wspólnych, druga runda licytacji
4. **Turn** - odkrycie 4 karty wspólnej, trzecia runda licytacji
5. **River** - odkrycie 5 karty wspólnej, ostatnia runda licytacji
6. **Showdown** - porównanie układów kart

### Układy kart (od najsłabszego)

- **Wysoka karta** - brak układu
- **Para** - dwie karty tej samej wartości
- **Dwie pary**
- **Trójka** - trzy karty tej samej wartości
- **Strit** - pięć kart po kolei
- **Kolor** - pięć kart tego samego koloru
- **Full** - trójka + para
- **Kareta** - cztery karty tej samej wartości
- **Poker** - pięć kart po kolei tego samego koloru
- **Poker królewski** - 10, J, Q, K, A tego samego koloru',
  1,
  true
),
(
  'Ruletka',
  'ruletka',
  'Klasyczna gra losowa z obracającym się kołem i kulką',
  '## Podstawowe zasady

Ruletka to gra, w której gracze obstawiają, w którym polu zatrzyma się kulka na obracającym się kole.

### Rodzaje zakładów

**Zakłady wewnętrzne:**
- **Pojedyncza liczba** - 35:1
- **Dwie liczby** - 17:1
- **Trzy liczby** - 11:1
- **Cztery liczby** - 8:1
- **Sześć liczb** - 5:1

**Zakłady zewnętrzne:**
- **Czerwone/Czarne** - 1:1
- **Parzyste/Nieparzyste** - 1:1
- **1-18/19-36** - 1:1
- **Tuzin (1-12, 13-24, 25-36)** - 2:1
- **Kolumna** - 2:1

### Przebieg gry

1. Gracze składają zakłady na stole
2. Krupier krzyczy "Rien ne va plus" (koniec obstawiania)
3. Kulka jest wprawiana w ruch
4. Kulka zatrzymuje się w jednym z pól
5. Krupier wypłaca wygrane zgodnie z zakładami',
  2,
  true
),
(
  'Blackjack',
  'blackjack',
  'Gra karciana, w której celem jest uzyskanie 21 punktów lub jak najbliżej tej wartości',
  '## Podstawowe zasady

Blackjack to gra, w której celem jest pokonanie krupiera poprzez uzyskanie sumy kart bliższej 21, ale nie większej.

### Wartości kart

- **Figury (J, Q, K)** - 10 punktów
- **As** - 1 lub 11 punktów (do wyboru)
- **Pozostałe karty** - wartość nominalna

### Przebieg gry

1. **Rozdanie** - każdy gracz i krupier otrzymują 2 karty (jedna karta krupiera jest odkryta)
2. **Decyzje gracza:**
   - **Hit** - dobierz kartę
   - **Stand** - zatrzymaj się
   - **Double Down** - podwój stawkę i dobierz 1 kartę
   - **Split** - podziel parę na dwie ręce (jeśli masz dwie takie same karty)

3. **Ruch krupiera** - krupier dobiera karty do momentu uzyskania minimum 17 punktów

### Wygrana

- **Blackjack** (As + figura/10) - wygrana 3:2
- **Suma wyższa niż krupier** (ale ≤21) - wygrana 1:1
- **Przekroczenie 21** - przegrana
- **Remis** - zwrot stawki',
  3,
  true
) ON CONFLICT (slug) DO NOTHING;

-- 4. Features (zaktualizowane)
INSERT INTO casino_features (title, icon_name, order_index, is_visible) VALUES
('Profesjonalne stoły do gier', 'Dices', 1, true),
('Doświadczeni krupierzy', 'Users', 2, true),
('Żetony i karty do gier', 'Coins', 3, true),
('Ruletka, blackjack, poker', 'Spade', 4, true),
('Dekoracje tematyczne', 'Sparkles', 5, true),
('Pełna obsługa eventu', 'CheckCircle2', 6, true)
ON CONFLICT DO NOTHING;
