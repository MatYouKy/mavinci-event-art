-- Local conference content researched on 2026-09-29.
-- Existing entries (including later editorial changes) are intentionally preserved.
-- Venue examples are planning references, not claims of MAVINCI partnerships.
DO $migration$
DECLARE
  city_slug text;
  profile jsonb;
BEGIN
  FOR city_slug, profile IN SELECT key, value FROM jsonb_each($city_content$
{
  "gdansk": {
    "description": "Obsługa techniczna konferencji Gdańsk: Meyer Sound LINA, LED i streaming. MAVINCI dla firm, agencji i hoteli. Uzgodnimy technikę, montaż i realizację.",
    "content": {
      "version": 1,
      "heading": "Gdańsk: konferencja na sali i w transmisji",
      "intro": "W Gdańsku przygotujemy oprawę konferencji, panelu i gali: od nagłośnienia Meyer Sound LINA i ekranów LED po oświetlenie prelegentów oraz streaming. Agencjom i organizatorom zapewniamy własne urządzenia i zespół realizacyjny.",
      "planning": "Zacznijmy od programu i wyposażenia obiektu. Przy panelu z gościem online potrzebne są osobne połączenia dźwięku dla sali i prelegenta, a prezentacje muszą pozostać czytelne także w transmisji. Uzgodnimy z gospodarzem montaż, próbę kamerową oraz podział odpowiedzialności za technikę.",
      "checks": [
        "Przekaż listę prelegentów na miejscu i online.",
        "Ustalmy obraz dla sali, transmisji i nagrania.",
        "Zarezerwuj czas dostępu do sali na montaż oraz próby."
      ],
      "venue": {
        "name": "Europejskie Centrum Solidarności w Gdańsku",
        "fact": "ECS publikuje wyposażenie sal, w tym nagłośnienie i projekcję w Audytorium. Warto porównać ten zakres z potrzebami transmisji i ustalić dodatkową obsługę oraz godziny montażu.",
        "url": "https://ecs.gda.pl/wp-content/uploads/2026/05/Zasady-wynajmu-pomieszczen-i-wspolorganizacji-wydarzen-w-ECS-2026.pdf"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy w Gdańsku możecie uzupełnić technikę dostępną w obiekcie?",
        "answer": "Tak. Możesz zamówić streaming, ekran LED lub realizatorów do uzgodnionego zakresu. Najpierw porównujemy wyposażenie sali z programem i ustalamy warunki podłączenia z technikiem obiektu."
      },
      {
        "question": "Jak przygotować panel z prelegentem online?",
        "answer": "Potrzebujemy platformy połączenia, planu prezentacji i zasad pytań z sali. Przed wydarzeniem ustalamy łącze z obiektem i planujemy próbę połączenia, odsłuchu oraz obrazu z udziałem prelegenta."
      }
    ]
  },
  "gdynia": {
    "description": "Konferencje Gdynia: technika sceny głównej i sesji równoległych. MAVINCI — Meyer Sound, ekrany LED, realizacja prezentacji i streaming. Zapytaj o zakres.",
    "content": {
      "version": 1,
      "heading": "Gdynia: scena główna i sesje równoległe",
      "intro": "Planujesz konferencję w Gdyni z wykładami i warsztatami? Połączymy obsługę prezentacji, nagłośnienie, LED oraz transmisję ze wspólnym harmonogramem pracy realizatorów.",
      "planning": "Kilka sal oznacza kilka równoległych programów. Rozpisujemy mikrofony, źródła obrazu i obsadę każdej przestrzeni, a nagrania przypisujemy do konkretnych sesji. Dzięki temu organizator może zlecić całą technikę lub tylko scenę główną i streaming.",
      "checks": [
        "Prześlij plan sal z godzinami równoległych wystąpień.",
        "Oznacz sesje wymagające nagrania i transmisji.",
        "Ustalmy osobę przekazującą zmiany programu realizatorom."
      ],
      "venue": {
        "name": "Centrum Konferencyjne PPNT Gdynia",
        "fact": "PPNT oferuje audytorium i mniejsze sale spotkań. Taki układ pozwala rozważyć sesję plenarną oraz warsztaty; zakres techniki trzeba ustalić oddzielnie dla wybranych pomieszczeń.",
        "url": "https://ppnt.pl/centrum-konferencyjne-ppnt/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy możecie obsłużyć kilka sal konferencyjnych w Gdyni?",
        "answer": "Tak, zakres zespołu i urządzeń dobieramy do liczby jednoczesnych sesji. Potrzebujemy agendy z godzinami, planów sal oraz informacji, gdzie mają powstać nagrania."
      },
      {
        "question": "Czy warsztaty muszą korzystać z tego samego nagłośnienia co scena główna?",
        "answer": "Nie. Mała sala warsztatowa może wymagać innego zestawu niż duża sesja plenarna. Dobieramy technikę do sposobu pracy uczestników i sprawdzamy, co zapewnia obiekt."
      }
    ]
  },
  "sopot": {
    "description": "Obsługa konferencji i gal w Sopocie. MAVINCI: Meyer Sound, LED, światło i streaming. Zaplanuj z nami przejście od prezentacji do wieczornego bankietu.",
    "content": {
      "version": 1,
      "heading": "Sopot: od konferencji do wieczornej gali",
      "intro": "W Sopocie łączymy technikę konferencji z oprawą gali i bankietu. Własne nagłośnienie, ekrany LED, światło oraz realizacja obrazu pozwalają przygotować oba etapy w jednym planie.",
      "planning": "Przy zmianie układu sali z teatralnego na bankietowy kluczowe są pozycje ekranów, mikrofonów i stanowisk realizacyjnych. Ustalamy, co pozostaje na miejscu, ile czasu zajmuje przebudowa i kiedy artyści mogą przeprowadzić próbę.",
      "checks": [
        "Uwzględnij przerwę na zmianę ustawienia sali.",
        "Przekaż program gali i wymagania artystów.",
        "Sprawdźmy widoczność obrazu przy świetle dziennym i wieczorem."
      ],
      "venue": {
        "name": "Centrum konferencyjne Radisson Blu Sopot",
        "fact": "Obiekt opisuje modułowe sale oraz przestrzenie wydarzeń wewnątrz i na zewnątrz. Przy wyborze kilku stref warto osobno zaplanować technikę konferencji, bankietu i części plenerowej.",
        "url": "https://www.radissonblusopot.pl/konferencje-i-wydarzenia/centrum-konferencyjne"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy ten sam ekran LED może obsłużyć konferencję i galę w Sopocie?",
        "answer": "Tak, jeżeli jego położenie i parametry pasują do obu ustawień publiczności. Wcześniej przygotowujemy formaty prezentacji, plansze nagród i materiały wieczorne."
      },
      {
        "question": "Co ustalić, jeśli część wydarzenia odbywa się na zewnątrz?",
        "answer": "Potrzebny jest osobny plan zasilania, ochrony urządzeń i przeniesienia programu do wnętrza przy złej pogodzie. Warunki uzgadniamy z wybranym obiektem."
      }
    ]
  },
  "olsztyn": {
    "description": "Obsługa konferencji Olsztyn. Własny Meyer Sound LINA, LED i streaming MAVINCI. Zobacz realizację PSRWN w Hotelu Przystań i zapytaj o technikę wydarzenia.",
    "content": {
      "version": 1,
      "heading": "Olsztyn: własne zaplecze i sprawdzona realizacja",
      "intro": "W Olsztynie mamy biuro, magazyn i własny park urządzeń. Obsługujemy konferencje, gale oraz spotkania hybrydowe, łącząc Meyer Sound LINA, ekrany LED, oświetlenie i streaming z pracą realizatorów.",
      "planning": "Przykładem naszej pracy jest dwudniowa konferencja PSRWN w Hotelu Przystań: obsługa multimedialna, nagłośnienie, światło i streaming, a wieczorem także nagłośnienie bankietu z zespołem TRIO. Podobny podział dnia warto uwzględnić już w briefie.",
      "checks": [
        "Połącz program konferencji i bankietu w jednym harmonogramie.",
        "Określ liczbę sal oraz prelegentów online.",
        "Prześlij plan ustawienia publiczności i sceny."
      ],
      "venue": {
        "name": "Przystań Hotel & Restaurants w Olsztynie",
        "fact": "Obiekt udostępnia kilka przestrzeni konferencyjnych o różnej wielkości. Przy sesjach równoległych warto przypisać wyposażenie i obsługę do każdej z wybranych sal.",
        "url": "https://www.przystanmice.com/sale-konferencyjne"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Gdzie znajduje się zaplecze techniczne MAVINCI w Olsztynie?",
        "answer": "Biuro i magazyn znajdują się przy ul. Towarowej 20B. Dojazd do konkretnego budynku wskazuje mapa w sekcji kontaktowej. Z tej bazy przygotowujemy urządzenia do wydarzeń."
      },
      {
        "question": "Czy mogę zobaczyć konferencję zrealizowaną przez MAVINCI w Olsztynie?",
        "answer": "Tak. W portfolio pokazujemy konferencję PSRWN w Hotelu Przystań, obejmującą oprawę techniczną i streaming oraz obsługę wieczornego bankietu. Link do realizacji znajdziesz w tej sekcji."
      }
    ]
  },
  "ostroda": {
    "description": "Konferencje Ostróda i okolice: nagłośnienie Meyer Sound, LED, światło i streaming MAVINCI. Technika spotkania, bankietu i integracji w jednym planie.",
    "content": {
      "version": 1,
      "heading": "Ostróda: konferencja z bankietem i integracją",
      "intro": "Przygotujemy technikę konferencji w Ostródzie i okolicznych hotelach: nagłośnienie, ekran LED, prezentacje oraz streaming. Program biznesowy możemy połączyć z oprawą wieczoru integracyjnego.",
      "planning": "Jeżeli wydarzenie przenosi się z sali do strefy plenerowej, ustalamy dwa miejsca pracy i moment przejścia uczestników. Nie zakładamy, że sprzęt można przenieść w krótkiej przerwie. W ofercie rozdzielamy technikę, montaż, realizację i transport.",
      "checks": [
        "Podaj dokładny obiekt, także gdy znajduje się poza Ostródą.",
        "Zaznacz części programu odbywające się równocześnie.",
        "Ustalmy wariant wewnętrzny dla programu plenerowego."
      ],
      "venue": {
        "name": "Hotel Anders w Starych Jabłonkach koło Ostródy",
        "fact": "Anders łączy sale konferencyjne z przestrzeniami wydarzeń na zewnątrz. To przykład obiektu w okolicy Ostródy, dla którego warto rozpisać oddzielną obsługę części salowej i plenerowej.",
        "url": "https://www.hotelanders.pl/dla-firm/konferencje-mazury"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy dojeżdżacie do hoteli poza Ostródą?",
        "answer": "Tak. Obsługujemy Ostródę i okolice z zaplecza w Olsztynie. Dokładny adres, godziny dostępu i zakres urządzeń pozwalają wycenić transport oraz montaż."
      },
      {
        "question": "Jak połączyć konferencję z integracją bez długiej przerwy technicznej?",
        "answer": "Najpierw sprawdzamy, czy obie części odbywają się w tej samej sali. Jeśli są w różnych miejscach lub nakładają się godzinowo, planujemy osobne stanowiska i potrzebną obsadę."
      }
    ]
  },
  "ilawa": {
    "description": "Techniczna obsługa konferencji w Iławie: Meyer Sound, ekrany LED i streaming. MAVINCI przygotuje prezentacje, światło sceny oraz oprawę gali firmowej.",
    "content": {
      "version": 1,
      "heading": "Iława: prezentacja produktu i gala firmowa",
      "intro": "Konferencja w Iławie może połączyć prezentację produktu, spotkanie partnerów i galę. Dobierzemy nagłośnienie, LED, światło oraz realizację kamerową do tego, co uczestnicy mają zobaczyć i usłyszeć.",
      "planning": "Przy ekspozycji produktu planujemy nie tylko scenę, lecz także drogę wniesienia eksponatu i kadry kamer. Wielkość ekranu musi uwzględniać odległość od pierwszego rzędu oraz miejsce dla publiczności. Materiały wizualne uzgadniamy przed montażem.",
      "checks": [
        "Przekaż wymiary eksponatu oraz plan jego prezentacji.",
        "Ustalmy format slajdów i materiałów na LED.",
        "Zostaw czas na próbę odsłonięcia produktu lub wręczenia nagród."
      ],
      "venue": {
        "name": "GrandHotel Tiffi w Iławie",
        "fact": "Hotel opisuje sale bez filarów i możliwość wprowadzenia dużych elementów ekspozycji. Przy pokazie produktu trzeba potwierdzić z obiektem jego wymiary, trasę transportu i docelowe ustawienie.",
        "url": "https://grandhotel.tiffi.com/eventy/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy ekran LED sprawdzi się przy prezentacji produktu w Iławie?",
        "answer": "Tak, dobieramy go do rodzaju materiału i odległości publiczności. Przed wyborem wielkości sprawdzamy plan sali oraz ilość miejsca zajmowaną przez ekspozycję."
      },
      {
        "question": "Czy możecie przygotować konferencję i oprawę wręczenia nagród?",
        "answer": "Tak. Rozpisujemy kolejność wejść, mikrofony, plansze na ekran i akcenty świetlne. Próba prowadzącego pozwala połączyć te elementy w spójny przebieg gali."
      }
    ]
  },
  "gizycko": {
    "description": "Konferencje Giżycko: nagłośnienie, LED i streaming MAVINCI. Zaplanuj technikę spotkania hotelowego, bankietu i programu nad jeziorem.",
    "content": {
      "version": 1,
      "heading": "Giżycko: konferencja w hotelu i program nad jeziorem",
      "intro": "W Giżycku zapewnimy oprawę techniczną konferencji i wieczornego spotkania. Własny Meyer Sound LINA, LED i realizację transmisji dobieramy do sali oraz charakteru programu.",
      "planning": "Przy wydarzeniu w historycznym wnętrzu ustalamy z gospodarzem sposób prowadzenia przewodów i ustawienie urządzeń. Gdy program obejmuje teren nad wodą, planujemy osobną strefę techniczną, zasilanie i wariant na zmianę pogody.",
      "checks": [
        "Przekaż plan sali i zasady montażu obowiązujące w obiekcie.",
        "Wskaż, które wystąpienia wymagają transmisji.",
        "Rozdziel godziny konferencji, bankietu i części zewnętrznej."
      ],
      "venue": {
        "name": "Hotel St. Bruno w Giżycku",
        "fact": "Hotel w zabytkowym zamku oferuje sale konferencyjne oraz programy integracyjne. Przy łączeniu spotkania z aktywnościami poza salą warto określić, gdzie rzeczywiście potrzebna jest technika.",
        "url": "https://www.hotelstbruno.pl/konferencje/integracje/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy realizujecie konferencje w zabytkowych obiektach w Giżycku?",
        "answer": "Możemy przygotować taki zakres po uzgodnieniu zasad montażu z obiektem. Sposób ustawienia nagłośnienia, ekranów i kabli musi uwzględniać wnętrze oraz ruch gości."
      },
      {
        "question": "Czy do programu nad jeziorem potrzebny jest osobny zestaw?",
        "answer": "Zależy to od odległości między strefami i harmonogramu. Jeżeli część salowa trwa równocześnie, planujemy niezależne stanowisko; dla pleneru uzgadniamy również zasilanie i zabezpieczenie przed pogodą."
      }
    ]
  },
  "elk": {
    "description": "Obsługa konferencji i szkoleń Ełk. MAVINCI: mikrofony, prezentacje, LED i streaming. Przygotujemy nagranie wykładów i udział prelegentów online.",
    "content": {
      "version": 1,
      "heading": "Ełk: szkolenie, pokaz i udział prelegentów online",
      "intro": "W Ełku obsługujemy technikę konferencji, szkoleń i prezentacji. Możesz zamówić nagłośnienie, ekran LED i światło lub uzupełnić salę o realizację obrazu oraz streaming.",
      "planning": "Przy szkoleniu technicznym ważna jest czytelność szczegółów: slajdu, demonstracji czy interfejsu aplikacji. Ustalamy, co trafia na ekran sali, a co do nagrania. Dla prelegenta online planujemy odsłuch oraz przekazywanie pytań od uczestników.",
      "checks": [
        "Prześlij przykładowy slajd lub opis demonstracji.",
        "Określ, czy nagrywamy także pytania z sali.",
        "Uzgodnijmy z obiektem łącze i próbę transmisji."
      ],
      "venue": {
        "name": "Park Naukowo-Technologiczny w Ełku",
        "fact": "Park oferuje przestrzenie konferencyjne, szkoleniowe i spotkań biznesowych. Zakres dodatkowej techniki warto dobrać do wybranej sali i tego, czy spotkanie ma być transmitowane.",
        "url": "https://technopark.elk.pl/oferta/konferencje-i-szkolenia-3/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy można nagrać szkolenie w Ełku wraz z prezentacją?",
        "answer": "Tak. Ustalamy, czy zapis ma zawierać obraz prelegenta, slajdy, demonstrację i dyskusję. Sposób przekazania nagrania oraz ewentualny montaż określamy w ofercie."
      },
      {
        "question": "Czy hotelowe Wi-Fi wystarczy do streamingu?",
        "answer": "Nie zakładamy tego bez sprawdzenia. Potwierdzamy parametry i dostępność łącza z obiektem oraz planujemy test. Ewentualne połączenie zapasowe ustalamy jako element zakresu."
      }
    ]
  },
  "ketrzyn": {
    "description": "Techniczna obsługa konferencji Kętrzyn. MAVINCI dobierze nagłośnienie, obraz i streaming do szkolenia, panelu lub gali. Własny sprzęt i realizatorzy.",
    "content": {
      "version": 1,
      "heading": "Kętrzyn: technika dobrana do skali spotkania",
      "intro": "W Kętrzynie przygotujemy zarówno kameralne szkolenie, jak i oprawę większej konferencji. Zakres mikrofonów, obrazu, oświetlenia i streamingu dobieramy do sali oraz liczby uczestników.",
      "planning": "Przy spotkaniu przy wspólnym stole ważniejsza od rozbudowanej sceny jest czytelna rozmowa i obraz dokumentów. Większe wydarzenie może wymagać dodatkowego nagłośnienia i LED. Wycena zaczyna się od ustawienia publiczności i wyposażenia dostępnego na miejscu.",
      "checks": [
        "Wskaż układ: wspólny stół, szkolny lub teatralny.",
        "Określ liczbę osób uczestniczących online.",
        "Sprawdźmy drogę wniesienia urządzeń do wybranej sali."
      ],
      "venue": {
        "name": "Sala konferencyjna KOMEC w Kętrzynie",
        "fact": "KOMEC udostępnia salę szkoleniowo-konferencyjną przy ul. Dworcowej 6, na piętrze budynku, z wyposażeniem audiowizualnym. To przykład kameralnego spotkania wymagającego dopasowanego zakresu techniki.",
        "url": "https://komecketrzyn.pl/wynajem-sali-konferencyjnej/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy do małej konferencji w Kętrzynie potrzebny jest duży system nagłośnienia?",
        "answer": "Nie zawsze. Dobór zależy od układu sali, liczby uczestników i sposobu prowadzenia spotkania. Własny Meyer Sound LINA wykorzystujemy tam, gdzie odpowiada potrzebom wydarzenia."
      },
      {
        "question": "Czy możecie zapewnić tylko obsługę prezentacji i nagranie?",
        "answer": "Tak. Jeśli wyposażenie sali spełnia wymagania, możemy uzupełnić je o realizatora, kamery i odpowiednie połączenia. Zakres uzgadniamy z organizatorem i gospodarzem."
      }
    ]
  },
  "szczytno": {
    "description": "Konferencje Szczytno: mikrofony, multimedia, LED i streaming MAVINCI. Obsługa szkolenia, panelu dyskusyjnego i spotkania firmowego z własną techniką.",
    "content": {
      "version": 1,
      "heading": "Szczytno: szkolenie i panel z pytaniami od publiczności",
      "intro": "Dla konferencji w Szczytnie dobierzemy technikę do wystąpień, dyskusji i prezentacji. Zapewniamy własne nagłośnienie, multimedia, oświetlenie oraz streaming z obsługą realizatorów.",
      "planning": "Panel dyskusyjny wymaga rozpisania mikrofonów dla moderatora, gości i publiczności. Jeśli powstaje nagranie, pytania z sali także muszą być słyszalne. Ustalamy ustawienie prowadzących, widoczność ekranu oraz sposób przekazywania prezentacji.",
      "checks": [
        "Przekaż liczbę jednocześnie występujących panelistów.",
        "Zaplanuj mikrofon do pytań uczestników.",
        "Sprawdźmy czytelność prezentacji z ostatniego rzędu."
      ],
      "venue": {
        "name": "Hotel Krystyna w Szczytnie",
        "fact": "Hotel przedstawia salę konferencyjną i przestrzeń spotkań. Przed wyborem techniki warto uzgodnić konkretną salę, układ krzeseł oraz wyposażenie zawarte w najmie.",
        "url": "https://hotelkrystyna.pl/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Jak dobrać mikrofony do panelu w Szczytnie?",
        "answer": "Potrzebujemy liczby panelistów, sposobu prowadzenia dyskusji i informacji o pytaniach publiczności. Uwzględniamy także dźwięk dla transmisji, jeśli spotkanie ma odbiorców online."
      },
      {
        "question": "Czy można połączyć szkolenie z wieczornym spotkaniem firmowym?",
        "answer": "Tak. Ustalamy zmianę ustawienia sali, potrzebne światło oraz program muzyczny lub artystyczny. Czas przebudowy uwzględniamy w harmonogramie wydarzenia."
      }
    ]
  },
  "mragowo": {
    "description": "Konferencje i gale Mrągowo. MAVINCI zapewnia Meyer Sound, LED, światło oraz streaming. Jeden harmonogram prezentacji, wręczenia nagród i części muzycznej.",
    "content": {
      "version": 1,
      "heading": "Mrągowo: konferencja, nagrody i wieczór firmowy",
      "intro": "W Mrągowie połączymy oprawę konferencji z realizacją gali i integracji. Własne nagłośnienie, LED, światło i streaming pozwalają przygotować technikę do kolejnych punktów programu.",
      "planning": "Przy gali liczy się kolejność wejść, nazwiska laureatów, plansze ekranowe i akcenty muzyczne. Uzgadniamy te elementy z prowadzącym przed próbą. Jeśli konferencja zajmuje kilka sal, rozdzielamy obsługę prezentacji od przygotowania wieczoru.",
      "checks": [
        "Zbierz finalne plansze nagród i kolejność wejść.",
        "Ustal czas próby prowadzącego i artystów.",
        "Wskaż sale używane jednocześnie oraz moment rozpoczęcia bankietu."
      ],
      "venue": {
        "name": "Mrągowo Resort & Spa",
        "fact": "Hotel nad jeziorem Czos oferuje sale konferencyjne i zaplecze do integracji. Przy programie obejmującym szkolenia i bankiet warto określić, które przestrzenie będą działały równocześnie.",
        "url": "https://mragoworesort.pl/konferencje/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy możecie obsłużyć galę po konferencji w Mrągowie?",
        "answer": "Tak. Łączymy mikrofony, prezentacje, materiały wideo i oświetlenie z harmonogramem gali. Wcześniej ustalamy, czy sala wymaga przebudowy i kiedy odbędzie się próba."
      },
      {
        "question": "Kiedy przekazać materiały na ekran LED?",
        "answer": "Termin ustalamy przy planowaniu realizacji, tak aby sprawdzić format, proporcje i kolejność plików przed próbą. Lista laureatów i finalne plansze powinny mieć wskazaną osobę zatwierdzającą."
      }
    ]
  },
  "mikolajki": {
    "description": "Obsługa konferencji Mikołajki: własny Meyer Sound LINA, ekrany LED, streaming i światło. MAVINCI przygotuje technikę sesji plenarnych i bankietu.",
    "content": {
      "version": 1,
      "heading": "Mikołajki: hotelowa konferencja w kilku etapach",
      "intro": "W Mikołajkach obsługujemy konferencje hotelowe, spotkania partnerów i gale. Dostarczamy Meyer Sound LINA, LED, oświetlenie oraz realizację obrazu i transmisji.",
      "planning": "Przy większym spotkaniu hotelowym plan sal jest równie ważny jak agenda. Ustalamy trasy transportu urządzeń, dostęp do montażu i miejsce stanowiska realizatorów. Osobno opisujemy sesję plenarną, warsztaty i bankiet, aby sprzęt był gotowy przed wejściem uczestników.",
      "checks": [
        "Przekaż nazwy zarezerwowanych sal i ich rzuty.",
        "Uzgodnij z hotelem godziny montażu oraz demontażu.",
        "Określ, które sesje mają być nagrywane."
      ],
      "venue": {
        "name": "Hotel Gołębiewski w Mikołajkach",
        "fact": "Hotel udostępnia zaplecze do konferencji, kongresów i integracji. Przy wyborze sal warto sprawdzić ich aktualną konfigurację i zakres wyposażenia oferowanego w ramach rezerwacji.",
        "url": "https://www.golebiewski.pl/mikolajki/biznes"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy można zamówić tylko LED i streaming do konferencji w Mikołajkach?",
        "answer": "Tak. Możemy uzupełnić nagłośnienie lub multimedia hotelu o wybrany zakres. Wymaga to uzgodnienia połączeń sygnałowych, miejsc kamer i obowiązków poszczególnych ekip."
      },
      {
        "question": "Jak ustalić montaż przed poranną konferencją?",
        "answer": "Najpierw potwierdzamy dostęp do sali z hotelem. Wielkość instalacji i potrzebne próby określają, czy montaż powinien rozpocząć się poprzedniego dnia. Termin ujmujemy w ofercie."
      }
    ]
  },
  "elblag": {
    "description": "Konferencje Elbląg — nagłośnienie, LED i transmisje hybrydowe MAVINCI. Obsługa prezentacji, zdalnych prelegentów oraz pytań uczestników na sali i online.",
    "content": {
      "version": 1,
      "heading": "Elbląg: konferencja hybrydowa z aktywną dyskusją",
      "intro": "Przygotujemy technikę konferencji w Elblągu dla uczestników na miejscu i online. Łączymy nagłośnienie, multimedia i światło z realizacją kamerową oraz obsługą transmisji.",
      "planning": "Wydarzenie hybrydowe wymaga ustalenia, kto zabiera głos i jak moderator otrzymuje pytania. Rozdzielamy dźwięk sali i połączenia zdalnego, dobieramy widoki prezentacji oraz planujemy próbę internetową. Wyposażenie obiektu włączamy do planu po potwierdzeniu warunków technicznych.",
      "checks": [
        "Określ formę udziału online: oglądanie czy aktywna dyskusja.",
        "Przekaż program wystąpień zdalnych.",
        "Ustalmy sposób nagrania i przekazania materiałów."
      ],
      "venue": {
        "name": "Elbląski Park Technologiczny",
        "fact": "EPT oferuje sale konferencyjne i szkoleniowe z wyposażeniem multimedialnym. Przed zamówieniem transmisji warto ustalić, jakie urządzenia i połączenia można wykorzystać w wybranej sali.",
        "url": "https://ept.elblag.eu/sale-konferencyjne-i-szkoleniowe.html"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy uczestnicy online mogą zadawać pytania podczas konferencji w Elblągu?",
        "answer": "Tak, jeżeli przewiduje to wybrana platforma i scenariusz. Ustalamy rolę moderatora, sposób przekazania pytań i potrzebne mikrofony oraz odsłuchy."
      },
      {
        "question": "Czy realizujecie transmisję z użyciem wyposażenia sali?",
        "answer": "Tak, po uzgodnieniu dostępnych wyjść obrazu i dźwięku oraz warunków obsługi. Ewentualne brakujące urządzenia i realizatorów uwzględniamy w naszym zakresie."
      }
    ]
  },
  "nidzica": {
    "description": "Obsługa konferencji Nidzica: nagłośnienie, prezentacje, LED i streaming MAVINCI. Technika spotkań biznesowych z uwzględnieniem warunków wybranego obiektu.",
    "content": {
      "version": 1,
      "heading": "Nidzica: biznesowe spotkanie w charakterystycznym wnętrzu",
      "intro": "W Nidzicy przygotujemy nagłośnienie, multimedia i realizację konferencji. Własny sprzęt pozwala dobrać zakres do kameralnej prezentacji, panelu lub wieczornego spotkania.",
      "planning": "W historycznym obiekcie plan techniczny zaczynamy od miejsca sceny, dostępnych dróg transportu i zasad montażu. Sprawdzamy widoczność prezentacji oraz warunki prowadzenia rozmowy. Streaming wymaga dodatkowo ustalenia położenia kamer i łącza.",
      "checks": [
        "Prześlij zdjęcia sali i jej aktualny rzut.",
        "Uzgodnijmy ustawienie urządzeń oraz prowadzenie przewodów.",
        "Przewidź próbę mowy i prezentacji przed wejściem gości."
      ],
      "venue": {
        "name": "Zamek w Nidzicy",
        "fact": "Oficjalna strona zamku przedstawia ofertę spotkań biznesowych i konferencji. Szczegóły dostępnej sali, wyposażenia i warunków montażu należy potwierdzić dla konkretnego wydarzenia.",
        "url": "https://zamek-nidzica.pl/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy ekran LED można ustawić w zabytkowej sali w Nidzicy?",
        "answer": "Możliwość zależy od wymiarów wnętrza, drogi transportu, zasilania i zgody zarządcy. Przed wyborem konfiguracji ustalamy te warunki; nie każda sala wymaga dużego ekranu."
      },
      {
        "question": "Jak przygotować nagłośnienie przemówień w takim wnętrzu?",
        "answer": "Dobieramy mikrofony i pozycje głośników do publiczności oraz warunków sali. Próba pozwala sprawdzić czytelność mowy i dopasować ustawienia przed rozpoczęciem spotkania."
      }
    ]
  },
  "wejherowo": {
    "description": "Techniczna obsługa konferencji Wejherowo. MAVINCI: dźwięk, LED, światło i streaming. Przygotowanie sceny, prezentacji oraz nagrania wydarzenia.",
    "content": {
      "version": 1,
      "heading": "Wejherowo: konferencja na scenie audytoryjnej",
      "intro": "W Wejherowie przygotujemy oprawę konferencji, panelu i gali na scenie. Zapewniamy własny sprzęt oraz realizatorów dźwięku, obrazu i światła, także dla wydarzeń transmitowanych.",
      "planning": "W sali z widownią audytoryjną ustalamy widoczność slajdów z różnych rzędów, ustawienie panelistów i pozycje kamer. Jeżeli foyer służy partnerom lub rejestracji, jego potrzeby multimedialne opisujemy oddzielnie. Harmonogram prób uzgadniamy z techniką obiektu.",
      "checks": [
        "Przekaż scenariusz wejść na scenę i ustawienie panelu.",
        "Ustalmy kadry kamer bez zasłaniania widowni.",
        "Wskaż potrzebne ekrany w foyer i strefie partnerów."
      ],
      "venue": {
        "name": "Filharmonia Kaszubska — Wejherowskie Centrum Kultury",
        "fact": "WCK opisuje salę wielofunkcyjną, galerię i salę konferencyjną. Wybór tych przestrzeni wpływa na podział obsługi między sceną, spotkaniami i strefami towarzyszącymi.",
        "url": "https://wck.org.pl/nasz-obiekt/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy możecie współpracować z techniką obiektu w Wejherowie?",
        "answer": "Tak. Ustalamy wspólny plan połączeń, zakres urządzeń gospodarza i zadania naszej ekipy. W ofercie wskazujemy, za które elementy odpowiada MAVINCI."
      },
      {
        "question": "Jak przygotować panel do nagrania w audytorium?",
        "answer": "Potrzebujemy planu ustawienia rozmówców i kolejności wypowiedzi. Dobieramy mikrofony, oświetlenie twarzy i pozycje kamer, uwzględniając widoczność sceny dla publiczności."
      }
    ]
  },
  "koscierzyna": {
    "description": "Konferencje Kościerzyna: obsługa prezentacji, nagłośnienie i streaming MAVINCI. Dobierzemy technikę do szkolenia hotelowego lub spotkania firmowego.",
    "content": {
      "version": 1,
      "heading": "Kościerzyna: szkolenie hotelowe z dobraną techniką",
      "intro": "Konferencję w Kościerzynie możemy obsłużyć kompleksowo lub uzupełnić wyposażenie hotelu o transmisję, kamery i realizatorów. Dobór sprzętu zaczynamy od programu spotkania.",
      "planning": "Przy szkoleniu w mniejszej sali sprawdzamy przede wszystkim czytelność slajdów i głosu prowadzącego. Kamera pokazująca ćwiczenie może być ważniejsza niż rozbudowana scena. Wspólnie ustalamy zakres nagrania, sposób pytań i potrzebę dodatkowego ekranu.",
      "checks": [
        "Określ, czy uczestnicy pracują przy stołach czy oglądają wykład.",
        "Przekaż materiały wymagające pokazania szczegółów.",
        "Ustalmy, które urządzenia udostępnia hotel."
      ],
      "venue": {
        "name": "Hotel Bazuny w Kościerzynie",
        "fact": "Hotel opisuje sale Miedzianą i Srebrną oraz dostępne nagłośnienie i projekcję. Dodatkową realizację obrazu lub streaming warto dopasować do konkretnej sali i formy szkolenia.",
        "url": "https://www.hotelbazuny.pl/konferencje/sale-konferencyjne"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy do szkolenia w Kościerzynie mogę zamówić sam streaming?",
        "answer": "Tak. Po sprawdzeniu wyposażenia sali uzgadniamy kamery, dźwięk, prezentacje oraz łącze. Oferta obejmie potrzebne urządzenia i obsługę transmisji."
      },
      {
        "question": "Czy wykorzystacie projektor dostępny w hotelu?",
        "answer": "Możemy go wykorzystać, jeśli jego parametry, połączenia i położenie odpowiadają programowi. Ekran LED proponujemy wtedy, gdy uzasadniają go warunki i oczekiwany efekt."
      }
    ]
  },
  "bytow": {
    "description": "Technika konferencji Bytów: dźwięk, ekrany, światło i streaming MAVINCI. Przygotujemy prezentacje oraz widoczność sceny dla uczestników spotkania.",
    "content": {
      "version": 1,
      "heading": "Bytów: czytelny obraz i dźwięk w całej sali",
      "intro": "W Bytowie zapewniamy oprawę techniczną konferencji i szkoleń firmowych. Dobieramy nagłośnienie, multimedia, oświetlenie i streaming do ustawienia publiczności.",
      "planning": "Gdy sala ma dwa poziomy, widoczność prezentacji trzeba ocenić z obu części. Ustalamy, czy potrzebny jest dodatkowy ekran, inne ustawienie sceny lub osobna strefa nagłośnienia. Kadry kamer planujemy tak, aby uczestnicy i operatorzy nie przeszkadzali sobie podczas programu.",
      "checks": [
        "Przekaż układ miejsc na obu poziomach sali.",
        "Sprawdźmy widoczność slajdów z dalszych stanowisk.",
        "Ustal godziny dostępu na wniesienie sprzętu i próbę."
      ],
      "venue": {
        "name": "Centrum Ułan SPA w Bytowie",
        "fact": "Obiekt opisuje dwupoziomową salę konferencyjną z projektorem, ekranem i nagłośnieniem. Przy takim układzie warto sprawdzić odbiór prezentacji z każdej części widowni.",
        "url": "https://ulanspa.pl/gastronomia-i-konferencje/sala-konferencyjna/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Jak przygotować konferencję w dwupoziomowej sali w Bytowie?",
        "answer": "Potrzebny jest plan miejsc i położenia ekranu. Sprawdzamy widoczność oraz dźwięk na obu poziomach; dodatkowe urządzenia dobieramy do faktycznych potrzeb."
      },
      {
        "question": "Czy transmisja może pokazywać jednocześnie prezentację i prelegenta?",
        "answer": "Tak. Ustalamy układ obrazu oraz sposób przełączania między kamerami i slajdami. Materiały prezentacyjne sprawdzamy przed wydarzeniem, aby zachować ich czytelność."
      }
    ]
  },
  "szczecin": {
    "description": "Konferencje Szczecin: technika sal modułowych, LED i streaming. MAVINCI zapewnia własne nagłośnienie i zespół do konferencji, warsztatów oraz bankietu.",
    "content": {
      "version": 1,
      "heading": "Szczecin: technika dopasowana do podziału sal",
      "intro": "W Szczecinie realizujemy oprawę konferencji, warsztatów i gal z dojazdem ekipy oraz sprzętu. Wspólnie dobierzemy nagłośnienie, LED, światło i zakres transmisji.",
      "planning": "Sala modułowa może działać jako jedna przestrzeń albo kilka niezależnych spotkań. Dlatego przed wyceną potrzebujemy docelowego podziału pomieszczeń i harmonogramu jego zmian. Transport, montaż oraz próby planujemy razem z dostępnością wybranej lokalizacji.",
      "checks": [
        "Wskaż ostateczny podział sal i równoległe sesje.",
        "Podaj dokładny budynek i wejście dla dostaw.",
        "Określ godziny pracy zespołu w każdym dniu wydarzenia."
      ],
      "venue": {
        "name": "Hotel Dana i centrum konferencyjne w Hanza Tower w Szczecinie",
        "fact": "Hotel Dana opisuje zaplecze konferencyjne w budynku Hanza Tower oraz możliwość podziału przestrzeni. W zapytaniu warto wskazać konkretny budynek i wybrane sale.",
        "url": "https://www.hoteldana.pl/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy MAVINCI ma oddział w Szczecinie?",
        "answer": "Nasze biuro i magazyn są w Olsztynie. Konferencję w Szczecinie obsługujemy z dojazdem własnego zespołu i techniki; logistykę ujmujemy w wycenie."
      },
      {
        "question": "Czy sprzęt można podzielić między kilka sal warsztatowych?",
        "answer": "Tak, po ustaleniu, które sesje odbywają się równocześnie. Każda niezależna sala potrzebuje odpowiednich urządzeń, połączeń i uzgodnionego zakresu obsługi."
      }
    ]
  },
  "warszawa": {
    "description": "Obsługa konferencji Warszawa. MAVINCI: Meyer Sound LINA, ekrany LED i streaming dla firm oraz agencji. Technika sceny głównej, paneli i sesji równoległych.",
    "content": {
      "version": 1,
      "heading": "Warszawa: kongres, ekspozycja i transmisja",
      "intro": "Agencjom i organizatorom konferencji w Warszawie zapewniamy własną technikę oraz realizatorów. Obsługujemy scenę główną, prezentacje, LED, światło i streaming w uzgodnionym zakresie.",
      "planning": "Gdy konferencji towarzyszy ekspozycja, rozdzielamy potrzeby sceny i stanowisk partnerów. Wspólny plan obejmuje dystrybucję obrazu, mikrofony oraz godziny dostaw. Przy wielu ekipach ustalamy jedną listę kontaktów i odpowiedzialność za poszczególne sygnały.",
      "checks": [
        "Przekaż plan sceny oraz stref partnerów.",
        "Zaznacz jednoczesne sesje i transmisje.",
        "Uzgodnij okna dostaw, próby oraz demontaż z organizatorem obiektu."
      ],
      "venue": {
        "name": "EXPO XXI Warszawa",
        "fact": "EXPO XXI oferuje hale i przestrzenie do wydarzeń biznesowych. Przy łączeniu konferencji z ekspozycją warto przygotować wspólny plan rozmieszczenia sceny, widowni i stanowisk wystawców.",
        "url": "https://expoxxi.pl/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy możecie być technicznym podwykonawcą agencji w Warszawie?",
        "answer": "Tak. Możemy odpowiadać za całą oprawę albo wybrane obszary, np. LED, nagłośnienie lub streaming. Ustalamy zakres, harmonogram i sposób komunikacji z producentem wydarzenia."
      },
      {
        "question": "Co jest potrzebne do wyceny konferencji połączonej z targami?",
        "answer": "Plan powierzchni, godziny programu, liczba scen i sal oraz wymagania transmisji. Ważne są także terminy dostaw, dostęp do montażu i zakres techniki innych wykonawców."
      }
    ]
  },
  "mlawa": {
    "description": "Konferencje i szkolenia Mława. MAVINCI dobierze mikrofony, multimedia, światło i streaming. Technika spotkania biznesowego i wieczoru integracyjnego.",
    "content": {
      "version": 1,
      "heading": "Mława: szkolenie zespołu i spotkanie firmowe",
      "intro": "W Mławie obsługujemy technikę szkoleń, prezentacji i konferencji firmowych. Możemy zapewnić komplet urządzeń lub uzupełnić wyposażenie sali o nagranie i transmisję.",
      "planning": "Przy warsztacie potrzebny jest inny układ obrazu i mikrofonów niż przy wykładzie. Ustalamy, czy prowadzący porusza się między stołami i czy uczestnicy prezentują własne materiały. Jeżeli po szkoleniu odbywa się integracja, dopasowujemy do niej światło oraz program muzyczny.",
      "checks": [
        "Prześlij układ stołów i liczbę grup warsztatowych.",
        "Ustalmy sposób podłączania komputerów uczestników.",
        "Rozpisz przerwę między częścią szkoleniową a integracją."
      ],
      "venue": {
        "name": "Hotel Mława",
        "fact": "Hotel przedstawia sale na spotkania i konferencje oraz zaplecze bankietowe. Wybór konkretnej sali i ustawienia uczestników pozwala określić potrzebny zakres multimediów.",
        "url": "https://hotelmlawa.pl/oferta/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy do warsztatu w Mławie można zamówić niewielki zestaw techniczny?",
        "answer": "Tak. Dobieramy sprzęt do sali i sposobu prowadzenia zajęć. Zakres może obejmować mikrofon, obsługę prezentacji oraz kamerę do transmisji lub zapisu."
      },
      {
        "question": "Czy uczestnicy mogą wyświetlać materiały ze swoich laptopów?",
        "answer": "Tak, po ustaleniu sposobu podłączenia i kolejności wystąpień. Warto wcześniej zebrać informacje o komputerach oraz plikach, aby zaplanować płynne zmiany prezentacji."
      }
    ]
  },
  "plock": {
    "description": "Konferencje Płock: nagłośnienie, LED i streaming MAVINCI. Przygotujemy widoczność prezentacji, dźwięk paneli i oprawę bankietu w wybranej sali.",
    "content": {
      "version": 1,
      "heading": "Płock: prezentacje czytelne z każdego sektora",
      "intro": "W Płocku przygotujemy technikę konferencji, panelu i bankietu. Dobierzemy własne nagłośnienie, LED, oświetlenie i kamery do układu sali oraz programu.",
      "planning": "Przy widowni podzielonej na sektory lub poziomy sprawdzamy, co zobaczą poszczególni uczestnicy. Czasem lepszy efekt daje dodatkowy ekran niż powiększenie sceny. Droga wprowadzenia urządzeń i położenie realizatorów muszą być uzgodnione przed montażem.",
      "checks": [
        "Prześlij rzut sali z rozmieszczeniem uczestników.",
        "Zaznacz miejsca z ograniczoną widocznością sceny.",
        "Ustalmy trasę transportu sprzętu i lokalizację kamer."
      ],
      "venue": {
        "name": "Hotel Tumski w Płocku",
        "fact": "Hotel opisuje dwupoziomową przestrzeń bankietowo-konferencyjną oraz dostęp od poziomu parkingu. Przy takim układzie warto zaplanować widoczność prezentacji dla obu części sali.",
        "url": "https://www.hoteltumski.pl/biznes/oferta-konferencyjna"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy jeden ekran wystarczy w dwupoziomowej sali w Płocku?",
        "answer": "Nie rozstrzygamy tego bez planu widowni. Sprawdzamy kąty i odległości oglądania, a w razie potrzeby proponujemy dodatkowy ekran lub inne ustawienie sceny."
      },
      {
        "question": "Czy można nagrać panel i pytania publiczności?",
        "answer": "Tak. Planujemy mikrofony dla panelistów oraz do pytań, a kamery ustawiamy pod uzgodnione kadry. Zakres nagrania i ewentualnego montażu określamy w ofercie."
      }
    ]
  },
  "lochow": {
    "description": "Techniczna obsługa konferencji Łochów. MAVINCI: Meyer Sound, LED, światło i streaming. Plan sceny, sesji warsztatowych oraz wieczornej gali.",
    "content": {
      "version": 1,
      "heading": "Łochów: miejsce na scenę, publiczność i galę",
      "intro": "W Łochowie przygotujemy oprawę konferencji wyjazdowej i wieczornego wydarzenia firmowego. Zapewniamy własny sprzęt, realizację prezentacji, nagłośnienie i streaming.",
      "planning": "Liczba gości musi uwzględniać miejsce na scenę, LED, kamery i stanowisko realizacyjne. Przy planie bankietowym dochodzą parkiet oraz catering. Wspólnie z organizatorem i obiektem dopasowujemy układ sali do całego programu, zanim wybierzemy wielkość instalacji.",
      "checks": [
        "Przekaż plan sali z cateringiem i ewentualnym parkietem.",
        "Ustalmy wielkość sceny i odległość pierwszego rzędu od ekranu.",
        "Zaznacz godziny równoległych warsztatów."
      ],
      "venue": {
        "name": "Pałac i Folwark Łochów",
        "fact": "Obiekt publikuje układy sal i zaznacza wpływ sceny, parkietu oraz bufetów na liczbę miejsc. To istotna informacja przy łączeniu sesji plenarnej z galą.",
        "url": "https://www.palacifolwarklochow.pl/konferencje/sale-konferencyjne"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy pojemność sali wystarczy do dobrania ekranu LED w Łochowie?",
        "answer": "Potrzebujemy także rzeczywistego ustawienia widowni, miejsca na scenę i wymiarów sali. Maksymalna pojemność katalogowa nie pokazuje wszystkich elementów konkretnego wydarzenia."
      },
      {
        "question": "Czy zapewniacie technikę warsztatów i gali w jednym zleceniu?",
        "answer": "Tak. Rozpisujemy urządzenia i obsługę dla obu części oraz ustalamy, które elementy można współdzielić. Przy sesjach równoległych przewidujemy niezależne stanowiska."
      }
    ]
  },
  "ciechanow": {
    "description": "Konferencje Ciechanów — dźwięk, LED i streaming MAVINCI. Obsługa większych prezentacji i kameralnych spotkań biznesowych z techniką dobraną do sali.",
    "content": {
      "version": 1,
      "heading": "Ciechanów: duża prezentacja lub spotkanie w małym gronie",
      "intro": "Dla konferencji w Ciechanowie dobieramy technikę do rzeczywistej liczby gości i formy spotkania. Zapewniamy nagłośnienie, obraz, światło oraz obsługę transmisji.",
      "planning": "Kameralna rozmowa przy stole wymaga innego ustawienia mikrofonów i kamery niż wystąpienie na scenie. Dlatego w briefie prosimy o układ uczestników i sposób prezentacji materiałów. W większej sali planujemy dodatkowo widoczność ekranu z dalszych rzędów.",
      "checks": [
        "Wskaż konkretną salę i jej ustawienie.",
        "Określ liczbę osób zabierających głos jednocześnie.",
        "Przekaż wymagania transmisji i dostępu do nagrania."
      ],
      "venue": {
        "name": "Hotel Atena w Ciechanowie",
        "fact": "Hotel oferuje większą salę konferencyjną i kameralną Złotą Salę Afrodyty. Różne formaty spotkań wymagają osobnego doboru mikrofonów, obrazu i obsługi.",
        "url": "https://hotelatena.pl/konferencje"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy obsłużycie małe spotkanie biznesowe w Ciechanowie?",
        "answer": "Tak. Zakres może obejmować obsługę prezentacji, mikrofony i połączenie online, bez dużej sceny. Ustalamy go według wybranej sali i sposobu prowadzenia rozmowy."
      },
      {
        "question": "Jak przygotować większą prezentację dla pracowników?",
        "answer": "Potrzebujemy liczby gości, planu widowni, materiałów ekranowych i kolejności wystąpień. Na tej podstawie dobieramy nagłośnienie, ekran oraz oświetlenie prowadzących."
      }
    ]
  },
  "serock": {
    "description": "Konferencje Serock: technika kilku sal, LED i streaming MAVINCI. Zaplanuj nagłośnienie sesji plenarnych, warsztatów oraz wieczornego bankietu.",
    "content": {
      "version": 1,
      "heading": "Serock: wspólny plan techniki dla kilku przestrzeni",
      "intro": "W Serocku zapewniamy techniczną obsługę konferencji hotelowych, szkoleń i bankietów. Własne nagłośnienie, LED i realizację obrazu łączymy z harmonogramem pracy zespołu.",
      "planning": "Przy wydarzeniu zajmującym kilka kondygnacji nie wystarcza sama lista sal. Ustalamy drogi przewozu urządzeń, kolejność montaży i obsadę równoległych sesji. Dodatkowo planujemy przekazywanie prezentacji, aby każda sala otrzymała właściwą wersję materiałów.",
      "checks": [
        "Prześlij plan sal z oznaczeniem pięter.",
        "Wskaż sesje wymagające nagrania lub połączeń zdalnych.",
        "Uzgodnijmy logistykę sprzętu przed wejściem uczestników."
      ],
      "venue": {
        "name": "Hotel Narvil w Serocku",
        "fact": "Narvil prezentuje sale na różnych poziomach budynku oraz przestrzenie towarzyszące. Przy korzystaniu z kilku pięter warto przygotować osobny plan obsługi i transportu urządzeń.",
        "url": "https://www.hotelnarvil.pl/sale-konferencyjne"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Jak obsłużyć równoległe szkolenia na kilku piętrach w Serocku?",
        "answer": "Rozpisujemy stanowiska, urządzenia i realizatorów dla każdej sali. Harmonogram obejmuje dostęp do montażu, próby i sposób przekazywania aktualnych materiałów."
      },
      {
        "question": "Czy materiały na ekranach mogą być wspólne dla całego wydarzenia?",
        "answer": "Tak. Uzgadniamy oprawę wizualną oraz różnice między sesjami. Każda sala otrzymuje przypisany program i właściwe prezentacje, a wspólne plansze mogą spajać wydarzenie."
      }
    ]
  },
  "jachranka": {
    "description": "Obsługa konferencji Jachranka. MAVINCI: Meyer Sound, LED, światło i streaming. Technika kongresu, sesji równoległych i wielodniowego spotkania firmowego.",
    "content": {
      "version": 1,
      "heading": "Jachranka: wielodniowa konferencja i równoległe sesje",
      "intro": "W Jachrance przygotujemy technikę kongresu lub firmowej konferencji z warsztatami. Zapewniamy nagłośnienie, LED, oświetlenie oraz realizację transmisji i prezentacji.",
      "planning": "Przy programie rozłożonym na kilka dni planujemy pracę zespołu, aktualizacje prezentacji i uruchomienie sal przed pierwszą sesją. Równoległe ścieżki wymagają osobnej obsady. Bankiet opisujemy jako kolejny etap, z własną próbą i programem.",
      "checks": [
        "Prześlij agendę wszystkich dni i podział na sale.",
        "Wyznacz osobę zatwierdzającą aktualne prezentacje.",
        "Ustalmy dostęp do sprzętu i sal między dniami wydarzenia."
      ],
      "venue": {
        "name": "Hotel Warszawianka w Jachrance",
        "fact": "Warszawianka oferuje rozbudowane centrum kongresowe z wieloma salami. Przy wyborze kilku przestrzeni warto najpierw ustalić liczbę jednoczesnych sesji oraz ich wymagania techniczne.",
        "url": "https://www.warszawianka.pl/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy MAVINCI obsłuży wielodniową konferencję w Jachrance?",
        "answer": "Tak, harmonogram pracy realizatorów i zakres urządzeń uzgadniamy dla każdego dnia. W ofercie uwzględniamy montaż, próby, sesje, bankiet i demontaż."
      },
      {
        "question": "Jak przekazywać poprawione prezentacje podczas kongresu?",
        "answer": "Ustalamy jeden kanał przekazania i osobę akceptującą pliki. Każdy materiał powinien mieć wskazaną salę, sesję i autora, aby uniknąć pomylenia wersji."
      }
    ]
  },
  "ostroleka": {
    "description": "Konferencje Ostrołęka i okolice. MAVINCI: nagłośnienie, LED i streaming. Technika spotkań hotelowych, paneli oraz firmowych gal z dojazdem zespołu.",
    "content": {
      "version": 1,
      "heading": "Ostrołęka: konferencja w mieście lub pobliskim hotelu",
      "intro": "W Ostrołęce i okolicach obsługujemy konferencje, prezentacje i gale. Dostarczamy własne nagłośnienie, multimedia oraz zespół do realizacji obrazu, światła i transmisji.",
      "planning": "Przy wycenie podaj dokładny adres obiektu i salę, zwłaszcza gdy wydarzenie odbywa się poza miastem. Pozwala to zaplanować transport, godziny montażu i obsadę. Dla konferencji połączonej z kolacją uzgadniamy także zmianę ustawienia oraz próby programu wieczornego.",
      "checks": [
        "Wskaż obiekt, salę i wejście dla dostaw.",
        "Przekaż godziny dostępu oraz zakończenia wydarzenia.",
        "Rozpisz oddzielnie potrzeby konferencji i gali."
      ],
      "venue": {
        "name": "Korona Hotel w Krukach koło Ostrołęki",
        "fact": "Hotel w Krukach, w gminie Olszewo-Borki, oferuje sale do konferencji i szkoleń. To przykład lokalizacji w okolicy Ostrołęki, której dokładny adres warto uwzględnić w planie transportu.",
        "url": "https://www.korona-hotel.pl/biznes/sale-konferencyjne"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy obsługujecie konferencje poza samą Ostrołęką?",
        "answer": "Tak. Przyjeżdżamy do wybranego obiektu z urządzeniami i realizatorami. Transport oraz czas montażu wyceniamy na podstawie dokładnej lokalizacji i zakresu."
      },
      {
        "question": "Czy można zamówić tylko nagłośnienie i obsługę panelu?",
        "answer": "Tak. Dobieramy mikrofony, głośniki i realizatora do liczby rozmówców oraz ustawienia sali. Obraz, światło i streaming mogą być osobnymi elementami zlecenia."
      }
    ]
  },
  "torun": {
    "description": "Konferencje Toruń: nagłośnienie, LED, prezentacje i streaming MAVINCI. Przygotowanie sal modułowych, paneli dyskusyjnych oraz sesji warsztatowych.",
    "content": {
      "version": 1,
      "heading": "Toruń: modułowe sale i niezależne sesje",
      "intro": "W Toruniu zapewniamy technikę konferencji i spotkań branżowych: dźwięk, LED, światło, prezentacje oraz streaming. Zakres dopasowujemy do podziału sal i agendy.",
      "planning": "Połączenie lub rozdzielenie modułów zmienia układ publiczności i potrzeby nagłośnienia. Ustalamy konfigurację sal na każdą część dnia oraz potrzebę niezależnych źródeł prezentacji. Jeśli spotkania trwają równocześnie, każde otrzymuje własny plan obsługi.",
      "checks": [
        "Podaj konfigurację modułów dla poszczególnych sesji.",
        "Przekaż liczbę równoległych prezentacji.",
        "Uzgodnijmy dostęp transportowy i czas prób w każdej sali."
      ],
      "venue": {
        "name": "CKK Jordanki w Toruniu",
        "fact": "Jordanki opisują zespół sal konferencyjnych, które można łączyć. Wybór konfiguracji powinien poprzedzać planowanie nagłośnienia, źródeł obrazu i stanowisk realizacyjnych.",
        "url": "https://jordanki.torun.pl/space/zespol-sal-konferencyjnych/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy można zmienić podział sal podczas konferencji w Toruniu?",
        "answer": "Jeżeli pozwala na to obiekt i harmonogram, planujemy zmianę wraz z przebudową połączeń oraz próbą. Potrzebujemy wcześniej uzgodnionego czasu przerwy."
      },
      {
        "question": "Czy sesje równoległe mogą mieć osobne transmisje?",
        "answer": "Tak, po ustaleniu liczby niezależnych realizacji, platform i parametrów łącza. Każda transmisja wymaga odpowiedniej obsady i zestawu sygnałów obrazu oraz dźwięku."
      }
    ]
  },
  "bydgoszcz": {
    "description": "Obsługa konferencji Bydgoszcz. MAVINCI: Meyer Sound, LED, światło i streaming. Technika wystąpień oraz części artystycznej, z własnym zespołem realizatorów.",
    "content": {
      "version": 1,
      "heading": "Bydgoszcz: konferencja z częścią artystyczną",
      "intro": "Dla konferencji w Bydgoszczy przygotujemy nagłośnienie, multimedia i streaming, a także oprawę gali. Przyjeżdżamy z własną techniką i ekipą z zaplecza w Olsztynie.",
      "planning": "Połączenie wystąpień z koncertem wymaga uzgodnienia mikrofonów, odsłuchów i kolejności prób. Wspólny scenariusz obejmuje prezentacje, wejścia artystów oraz materiały na ekran. Ustalamy z techniką obiektu, które elementy instalacji pozostają wspólne.",
      "checks": [
        "Przekaż wymagania techniczne wykonawców.",
        "Zarezerwuj osobne próby wystąpień i części muzycznej.",
        "Ustalmy zmianę sceny między konferencją a galą."
      ],
      "venue": {
        "name": "Centrum Kongresowe Opera Nova w Bydgoszczy",
        "fact": "Opera Nova przedstawia przestrzenie do kongresów, konferencji i spotkań. Przy dodaniu części artystycznej warto uzgodnić z gospodarzem próby, wyposażenie sceny oraz podział obsługi.",
        "url": "https://www.opera.bydgoszcz.pl/centrum-kongresowe.html"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy macie magazyn techniczny w Bydgoszczy?",
        "answer": "Biuro i magazyn MAVINCI znajdują się w Olsztynie przy ul. Towarowej 20B. Do Bydgoszczy przyjeżdżamy ze sprzętem i zespołem; transport uwzględniamy w wycenie."
      },
      {
        "question": "Czy konferencję i koncert można objąć jednym planem technicznym?",
        "answer": "Tak. Potrzebujemy scenariusza, wymagań artystów oraz czasu na próby. Rozpisujemy wspólne urządzenia i elementy wymagające przebudowy przed częścią muzyczną."
      }
    ]
  },
  "brodnica": {
    "description": "Konferencje i szkolenia Brodnica. MAVINCI: nagłośnienie, prezentacje, LED oraz streaming. Obsługa sal warsztatowych i spotkania plenarnego.",
    "content": {
      "version": 1,
      "heading": "Brodnica: warsztaty i wspólna sesja podsumowująca",
      "intro": "W Brodnicy przygotujemy technikę szkolenia, konferencji i bankietu. Dobieramy nagłośnienie, ekran oraz realizację obrazu do sposobu pracy uczestników.",
      "planning": "Przy podziale na grupy ważne są oddzielne źródła prezentacji i sprawne przejście do sesji wspólnej. Ustalamy, czy sale pozostają otwarte, czy działają niezależnie. W harmonogramie uwzględniamy wniesienie urządzeń, próby oraz przekazanie materiałów od trenerów.",
      "checks": [
        "Przekaż plan podziału uczestników na grupy.",
        "Wskaż sale i godziny wspólnego podsumowania.",
        "Ustalmy sposób przekazania prezentacji każdego prowadzącego."
      ],
      "venue": {
        "name": "Hotel Stork w Brodnicy",
        "fact": "Hotel opisuje kilka sal konferencyjnych, w tym przestrzenie z możliwością połączenia. Wybrana konfiguracja wpływa na liczbę ekranów, mikrofonów i potrzebnych stanowisk obsługi.",
        "url": "https://www.hotelstork.pl/sale-konferencyjne"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy możecie obsłużyć szkolenie w kilku salach w Brodnicy?",
        "answer": "Tak. Potrzebujemy godzin sesji, liczby prowadzących i wyposażenia sal. Pozwoli to określić niezależne zestawy i zakres wsparcia realizatorów."
      },
      {
        "question": "Jak przygotować finałową prezentację wyników warsztatów?",
        "answer": "Ustalamy kolejność grup, sposób przekazania ich materiałów i mikrofony dla prezentujących. Warto przewidzieć krótką próbę oraz wspólny format slajdów."
      }
    ]
  },
  "grudziadz": {
    "description": "Konferencje Grudziądz: dźwięk, LED, światło i streaming MAVINCI. Technika szkolenia oraz integracji w sali i plenerze, z uzgodnionym planem realizacji.",
    "content": {
      "version": 1,
      "heading": "Grudziądz: spotkanie w sali i integracja na zewnątrz",
      "intro": "Konferencję w Grudziądzu możemy połączyć z techniczną obsługą programu integracyjnego. Dostarczamy nagłośnienie, multimedia i światło oraz realizujemy transmisje.",
      "planning": "Jeśli część programu odbywa się nad jeziorem, technikę salową i plenerową planujemy osobno. Ustalamy strefy zasilania, przejścia uczestników i miejsce programu na wypadek deszczu. Dla części oficjalnej priorytetem pozostaje czytelność mowy i prezentacji.",
      "checks": [
        "Zaznacz program wewnętrzny i zewnętrzny w agendzie.",
        "Wskaż wariant salowy na zmianę pogody.",
        "Uzgodnijmy miejsce urządzeń, zasilanie oraz transport między strefami."
      ],
      "venue": {
        "name": "Hotel Rudnik w Grudziądzu",
        "fact": "Hotel opisuje zaplecze konferencyjne i teren rekreacyjny nad jeziorem z plażą. Przy łączeniu szkolenia z integracją warto przygotować osobny plan techniki dla każdej strefy.",
        "url": "https://www.hotelrudnik.pl/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy do integracji po konferencji w Grudziądzu można wykorzystać te same urządzenia?",
        "answer": "Czasem tak, jeśli pozwalają na to odległość i przerwa w programie. Przy nakładających się wydarzeniach planujemy oddzielne zestawy zamiast przenoszenia pracującego sprzętu."
      },
      {
        "question": "Co ustalić przed zamówieniem techniki plenerowej?",
        "answer": "Miejsce, zasilanie, warunki ustawienia urządzeń i scenariusz na niepogodę. Zakres ochrony sprzętu oraz ewentualnego przeniesienia programu określamy z organizatorem i obiektem."
      }
    ]
  },
  "lomza": {
    "description": "Konferencje Łomża: mikrofony, prezentacje, LED i streaming MAVINCI. Techniczna obsługa spotkań biznesowych, szkoleń oraz bankietów z dojazdem ekipy.",
    "content": {
      "version": 1,
      "heading": "Łomża: szkolenie i spotkanie partnerów biznesowych",
      "intro": "W Łomży zapewniamy oprawę techniczną konferencji, szkoleń oraz bankietów. Własne nagłośnienie, ekrany i realizację transmisji dopasowujemy do programu oraz sali.",
      "planning": "Przy spotkaniu partnerów ważne są płynne zmiany prezentacji i możliwość zadawania pytań. Ustalamy kolejność wystąpień, rodzaje komputerów oraz liczbę mikrofonów. Jeśli część osób dołącza zdalnie, przygotowujemy osobny plan odsłuchu i próbę połączenia.",
      "checks": [
        "Przekaż listę prowadzących i ich materiały.",
        "Wskaż gości łączących się online.",
        "Ustalmy potrzebę dodatkowego światła dla kamer."
      ],
      "venue": {
        "name": "Hotel Gromada w Łomży",
        "fact": "Gromada przedstawia sale konferencyjne oraz przestrzeń bankietową. Przy programie dziennym i wieczornym warto ustalić, czy obie części korzystają z tego samego wyposażenia.",
        "url": "https://www.gromada.pl/hotel-lomza/konferencje"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy obsługujecie konferencje z prelegentem online w Łomży?",
        "answer": "Tak. Uzgadniamy platformę, sposób prezentacji i pytania z sali, a następnie planujemy próbę połączenia. Z obiektem ustalamy dostępne łącze oraz warunki pracy kamer."
      },
      {
        "question": "Czy trzeba dostarczyć wszystkie prezentacje przed wydarzeniem?",
        "answer": "Wcześniejsze przekazanie plików pozwala sprawdzić filmy, fonty i proporcje obrazu. Termin i sposób późniejszych zmian ustalamy z organizatorem, aby realizator dysponował właściwymi wersjami."
      }
    ]
  },
  "bialystok": {
    "description": "Obsługa konferencji Białystok. MAVINCI: Meyer Sound, LED, oświetlenie i streaming. Technika wystąpień, paneli oraz gal we współpracy z obiektem.",
    "content": {
      "version": 1,
      "heading": "Białystok: konferencja ze scenariuszem scenicznym",
      "intro": "Dla wydarzeń w Białymstoku przygotujemy nagłośnienie, LED, światło oraz realizację obrazu. Wspieramy organizatorów i agencje w technicznej obsłudze konferencji oraz gal.",
      "planning": "W obiekcie ze stałą sceną zaczynamy od uzgodnień z jego zespołem technicznym. Rozpisujemy wejścia prowadzących, prezentacje, pozycje kamer i sposób realizacji panelu. Dzięki temu urządzenia dostarczane przez MAVINCI uzupełniają uzgodniony zakres wyposażenia.",
      "checks": [
        "Przekaż scenariusz i potrzeby każdego występującego.",
        "Ustalmy zakres techniki obiektu i naszej ekipy.",
        "Zarezerwuj próbę sceny, kamer i materiałów wideo."
      ],
      "venue": {
        "name": "Opera i Filharmonia Podlaska w Białymstoku",
        "fact": "OiFP publikuje ofertę wynajmu swoich przestrzeni. Przy planowaniu konferencji lub gali warto ustalić warunki użytkowania wybranej sceny i dostępnej infrastruktury.",
        "url": "https://www.oifp.eu/wynajem/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy możecie zapewnić dodatkową technikę do obiektu z własną sceną w Białymstoku?",
        "answer": "Tak. Po uzgodnieniu z gospodarzem możemy uzupełnić zakres o LED, kamery, transmisję lub realizatorów. Podział odpowiedzialności określamy przed wydarzeniem."
      },
      {
        "question": "Jak połączyć wystąpienia i wręczenie nagród w jednym programie?",
        "answer": "Przygotowujemy kolejność wejść, mikrofony, prezentacje i akcenty świetlne. Próba z prowadzącym pozwala ustalić sygnały dla realizatorów i momenty zmian na scenie."
      }
    ]
  },
  "pszczyna": {
    "description": "Konferencje Pszczyna i okolice: nagłośnienie, LED i streaming MAVINCI. Technika szkolenia, spotkania firmowego oraz programu integracyjnego.",
    "content": {
      "version": 1,
      "heading": "Pszczyna: szkolenie wyjazdowe z integracją",
      "intro": "W Pszczynie i okolicach przygotujemy oprawę techniczną konferencji oraz wieczoru firmowego. Zapewniamy nagłośnienie, multimedia, światło i streaming z dojazdem zespołu.",
      "planning": "Przy wyjeździe szkoleniowym ustalamy, czy program wieczorny odbywa się w sali konferencyjnej, klubie czy ogrodzie. Każda strefa ma inne potrzeby, a urządzenia nie zawsze można przenieść między nimi w krótkiej przerwie. Dokładna lokalizacja pozwala zaplanować logistykę.",
      "checks": [
        "Podaj adres obiektu, także gdy leży poza Pszczyną.",
        "Rozpisz salę szkoleniową i strefę wieczorną.",
        "Ustalmy zakres dźwięku, światła i obrazu dla obu części."
      ],
      "venue": {
        "name": "Hotel Styl 70 w Piasku koło Pszczyny",
        "fact": "Hotel oferuje sale konferencyjne, klub oraz teren do wydarzeń na zewnątrz. Przy takim programie warto rozdzielić technikę szkolenia i integracji między wybrane przestrzenie.",
        "url": "https://hotelstyl70.pl/o-nas/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy dojeżdżacie do hoteli w okolicach Pszczyny?",
        "answer": "Tak. Potrzebujemy dokładnego adresu oraz godzin dostępu do montażu i demontażu. Transport ekipy i sprzętu z Olsztyna jest uwzględniany w indywidualnej wycenie."
      },
      {
        "question": "Czy konferencję można połączyć z oprawą muzyczną i światłem wieczoru firmowego?",
        "answer": "Tak. Uzgadniamy program, przestrzeń i wymagania techniczne obu części. Na tej podstawie planujemy zestawy urządzeń, obsługę i ewentualną przebudowę."
      }
    ]
  },
  "wroclaw": {
    "description": "Konferencje Wrocław: nagłośnienie Meyer Sound, ekrany LED i streaming MAVINCI. Realizacja sceny, paneli i prezentacji dla organizatorów oraz agencji.",
    "content": {
      "version": 1,
      "heading": "Wrocław: konferencja obok ekspozycji i stref partnerów",
      "intro": "We Wrocławiu wspieramy firmy i agencje w technicznej realizacji konferencji. Zapewniamy własne nagłośnienie, LED, oświetlenie oraz streaming w uzgodnionym zakresie.",
      "planning": "Gdy scena konferencyjna sąsiaduje ze strefą wystawienniczą, planujemy kierunek nagłośnienia i pozycje kamer z uwzględnieniem obu programów. Prezentacje, branding partnerów i transmisja mogą potrzebować różnych wersji obrazu. Zakres ustalamy z producentem i techniką obiektu.",
      "checks": [
        "Prześlij plan sceny i ekspozycji partnerów.",
        "Zaznacz wystąpienia odbywające się równocześnie.",
        "Ustalmy obrazy dla publiczności, ekranów partnerów i transmisji."
      ],
      "venue": {
        "name": "Kompleks Hali Stulecia we Wrocławiu",
        "fact": "Kompleks obejmuje Halę Stulecia, Wrocławskie Centrum Kongresowe i przestrzenie towarzyszące. Dla wydarzenia obejmującego kilka stref potrzebny jest wspólny plan techniczny i logistyczny.",
        "url": "https://halastulecia.pl/kompleks-hali-stulecia/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy można zamówić wybrany zakres techniki konferencji we Wrocławiu?",
        "answer": "Tak. Możemy odpowiadać za nagłośnienie, LED, światło lub realizację transmisji. Ustalamy warunki współpracy z pozostałymi ekipami i punkty przekazania sygnałów."
      },
      {
        "question": "Jak przygotować konferencję obok strefy wystawców?",
        "answer": "Potrzebujemy układu powierzchni i godzin aktywności partnerów. Pozwala to zaplanować ustawienie głośników, mikrofony oraz kadry, a także wskazać możliwe kolizje programu."
      }
    ]
  },
  "poznan": {
    "description": "Obsługa konferencji Poznań. MAVINCI: Meyer Sound, LED i streaming. Technika sesji plenarnych, prezentacji partnerów i wydarzeń towarzyszących targom.",
    "content": {
      "version": 1,
      "heading": "Poznań: sesja plenarna i wydarzenie targowe",
      "intro": "Konferencję w Poznaniu obsłużymy technicznie jako partner organizatora lub agencji. Zapewniamy nagłośnienie, LED, światło, prezentacje i realizację transmisji.",
      "planning": "Przy programie połączonym z targami rozpisujemy osobno salę plenarną i przestrzeń ekspozycji. Dostawy, próby i demontaż muszą pasować do harmonogramu całego wydarzenia. Ustalamy także, które materiały mają trafić na ekran sali, a które do przekazu online.",
      "checks": [
        "Wskaż dokładny pawilon lub salę i wejście dostawcze.",
        "Przekaż wymagania sceny oraz partnerów.",
        "Uzgodnij terminy prób i przekazania materiałów ekranowych."
      ],
      "venue": {
        "name": "Poznań Congress Center",
        "fact": "PCC przedstawia Salę Ziemi, sale konferencyjne i pawilony wystawiennicze. Przy wyborze kilku przestrzeni warto od początku przypisać im odrębny zakres techniki i obsługi.",
        "url": "https://poznancongresscenter.pl/pl/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy możecie obsłużyć konferencję towarzyszącą targom w Poznaniu?",
        "answer": "Tak. Zakres ustalamy na podstawie sali lub pawilonu, scenariusza i zasad pracy obiektu. W harmonogramie uwzględniamy dostawy, montaż, próby i demontaż."
      },
      {
        "question": "Czy transmisja może mieć inną oprawę niż ekran w sali?",
        "answer": "Tak. Ustalamy osobne układy prezentacji, kamer i oznaczeń partnerów. Pozwala to dopasować obraz do odbiorcy na miejscu oraz oglądającego wydarzenie online."
      }
    ]
  },
  "krakow": {
    "description": "Konferencje Kraków: nagłośnienie, LED, światło i streaming MAVINCI. Realizacja sesji plenarnych, paneli oraz spotkań hybrydowych z własnym zespołem.",
    "content": {
      "version": 1,
      "heading": "Kraków: kongres i uczestnicy na sali oraz online",
      "intro": "W Krakowie przygotujemy techniczną oprawę konferencji i wydarzenia hybrydowego. Własne nagłośnienie, LED oraz realizację obrazu łączymy z obsługą programu scenicznego.",
      "planning": "Przy kongresie ustalamy, które sesje mają odbiorców online, jakie prezentacje otrzymuje sala i kto obsługuje dyskusję. Jeżeli organizator planuje tłumaczenie, trzeba wcześniej uzgodnić przekazanie dźwięku i podział obowiązków z jego dostawcą.",
      "checks": [
        "Przekaż agendę sesji plenarnych i równoległych.",
        "Wskaż języki wydarzenia i zakres udziału online.",
        "Zaplanujmy próbę połączeń zdalnych oraz materiałów ekranowych."
      ],
      "venue": {
        "name": "Centrum Kongresowe ICE Kraków",
        "fact": "ICE prezentuje sale audytoryjną, teatralną, kameralną i zespół sal konferencyjnych. Wybór przestrzeni wpływa na realizację obrazu, ustawienie panelistów oraz obsługę sesji równoległych.",
        "url": "https://icekrakow.pl/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy obsłużycie hybrydową konferencję w Krakowie?",
        "answer": "Tak. Ustalamy liczbę transmisji, sposób udziału zdalnych gości i potrzeby nagrania. Parametry łącza, urządzenia i obsadę dobieramy do programu oraz wybranego obiektu."
      },
      {
        "question": "Czy konferencja z tłumaczeniem wymaga dodatkowych uzgodnień?",
        "answer": "Tak. Z organizatorem i dostawcą tłumaczeń ustalamy źródła dźwięku oraz sposób przekazania poszczególnych wersji językowych. Zakres należy określić przed przygotowaniem połączeń."
      }
    ]
  },
  "opole": {
    "description": "Konferencje Opole: technika sal i przestrzeni wystawienniczych. MAVINCI — Meyer Sound, ekrany LED, światło oraz streaming z obsługą realizatorów.",
    "content": {
      "version": 1,
      "heading": "Opole: konferencja i ekspozycja w jednym programie",
      "intro": "W Opolu przygotujemy nagłośnienie, LED, oświetlenie i streaming konferencji. Możemy objąć techniką salę spotkań oraz wybrane elementy programu wystawienniczego.",
      "planning": "Gdy sesje odbywają się na piętrze, a ekspozycja na parterze, planujemy oddzielne drogi transportu i stanowiska. Podział sal na moduły wymaga ustalenia niezależnych prezentacji i mikrofonów. Potrzeby transmisji opisujemy dla każdej sesji osobno.",
      "checks": [
        "Przekaż plan kondygnacji i podział sal.",
        "Ustalmy, które stanowiska potrzebują obrazu i nagłośnienia.",
        "Potwierdź godziny dostaw oraz prób z gospodarzem obiektu."
      ],
      "venue": {
        "name": "Centrum Wystawienniczo-Kongresowe w Opolu",
        "fact": "CWK opisuje hale na poziomie gruntu i salę konferencyjną na piętrze, dzieloną na mniejsze pomieszczenia. Taki układ wymaga uwzględnienia odrębnych stref technicznych.",
        "url": "https://cwkopole.pl/obiekt/"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy możecie obsłużyć salę konferencyjną i ekspozycję w Opolu?",
        "answer": "Tak. Ustalamy potrzeby każdej strefy, ich godziny działania i zakres urządzeń. Równoległe programy mogą wymagać niezależnych stanowisk oraz realizatorów."
      },
      {
        "question": "Co zmienia podział sali konferencyjnej na mniejsze moduły?",
        "answer": "Zmienia liczbę niezależnych źródeł obrazu, mikrofonów i zadań obsługi. Potrzebujemy docelowej konfiguracji oraz planu ewentualnych zmian w trakcie wydarzenia."
      }
    ]
  },
  "lodz": {
    "description": "Obsługa konferencji Łódź. MAVINCI: Meyer Sound, LED, oświetlenie i streaming. Technika wydarzeń w salach konferencyjnych oraz przestrzeniach industrialnych.",
    "content": {
      "version": 1,
      "heading": "Łódź: konferencja w przestrzeni industrialnej",
      "intro": "W Łodzi zapewniamy techniczną oprawę konferencji, prezentacji i gal. Własne nagłośnienie, LED, światło oraz kamery dobieramy do wnętrza i programu.",
      "planning": "W przestrzeni industrialnej najpierw ustalamy układ sceny i publiczności oraz warunki ustawienia urządzeń. Projektujemy oprawę światłem tak, by wspierała wystąpienia i obraz kamerowy. Sposób montażu, zasilanie i prowadzenie przewodów uzgadniamy z zarządcą.",
      "checks": [
        "Przekaż plan sceny i informacje o elementach stałych wnętrza.",
        "Ustalmy widoczność ekranu oraz kadry kamer.",
        "Potwierdź dopuszczone sposoby montażu i dostęp do zasilania."
      ],
      "venue": {
        "name": "EC1 Łódź — Miasto Kultury",
        "fact": "EC1 udostępnia przestrzenie na konferencje i wydarzenia, w tym Halę Maszyn w dawnym kompleksie elektrowni. Przy wyborze takiego wnętrza warto uzgodnić technikę z jego warunkami użytkowania.",
        "url": "https://bip.ec1lodz.pl/Krotkoterminowy-najem-powierzchni-komercyjnych%2C44"
      },
      "researchedAt": "2026-09-29"
    },
    "faq": [
      {
        "question": "Czy ekran LED można wykorzystać podczas konferencji w industrialnym obiekcie w Łodzi?",
        "answer": "Tak, po dopasowaniu wymiarów, konstrukcji i miejsca ustawienia do warunków obiektu. Przed ofertą potwierdzamy dostęp transportowy, zasilanie i zasady montażu."
      },
      {
        "question": "Jak połączyć dekoracyjne światło wnętrza z transmisją?",
        "answer": "Planujemy osobno oświetlenie prelegentów oraz tła. Próba kamerowa pozwala ocenić czytelność twarzy i prezentacji przy zachowaniu charakteru przestrzeni."
      }
    ]
  }
}
$city_content$::jsonb)
  LOOP
    UPDATE public.schema_org_page_metadata
    SET description = profile->>'description',
        custom_schema = COALESCE(custom_schema::jsonb, '{}'::jsonb) || jsonb_build_object(
          'conferenceContent', profile->'content',
          'faq', profile->'faq'
        ),
        updated_at = now()
    WHERE page_slug = 'oferta/konferencje/' || city_slug
      AND COALESCE(custom_schema::jsonb->'conferenceContent', 'null'::jsonb) = 'null'::jsonb;
  END LOOP;
END;
$migration$;
