-- Editorial update for the Olsztyn and Mikolajki conference pages.
-- Preserve unrelated schema fields and any later version-2 CMS edits.
-- No new office locations or unconfirmed portfolio references are created.
DO $migration$
DECLARE
  city_slug text;
  profile jsonb;
BEGIN
  FOR city_slug, profile IN SELECT key, value FROM jsonb_each($profiles$
{
  "olsztyn": {
    "nearbyCitySlugs": [
      "ostroda",
      "szczytno",
      "nidzica",
      "mragowo",
      "ilawa",
      "mikolajki"
    ],
    "content": {
      "heading": "Olsztyn: konferencja z własnym zapleczem technicznym na miejscu",
      "intro": "MAVINCI przygotowuje obsługę techniczną konferencji w Olsztynie z biura i magazynu przy ul. Towarowej 20B. Możesz zamówić samą realizację prezentacji, nagłośnienie lub streaming, a także powierzyć nam cały program: od wystąpień i paneli po wieczorny bankiet. Własny Meyer Sound LINA, ekrany LED, telewizory i oświetlenie dobieramy do konkretnej sali — rozmiar zestawu wynika z programu, nie z gotowego pakietu.",
      "planningHeading": "Od programu spotkania do planu stanowisk",
      "planning": "Przy konferencji w Olsztynie zaczynamy od rzutu sali i agendy. Dla panelu rozpisujemy mikrofony moderatora oraz gości; dla prezentacji sprawdzamy czytelność slajdów z ostatnich rzędów; przy transmisji ustalamy kadry kamer i dźwięk dla odbiorców online. Jeśli obiekt ma własne nagłośnienie lub projektor, porównujemy jego możliwości z wymaganiami wydarzenia. Dopiero wtedy określamy dodatkowe urządzenia, liczbę realizatorów i potrzebne próby. Możliwość oraz termin wizji lokalnej ustalamy przed wyceną.",
      "checks": [
        "Prześlij adres obiektu w Olsztynie lub okolicy, rzut sali i plan ustawienia publiczności.",
        "Zaznacz panele dyskusyjne, pytania z widowni i wystąpienia prelegentów zdalnych.",
        "Podaj, które prezentacje mają trafić do transmisji lub nagrania i kto dostarcza pliki.",
        "Jeżeli planujesz bankiet, dołącz program wieczoru i wymagania zespołu lub DJ-a."
      ],
      "formatsHeading": "Trzy sposoby przygotowania konferencji w Olsztynie",
      "scenarios": [
        {
          "title": "Panel ekspercki i spotkanie biznesowe",
          "description": "Przy spotkaniu w sali konferencyjnej lub siedzibie firmy ważna jest zrozumiałość wypowiedzi i wygodna zmiana mówców. Dobieramy mikrofony do panelu oraz pytań z widowni. Prezentacje wyświetlamy na ekranie dopasowanym do odległości widzów — może to być telewizor, LED albo uzgodnione wyposażenie obiektu. Organizator otrzymuje opis obsługi wystąpień i listę materiałów potrzebnych do próby."
        },
        {
          "title": "Konferencja z udziałem gości online",
          "description": "Gdy część prelegentów lub odbiorców uczestniczy zdalnie, projektujemy dwa odbiory wydarzenia: na sali w Olsztynie i w transmisji. Ustalamy, kiedy pokazywać prezentację, obraz mówcy oraz pytania uczestników. Próba obejmuje połączenie zdalne, dźwięk w obu kierunkach i odtwarzanie materiałów. W ofercie rozdzielamy transmisję na żywo, nagranie wystąpień oraz późniejszy montaż."
        },
        {
          "title": "Dwa dni konferencji i wieczorny bankiet",
          "description": "Takie połączenie realizowaliśmy podczas konferencji PSRWN w Hotelu Przystań w Olsztynie: multimedia, dźwięk, światło i streaming uzupełniała obsługa nagłośnienia bankietu z zespołem TRIO. Dla kolejnego wydarzenia uzgadniamy osobno program dzienny i muzyczny, ustawienie sali oraz czas prób wykonawców. Zdjęcia i opis PSRWN pokazują rzeczywisty zakres tej realizacji; konfigurację nowej konferencji ustalamy od początku."
        }
      ],
      "benefitsHeading": "Co daje współpraca z zapleczem w Olsztynie?",
      "benefits": [
        {
          "title": "Przygotowanie urządzeń we własnej bazie",
          "description": "W magazynie przy Towarowej 20B kompletujemy sprzęt do uzgodnionego programu. Do wyceny włączamy transport, montaż i pracę realizatorów, aby lista urządzeń odpowiadała temu, co ma wydarzyć się na scenie."
        },
        {
          "title": "Konkretny przykład konferencji w mieście",
          "description": "PSRWN w Hotelu Przystań pokazuje nasze doświadczenie w połączeniu wystąpień, transmisji i bankietu. Możesz obejrzeć realizację przed rozmową o własnej konferencji i wskazać elementy, których potrzebujesz."
        },
        {
          "title": "Wybór pełnej obsługi lub jednego zakresu",
          "description": "Jeżeli masz już salę, prowadzącego i część wyposażenia, możemy uzupełnić uzgodniony zakres. Na etapie przygotowania przypisujemy zadania organizatorowi, technikom obiektu i zespołowi MAVINCI."
        }
      ],
      "logistics": "Zaplecze sprzętowe znajduje się przy Towarowej 20B w Olsztynie. Przed dostawą potwierdzamy z obiektem wejście techniczne, możliwość rozładunku, dostęp do wind i godziny udostępnienia sali. Przy konferencji w centrum miasta, hotelu lub siedzibie firmy warunki wniesienia urządzeń mogą być różne, dlatego potrzebujemy dokładnego adresu i kontaktu do gospodarza. Bliskość magazynu nie zastępuje rezerwacji sprzętu ani czasu na próbę; oba elementy wpisujemy do harmonogramu.",
      "recording": "Dla konferencji w Olsztynie można zamówić transmisję, nagranie albo oba zakresy. Przed wydarzeniem ustalamy listę rejestrowanych wystąpień, ujęcia prelegentów i sposób pokazania slajdów. Jeżeli nagrania mają być później udostępniane osobno, uwzględniamy podział sesji i oczekiwane materiały już w briefie. Organizator uzgadnia zgody prelegentów i dostęp do materiałów; my określamy technikę rejestracji, zakres montażu oraz sposób przekazania plików.",
      "costFactors": [
        "Wyposażenie, które zapewnia olsztyński obiekt, oraz urządzenia potrzebne dodatkowo.",
        "Liczba panelistów, mikrofonów do pytań i jednocześnie działających sal.",
        "Telewizory lub ekran LED dobrane do wielkości sali i treści prezentacji.",
        "Transmisja, połączenia zdalne, nagranie poszczególnych wystąpień i montaż.",
        "Dostęp do sali, transport z magazynu, próby oraz ewentualna obsługa wieczornego bankietu."
      ],
      "partnership": "Agencjom, hotelom i organizatorom konferencji w Olsztynie zapewniamy techniczny zakres uzgodniony z ich zespołem. Przed ofertą porównujemy wyposażenie obiektu z programem, wskazujemy odpowiedzialność za prezentacje i kontakt z prelegentami oraz ustalamy osobę zatwierdzającą zmiany podczas wydarzenia. Możemy prowadzić całą realizację AV lub wybrane stanowiska, takie jak obsługa obrazu i streaming.",
      "serviceArea": {
        "heading": "Olsztyn i okolice — dojazd z naszej bazy",
        "description": "Obsługujemy konferencje w Olsztynie oraz w okolicznych miejscowościach, między innymi w Barczewie, Dywitach i Stawigudzie. Podaj dokładny adres sali: nazwę obiektu, miejscowość oraz godziny dostępu. Na tej podstawie ustalamy transport i plan montażu. Mapa obejmuje Olsztyn i okolice, a znacznik wskazuje rzeczywisty budynek naszego biura i magazynu przy Towarowej 20B.",
        "locations": [
          "Olsztyn",
          "Barczewo",
          "Dywity",
          "Stawiguda"
        ]
      }
    },
    "faq": [
      {
        "question": "Czy do małej konferencji w Olsztynie potrzebny jest duży ekran LED?",
        "answer": "Nie zawsze. Znaczenie mają odległość od ekranu, układ widowni i szczegółowość prezentacji. Porównujemy LED z telewizorem lub wyposażeniem sali. Własny park urządzeń pozwala dobrać zakres do spotkania, zamiast zakładać z góry największy zestaw."
      },
      {
        "question": "Czy mogę zamówić samą obsługę prezentacji i transmisję?",
        "answer": "Tak. Ustalamy, które urządzenia udostępnia obiekt w Olsztynie, a które zapewnia MAVINCI. Do przygotowania potrzebujemy listy źródeł obrazu, informacji o nagłośnieniu, dostępie do internetu i osobie odpowiedzialnej za technikę sali."
      },
      {
        "question": "Czy obsługujecie też konferencje pod Olsztynem?",
        "answer": "Tak, dojeżdżamy między innymi do Barczewa, Dywit i Stawigudy. Mapa pokazuje naszą bazę, a zakres dojazdu nie kończy się na granicy miasta. Konkretny obiekt, godziny montażu i transport potwierdzamy w ofercie."
      }
    ]
  },
  "mikolajki": {
    "nearbyCitySlugs": [
      "mragowo",
      "gizycko",
      "ketrzyn",
      "elk",
      "olsztyn",
      "szczytno"
    ],
    "content": {
      "heading": "Mikołajki: technika konferencji hotelowej od sesji do bankietu",
      "intro": "Organizujesz konferencję w Mikołajkach i masz już zarezerwowany hotel? MAVINCI może uzupełnić jego wyposażenie albo przygotować pełną oprawę techniczną: nagłośnienie Meyer Sound LINA, ekrany LED, telewizory, światło, kamery i streaming. Przyjeżdżamy z własnym zapleczem z Olsztyna. Plan urządzeń i realizatorów obejmuje wybrane sale, program konferencji oraz ewentualną część wieczorną.",
      "planningHeading": "Co zapewnia hotel, a co zamawiasz w MAVINCI?",
      "planning": "Przed wyceną konferencji w Mikołajkach porównujemy zakres rezerwacji hotelowej z agendą. Prosimy o nazwy sal, ich docelowy podział i listę wyposażenia dostępnego z obsługą. Sam projektor lub nagłośnienie w sali nie określa jeszcze, kto przełącza prezentacje, podaje mikrofony i prowadzi transmisję. Wspólnie wskazujemy odpowiedzialne osoby, połączenia między systemami oraz czas na próbę. Dzięki temu oferta może obejmować konkretne uzupełnienie techniki albo niezależną realizację całego wydarzenia.",
      "checks": [
        "Dołącz potwierdzony układ sal w hotelu i zakres techniki zawartej w wynajmie.",
        "Zaznacz godziny sesji plenarnych, równoległych warsztatów i wieczornego bankietu.",
        "Potwierdź z gospodarzem trasę rozładunku oraz dostęp do sal przed przyjazdem gości.",
        "Przy streamingu wskaż platformę, prelegentów online i kontakt do osoby odpowiedzialnej za sieć w obiekcie."
      ],
      "formatsHeading": "Wybierz zakres dla konferencji w Mikołajkach",
      "scenarios": [
        {
          "title": "Uzupełnienie wyposażenia hotelu",
          "description": "Hotel zapewnia salę i część nagłośnienia, a Ty potrzebujesz dodatkowo LED, kamer, transmisji lub operatora prezentacji. Najpierw ustalamy dostępne złącza, sposób podania dźwięku do transmisji oraz podział obsługi. Możemy dodać telewizor do wybranej strefy lub totem z agendą wydarzenia. Zakres określa brakujące funkcje i stanowiska, dzięki czemu można porównać ofertę MAVINCI z tym, co już obejmuje rezerwacja obiektu."
        },
        {
          "title": "Sesja plenarna i równoległe warsztaty",
          "description": "Dla kilku sal w Mikołajkach przygotowujemy plan według godzin pracy każdej przestrzeni. Scena główna może wymagać LED, nagłośnienia, światła i realizacji kamerowej, a warsztaty mniejszych zestawów do mowy oraz prezentacji. Jeśli sesje trwają jednocześnie, przewidujemy odrębne urządzenia i obsadę. Organizator przekazuje jedną agendę z nazwami sal, a zakres oferty pokazuje, gdzie i kiedy działa zespół MAVINCI."
        },
        {
          "title": "Konferencja z bankietem i integracją",
          "description": "Ustalamy, czy wieczór odbywa się w tej samej sali, czy w innym miejscu obiektu. W pierwszym przypadku planujemy zmianę światła, materiałów na LED i ustawienia stanowisk; w drugim oddzielną instalację oraz próby wykonawców. Jeżeli część programu wychodzi na zewnątrz, możemy dobrać zewnętrzny ekran LED, a warunki montażu i wariant pogodowy uzgodnić z gospodarzem. To propozycja zakresu — dostępność i konfigurację potwierdzamy dla konkretnego terminu."
        }
      ],
      "benefitsHeading": "Co porządkujemy przed konferencją w hotelu?",
      "benefits": [
        {
          "title": "Jedna lista ustaleń z obiektem",
          "description": "Sale, wyposażenie hotelowe, zasilanie, sieć, rozładunek i godziny montażu trafiają do wspólnych ustaleń. Już przed wydarzeniem wiadomo, czego oczekujemy od gospodarza i jaki zakres zapewnia MAVINCI."
        },
        {
          "title": "Technika przypisana do programu",
          "description": "Rozdzielamy scenę główną, mniejsze sale i bankiet. Przy nakładających się sesjach wycena uwzględnia równoczesną obsługę, zamiast zakładać przenoszenie urządzeń lub realizatora w trakcie wystąpień."
        },
        {
          "title": "Obraz także poza sceną główną",
          "description": "Poza LED możemy wykorzystać telewizory i totemy do agendy, informacji dla uczestników lub uzgodnionego przekazu w dodatkowej strefie. Format treści, połączenia i miejsce instalacji planujemy z obiektem."
        }
      ],
      "logistics": "Do Mikołajek przywozimy technikę z naszej bazy w Olsztynie. W ofercie uwzględniamy transport, rozładunek, montaż oraz czas prób — sam początek konferencji nie jest godziną rozpoczęcia pracy ekipy. Przy porannej inauguracji sprawdzamy możliwość wejścia do sali poprzedniego dnia. Przy kilku dniach wydarzenia uzgadniamy pozostawienie urządzeń, dostęp realizatorów oraz plan demontażu. Jeśli hotel wynajmuje przestrzeń innym grupom, potrzebne jest potwierdzenie rzeczywistych godzin dostępności każdej sali.",
      "recording": "Przy transmisji z hotelu w Mikołajkach prosimy o kontakt do osoby zarządzającej jego siecią. Uzgadniamy dostęp do łącza i wykonanie próby w miejscu stanowiska realizatorskiego; sama informacja o Wi-Fi dla gości nie opisuje warunków streamingu. Dla sesji równoległych zaznaczamy, które mają być transmitowane, a które tylko nagrywane. Obraz z kamer, prezentacje i dźwięk planujemy osobno dla widowni oraz odbiorców online. Sposób publikacji i zakres materiałów po konferencji ustalamy w briefie.",
      "costFactors": [
        "Zakres techniki hotelowej z obsługą oraz lista funkcji, które ma uzupełnić MAVINCI.",
        "Liczba sal pracujących równocześnie i czas pracy realizatorów w każdej z nich.",
        "LED do sceny głównej, telewizory w dodatkowych strefach lub totemy informacyjne.",
        "Transmisje i nagrania: liczba sesji, kamer oraz połączeń zdalnych.",
        "Dostęp do sali dzień wcześniej, liczba dni wydarzenia, transport do Mikołajek i demontaż.",
        "Przebudowa sali na bankiet lub osobny zestaw do części wieczornej i plenerowej."
      ],
      "partnership": "Możesz zlecić nam technikę, zachowując własną umowę z hotelem i pozostałymi wykonawcami. Dla agencji prowadzącej konferencję w Mikołajkach przygotowujemy zakres MAVINCI z podziałem na sale, urządzenia i pracę zespołu. Przed montażem uzgadniamy go z gospodarzem, a podczas wydarzenia realizujemy zatwierdzony program. Przykładowe hotele na stronie pomagają w planowaniu; nasze wykonane projekty są opisane oddzielnie w portfolio z rzeczywistą lokalizacją.",
      "serviceArea": {
        "heading": "Mikołajki i okolice — technika z dojazdem do obiektu",
        "description": "Przygotowujemy obsługę konferencji w Mikołajkach i dojeżdżamy także do obiektów w Rynie, Mrągowie, Giżycku oraz Rucianem-Nidzie. Dla hotelu położonego poza miastem podaj pełny adres i miejsce rozładunku, a nie tylko nazwę najbliższej miejscowości. Mapa pokazuje okolice Mikołajek jako obszar obsługi. Nasze biuro i magazyn znajdują się w Olsztynie przy Towarowej 20B.",
        "locations": [
          "Mikołajki",
          "Ryn",
          "Mrągowo",
          "Giżycko",
          "Ruciane-Nida"
        ]
      }
    },
    "faq": [
      {
        "question": "Co przesłać do wyceny konferencji hotelowej w Mikołajkach?",
        "answer": "Nazwę obiektu, listę i układ zarezerwowanych sal, agendę, liczbę uczestników oraz zakres sprzętu i obsługi dostępnych w hotelu. Dodaj godziny montażu, wymagania transmisji i program bankietu. Na tej podstawie możemy oddzielić uzupełnienie wyposażenia od pełnej realizacji MAVINCI."
      },
      {
        "question": "Czy hotelowe Wi-Fi wystarczy do transmisji konferencji?",
        "answer": "Nie można tego potwierdzić bez sprawdzenia warunków. Z technikiem obiektu w Mikołajkach uzgadniamy łącze dostępne dla realizacji i próbę transmisji. Liczba strumieni, udział prelegentów online oraz obciążenie sieci wpływają na potrzebny zakres przygotowania."
      },
      {
        "question": "Czy zapewniacie LED, telewizory i totemy do różnych stref hotelu?",
        "answer": "Tak, możemy uwzględnić ekran LED na scenie, telewizory w dodatkowych przestrzeniach i totemy z informacjami dla uczestników. Przed wyceną ustalamy miejsca instalacji, treść na każdym ekranie, zasilanie i sposób przekazania sygnału. Mamy ekrany LED do wnętrz i na zewnątrz; dobór zależy od warunków wydarzenia."
      }
    ]
  }
}
$profiles$::jsonb)
  LOOP
    UPDATE public.schema_org_page_metadata AS metadata
    SET custom_schema = COALESCE(metadata.custom_schema::jsonb, '{}'::jsonb) || jsonb_build_object(
      'conferenceContent', COALESCE(metadata.custom_schema::jsonb->'conferenceContent', '{}'::jsonb) || (profile->'content') || '{"version":2}'::jsonb,
      'faq',
        CASE WHEN jsonb_typeof(metadata.custom_schema::jsonb->'faq') = 'array' THEN metadata.custom_schema::jsonb->'faq' ELSE '[]'::jsonb END
        || COALESCE((SELECT jsonb_agg(new_faq.value) FROM jsonb_array_elements(profile->'faq') AS new_faq(value)
          WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(metadata.custom_schema::jsonb->'faq') = 'array' THEN metadata.custom_schema::jsonb->'faq' ELSE '[]'::jsonb END) AS existing(value)
            WHERE lower(btrim(existing.value->>'question')) = lower(btrim(new_faq.value->>'question'))
          )), '[]'::jsonb)
    ), updated_at = now()
    WHERE metadata.page_slug = 'oferta/konferencje/' || city_slug
      AND metadata.is_active = true
      AND metadata.custom_schema::jsonb->'conferenceContent'->>'version' = '1';
  END LOOP;
END;
$migration$;
