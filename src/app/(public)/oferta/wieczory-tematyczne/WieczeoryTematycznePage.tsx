import {
  Wine,
  CheckCircle2,
  Sparkles,
  Music,
  Camera,
  Utensils,
  Users,
  Palette,
  Star,
  Clock,
  Award,
  Heart,
} from 'lucide-react';
import Image from 'next/image';
import ThemedPartyGallery from './ThemedPartyGallery';

const themes = [
  {
    title: 'Wieczór w stylu Las Vegas',
    description:
      'Kasyno rozrywkowe, neonowe dekoracje, hostessy, dress code glamour. Stoły do ruletki, blackjacka i pokera. Muzyka lounge i koktajle.',
    keywords: 'impreza Las Vegas, wieczór kasynowy, event kasyno, impreza glamour',
    image: 'https://images.pexels.com/photos/787961/pexels-photo-787961.jpeg?auto=compress&cs=tinysrgb&w=600',
  },
  {
    title: 'Wieczór w klimacie PRL',
    description:
      'Dekoracje z epoki, plakaty propagandowe, bar mleczny, muzyka lat 60-80. Zabawy i konkursy w stylu retro. Dress code robotniczy lub dyskotekowy.',
    keywords: 'impreza PRL, wieczór retro, event lata 80, zabawa w stylu PRL',
    image: 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=600',
  },
  {
    title: 'Wieczór kryminalny - Murder Mystery',
    description:
      'Gra fabularna z rozwiązywaniem zagadki kryminalnej. Profesjonalni aktorzy, rekwizyty, scenografia detektywistyczna. Interaktywna zabawa dla zespołu.',
    keywords: 'murder mystery, wieczór kryminalny, gra detektywistyczna, zagadka kryminalna event',
    image: 'https://images.pexels.com/photos/5699456/pexels-photo-5699456.jpeg?auto=compress&cs=tinysrgb&w=600',
  },
  {
    title: 'Wieczór James Bond / Casino Royale',
    description:
      'Elegancki wieczór agentów. Stroje wieczorowe, koktajle, kasyno, pokazy kaskaderskie. Muzyka filmowa na żywo i pokaz Aston Martina.',
    keywords: 'impreza James Bond, wieczór Casino Royale, event szpiegowski, gala agentów',
    image: 'https://images.pexels.com/photos/2263436/pexels-photo-2263436.jpeg?auto=compress&cs=tinysrgb&w=600',
  },
  {
    title: 'Wieczór Gatsby / Lata 20.',
    description:
      'Szalone lata dwudzieste: art deco, frędzelki, charleston, jazz na żywo, bąbelki szampana. Prohibicja bar z koktajlami epoki.',
    keywords: 'impreza Gatsby, wieczór lat 20, event art deco, charleston party',
    image: 'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&w=600',
  },
  {
    title: 'Wieczór meksykański - Fiesta',
    description:
      'Kolorowe dekoracje, pinata, mariachi, tacos i margarita. Sombreros, kaktusy, papel picado. Taneczna atmosfera fiesty.',
    keywords: 'impreza meksykańska, wieczór fiesta, event meksyk, mexican party firmowa',
    image: 'https://images.pexels.com/photos/1267697/pexels-photo-1267697.jpeg?auto=compress&cs=tinysrgb&w=600',
  },
  {
    title: 'Wieczór hawajski - Aloha Party',
    description:
      'Tropikalne dekoracje, leje z kwiatów, tiki bar, koktajle egzotyczne. Taniec hula, konkurs limbo, muzyka reggae i chillout.',
    keywords: 'impreza hawajska, wieczór aloha, event tropikalny, hawaiian party',
    image: 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=600',
  },
  {
    title: 'Wieczór disco / lata 80.',
    description:
      'Kula dyskotekowa, neony, retro muzyka, karaoke. Dress code fluorescencyjny, konkursy taneczne. DJ z hitami lat 70-80.',
    keywords: 'impreza disco, wieczór lat 80, event retro disco, disco party firmowa',
    image: 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=600',
  },
  {
    title: 'Wieczór w stylu Hollywood',
    description:
      'Czerwony dywan, Oscary firmowe, paparazzi, fotobudka filmowa. Gala z wręczeniem nagród, oprawa jak na wielkim festiwalu.',
    keywords: 'impreza Hollywood, wieczór filmowy, gala oscarowa, event czerwony dywan',
    image: 'https://images.pexels.com/photos/1387174/pexels-photo-1387174.jpeg?auto=compress&cs=tinysrgb&w=600',
  },
  {
    title: 'Wieczór sportowy - Olimpiada firmowa',
    description:
      'Rywalizacja drużynowa w dyscyplinach sportowych i zabawowych. Ceremonia otwarcia, medale, hymn firmowy. Integracja przez sport.',
    keywords: 'olimpiada firmowa, event sportowy, wieczór sportowy, team building sport',
    image: 'https://images.pexels.com/photos/3621104/pexels-photo-3621104.jpeg?auto=compress&cs=tinysrgb&w=600',
  },
  {
    title: 'Wieczór w stylu włoskim - Dolce Vita',
    description:
      'Romantyczna atmosfera Włoch: wino, ser, oliwa. Muzyka italiana na żywo, dekoracje toskańskie, pokaz gotowania pasta.',
    keywords: 'impreza włoska, wieczór dolce vita, event italia, italian party firmowa',
    image: 'https://images.pexels.com/photos/1579739/pexels-photo-1579739.jpeg?auto=compress&cs=tinysrgb&w=600',
  },
  {
    title: 'Wieczór maskaradowy - Wenecja',
    description:
      'Maski weneckie, kostiumy karnawałowe, złoto i purpura. Muzyka barokowa, pokazy cyrkowe, tajemnicza atmosfera balu maskowego.',
    keywords: 'bal maskowy, wieczór wenecki, maskarada firmowa, karnawał wenecki event',
    image: 'https://images.pexels.com/photos/1283219/pexels-photo-1283219.jpeg?auto=compress&cs=tinysrgb&w=600',
  },
];

const process = [
  {
    step: 1,
    title: 'Konsultacja i wybór tematyki',
    description:
      'Omawiamy cel eventu, preferencje grupy i budżet. Dobieramy tematykę idealnie pasującą do okazji i charakteru zespołu.',
  },
  {
    step: 2,
    title: 'Projekt scenografii i oprawy',
    description:
      'Projektujemy kompletną scenografię, dekoracje, oświetlenie i elementy tematyczne. Przygotowujemy moodboard i wizualizacje.',
  },
  {
    step: 3,
    title: 'Planowanie atrakcji i programu',
    description:
      'Układamy program wieczoru: gry, animacje, pokazy, konkursy, występy. Dobieramy atrakcje pasujące do wybranej tematyki.',
  },
  {
    step: 4,
    title: 'Produkcja elementów i logistyka',
    description:
      'Produkujemy scenografię, zamawiamy rekwizyty, kostiumy, catering tematyczny. Koordynujemy dostawców i podwykonawców.',
  },
  {
    step: 5,
    title: 'Montaż i przygotowanie sali',
    description:
      'Montaż scenografii, dekoracji, oświetlenia, nagłośnienia. Przygotowanie stref tematycznych, barów, sceny i stref foto.',
  },
  {
    step: 6,
    title: 'Realizacja wieczoru tematycznego',
    description:
      'Profesjonalny konferansjer prowadzi event, technicy obsługują multimedia, animatorzy angażują gości. Ty cieszysz się imprezą.',
  },
];

const equipment = [
  {
    category: 'Scenografia i dekoracje',
    image: 'https://images.pexels.com/photos/1616113/pexels-photo-1616113.jpeg?auto=compress&cs=tinysrgb&w=600',
    items: [
      'Dekoracje tematyczne wielkoformatowe',
      'Elementy scenografii 3D i rzeźby',
      'Bramy wejściowe i portale tematyczne',
      'Tła fotograficzne i ścianki eventowe',
      'Meble tematyczne (lounge, bar, VIP)',
      'Rekwizyty i drobne elementy dekoracyjne',
    ],
  },
  {
    category: 'Oświetlenie i efekty',
    image: 'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=600',
    items: [
      'Oświetlenie architektoniczne LED RGB',
      'Moving heady i wash do efektów scenicznych',
      'Neony, lightboxy i elementy świetlne',
      'Maszyna do dymu i ciężki dym',
      'Konfetti, serpentyny i efekty pirotechniczne',
      'Projekcje mapping na ścianach i suficie',
    ],
  },
  {
    category: 'Nagłośnienie i multimedia',
    image: 'https://images.pexels.com/photos/1763067/pexels-photo-1763067.jpeg?auto=compress&cs=tinysrgb&w=600',
    items: [
      'System nagłośnienia PA profesjonalny',
      'DJ z oprawą muzyczną tematyczną',
      'Ekrany LED i projekcja multimedialna',
      'Mikrofony bezprzewodowe dla prowadzącego',
      'System karaoke z ekranami tekstu',
      'Oprawa muzyczna na żywo (zespół, soliści)',
    ],
  },
  {
    category: 'Atrakcje i animacje',
    image: 'https://images.pexels.com/photos/2747449/pexels-photo-2747449.jpeg?auto=compress&cs=tinysrgb&w=600',
    items: [
      'Fotobudka tematyczna z rekwizytami',
      'Kasyno rozrywkowe (ruletka, blackjack, poker)',
      'Pokazy artystyczne (taniec, akrobatyka, ogień)',
      'Caricaturzysta i portrecista na żywo',
      'Animatorzy i aktorzy kostiumowi',
      'Gry zespołowe i konkursy tematyczne',
    ],
  },
];

const benefits = [
  {
    icon: 'Sparkles',
    title: 'Autorskie koncepty tematyczne',
    description:
      'Nie korzystamy z gotowych schematów. Każdy wieczór tematyczny jest unikalnym projektem stworzonym specjalnie pod Twój event i grupę.',
  },
  {
    icon: 'Palette',
    title: 'Profesjonalna scenografia',
    description:
      'Własna pracownia scenograficzna z doświadczonymi dekoratorami. Tworzymy immersyjne środowiska, które przenoszą gości w inny świat.',
  },
  {
    icon: 'Music',
    title: 'Kompletna oprawa muzyczna',
    description:
      'DJ, zespół na żywo, soliści - dobieramy oprawę muzyczną idealnie pasującą do tematyki i klimatu wieczoru.',
  },
  {
    icon: 'Camera',
    title: 'Dokumentacja foto i video',
    description:
      'Profesjonalny fotograf i kamerzysta. Fotobudka tematyczna, slow motion booth, drony. Pamiątki z imprezy na lata.',
  },
  {
    icon: 'Utensils',
    title: 'Catering tematyczny',
    description:
      'Menu dopasowane do tematyki: meksykańskie, włoskie, amerykańskie, azjatyckie. Food trucki, stacje kulinarne, bary koktajlowe.',
  },
  {
    icon: 'Users',
    title: 'Zaangażowanie gości',
    description:
      'Animatorzy, aktorzy, prowadzący z doświadczeniem. Interaktywne gry, konkursy, pokazy. Każdy gość jest aktywnym uczestnikiem.',
  },
];

const faq = [
  {
    question: 'Ile osób może uczestniczyć w wieczorze tematycznym?',
    answer:
      'Organizujemy wieczory tematyczne od 20 do 2000 osób. Format i atrakcje dobieramy do wielkości grupy - od kameralnych kolacji tematycznych po wielkie bale firmowe i festiwale.',
  },
  {
    question: 'Jak wcześnie trzeba zarezerwować termin?',
    answer:
      'Optymalna rezerwacja to 4-8 tygodni przed eventem. Dla dużych projektów (500+ osób, niestandardowa scenografia) zalecamy 2-3 miesiące. W przypadku pilnych zleceń staramy się realizować nawet w 7-10 dni.',
  },
  {
    question: 'Czy goście muszą przygotować kostiumy?',
    answer:
      'Zależy od formatu. Możemy dostarczyć kompletne kostiumy i akcesoria dla wszystkich gości (w cenie), ustalić dress code z instrukcjami, lub przygotować tylko elementy (maski, kapelusze, okulary).',
  },
  {
    question: 'Czy organizujecie wieczory tematyczne na zewnątrz?',
    answer:
      'Tak - realizujemy eventy plenerowe z pełną infrastrukturą: namioty, podłogi, zasilanie, oświetlenie outdoor, nagrzewnice/klimatyzacja. Scenografia outdoorowa to nasza specjalność.',
  },
  {
    question: 'Jaki budżet potrzebny jest na wieczór tematyczny?',
    answer:
      'Budżet zależy od skali: kameralny wieczór (20-50 osób) od 8 000 zł, średni event firmowy (50-150 osób) od 20 000 zł, duża gala tematyczna (150-500 osób) od 50 000 zł. Każdy projekt wyceniamy indywidualnie.',
  },
  {
    question: 'Czy mogę wymyślić własną tematykę?',
    answer:
      'Oczywiście! Autorskie tematyki to nasza mocna strona. Realizowaliśmy: noc w muzeum, podróż w czasie, cyberpunk, Hogwart, piraci, dziki zachód, kosmos, podwodny świat. Jedynym ograniczeniem jest wyobraźnia.',
  },
  {
    question: 'Co jest potrzebne od klienta?',
    answer:
      'Potrzebujemy: datę, lokalizację (lub pomoc w wyborze), liczbę gości, orientacyjny budżet i preferowaną tematykę. Resztą zajmujemy się my - od projektu po demontaż.',
  },
  {
    question: 'Czy zajmujecie się też cateringiem i alkoholem?',
    answer:
      'Tak - koordynujemy catering tematyczny, bary koktajlowe, bary z alkoholem, food trucki i stacje kulinarne. Współpracujemy z najlepszymi cateringami lub działamy z rekomendowanym partnerem.',
  },
];

const occasions = [
  {
    title: 'Imprezy firmowe i integracyjne',
    description:
      'Wieczory tematyczne jako główna atrakcja integracji, spotkań rocznych, kickoff meetingów i wyjść firmowych.',
    keywords: 'impreza firmowa tematyczna, integracja tematyczna, event firmowy z motywem',
  },
  {
    title: 'Wigilie i kolacje firmowe',
    description:
      'Tematyczne spotkania świąteczne i karnawałowe. Zimowa kraina czarów, bal sylwestrowy, choinka z niespodziankami.',
    keywords: 'wigilia firmowa tematyczna, kolacja firmowa z tematem, bal karnawałowy firma',
  },
  {
    title: 'Gale i nagrody roczne',
    description:
      'Ceremonie wręczenia nagród w stylu Hollywood, Oscarów lub festiwali filmowych. Czerwony dywan i pełna oprawa galowa.',
    keywords: 'gala firmowa tematyczna, nagrody roczne event, ceremonia oscarowa firma',
  },
  {
    title: 'Jubileusze i rocznice',
    description:
      'Wieczory tematyczne z okazji jubileuszu firmy, okrągłych rocznic, kamieni milowych. Retrospektywa i podróż przez historię.',
    keywords: 'jubileusz firmowy event, rocznica firmy impreza, event jubileuszowy tematyczny',
  },
  {
    title: 'Premiery produktów i launch party',
    description:
      'Eventy premierowe z oprawą tematyczną. Scenografia nawiązująca do produktu, pokazy, reveal z efektami specjalnymi.',
    keywords: 'launch party, premiera produktu event, reveal party firma, event premierowy',
  },
  {
    title: 'Wieczory kawalerskie i panieńskie',
    description:
      'Tematyczne imprezy pożegnalne: Las Vegas, szalone lata 20., agentki specjalne, survival. Kompletna organizacja i atrakcje.',
    keywords: 'wieczór kawalerski tematyczny, panieński z motywem, impreza pożegnalna premium',
  },
];

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Sparkles,
  Palette,
  Music,
  Camera,
  Utensils,
  Users,
};

export default function WieczeoryTematycznePage() {
  return (
    <main className="min-h-screen bg-[#0f1119]">
      {/* Intro Section with image */}
      <section className="border-b border-[#d3bb73]/10 px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h2 className="mb-8 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                Wieczory tematyczne na eventy firmowe i prywatne
              </h2>
              <div className="space-y-6 text-lg leading-relaxed text-[#e5e4e2]/80">
                <p>
                  Organizujemy profesjonalne wieczory tematyczne, bale kostiumowe, imprezy z motywem
                  przewodnim i eventy scenograficzne dla firm i klientów indywidualnych w całej Polsce.
                  Tworzymy immersyjne doświadczenia, które przenoszą gości w inny świat.
                </p>
                <p>
                  Zapewniamy kompletną produkcję wieczoru tematycznego: scenografię, dekoracje,
                  oświetlenie, nagłośnienie, catering tematyczny, animacje, pokazy artystyczne i
                  profesjonalnego konferansjera.
                </p>
              </div>
            </div>
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[#d3bb73]/20">
              <Image
                src="https://images.pexels.com/photos/3171837/pexels-photo-3171837.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Wieczór tematyczny - profesjonalna oprawa imprezy firmowej z dekoracjami"
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
                priority
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119]/40 to-transparent" />
            </div>
          </div>
        </div>
      </section>

      {/* Themes Grid with images */}
      <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <h2 className="mb-4 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
            Popularne tematyki wieczorów
          </h2>
          <p className="mx-auto mb-12 max-w-3xl text-center text-[#e5e4e2]/60">
            Wybierz gotowy motyw lub stwórz z nami autorską tematykę dopasowaną do Twojego eventu
          </p>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {themes.map((theme, idx) => (
              <div
                key={idx}
                className="group overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#0f1119] transition-all duration-300 hover:border-[#d3bb73]/40 hover:shadow-lg hover:shadow-[#d3bb73]/5"
              >
                <div className="relative aspect-[16/9] overflow-hidden">
                  <Image
                    src={theme.image}
                    alt={theme.title}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-110"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] via-[#0f1119]/20 to-transparent" />
                </div>
                <div className="p-5">
                  <h3 className="mb-2 text-lg font-medium text-[#d3bb73]">{theme.title}</h3>
                  <p className="text-sm leading-relaxed text-[#e5e4e2]/70">{theme.description}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-8 text-center text-sm text-[#e5e4e2]/50">
            ...oraz dziesiątki innych tematyk: wieczór w stylu mafii, noc w muzeum, podróż
            dookoła świata, piraci Karaibów, Star Wars, medieval feast, winter wonderland,
            noc w dżungli, lata 90., Bollywood party, noc agentów, disco polo retro i wiele
            więcej.
          </p>
        </div>
      </section>

      {/* Gallery Section */}
      <ThemedPartyGallery images={[]} />

      {/* Occasions Section with banner image */}
      <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 overflow-hidden rounded-2xl border border-[#d3bb73]/15">
            <div className="relative h-48 w-full md:h-64">
              <Image
                src="https://images.pexels.com/photos/2608517/pexels-photo-2608517.jpeg?auto=compress&cs=tinysrgb&w=1200"
                alt="Eventy firmowe i imprezy tematyczne - organizacja wieczorów dla firm"
                fill
                sizes="100vw"
                className="object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#0f1119]/80 via-[#0f1119]/50 to-[#0f1119]/80" />
              <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
                <h2 className="text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
                  Na jakie okazje organizujemy wieczory tematyczne
                </h2>
                <p className="mt-4 max-w-3xl text-center text-[#e5e4e2]/70">
                  Wieczór tematyczny sprawdzi się na każdej imprezie - od kameralnej kolacji po
                  wielką galę
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {occasions.map((occasion, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-[#d3bb73]/15 bg-[#0f1119]/50 p-6"
              >
                <h3 className="mb-3 text-lg font-medium text-[#e5e4e2]">{occasion.title}</h3>
                <p className="text-sm leading-relaxed text-[#e5e4e2]/60">
                  {occasion.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="border-b border-[#d3bb73]/10 px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
            Dlaczego warto wybrać nasze wieczory tematyczne
          </h2>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {benefits.map((benefit, idx) => {
              const IconComp = iconMap[benefit.icon] || Sparkles;
              return (
                <div key={idx} className="flex gap-4">
                  <div className="flex-shrink-0">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#d3bb73]/10">
                      <IconComp className="h-6 w-6 text-[#d3bb73]" />
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-1 font-medium text-[#e5e4e2]">{benefit.title}</h3>
                    <p className="text-sm leading-relaxed text-[#e5e4e2]/60">
                      {benefit.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Equipment Section with images */}
      <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <h2 className="mb-4 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
            Co dostarczamy na wieczór tematyczny
          </h2>
          <p className="mx-auto mb-12 max-w-3xl text-center text-[#e5e4e2]/60">
            Kompletna produkcja imprezy tematycznej - od scenografii po demontaż
          </p>

          <div className="grid gap-8 md:grid-cols-2">
            {equipment.map((group, idx) => (
              <div
                key={idx}
                className="overflow-hidden rounded-xl border border-[#d3bb73]/15 bg-[#0f1119]/50"
              >
                <div className="relative h-40 w-full">
                  <Image
                    src={group.image}
                    alt={group.category}
                    fill
                    sizes="(max-width: 768px) 100vw, 50vw"
                    className="object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] to-[#0f1119]/30" />
                  <h3 className="absolute bottom-4 left-6 text-xl font-medium text-[#d3bb73]">
                    {group.category}
                  </h3>
                </div>
                <div className="p-6 pt-4">
                  <ul className="space-y-2">
                    {group.items.map((item, itemIdx) => (
                      <li key={itemIdx} className="flex items-start gap-2 text-[#e5e4e2]/80">
                        <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#d3bb73]" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Showcase image divider */}
      <section className="border-b border-[#d3bb73]/10">
        <div className="relative h-64 w-full md:h-80">
          <Image
            src="https://images.pexels.com/photos/2747449/pexels-photo-2747449.jpeg?auto=compress&cs=tinysrgb&w=1200"
            alt="Oprawa artystyczna wieczoru tematycznego - pokazy i animacje eventowe"
            fill
            sizes="100vw"
            className="object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-[#0f1119]/60" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-2xl font-light text-[#e5e4e2] md:text-3xl">
                Tworzymy niezapomniane doświadczenia
              </p>
              <p className="mt-3 text-[#d3bb73]">Od koncepcji po realizację</p>
            </div>
          </div>
        </div>
      </section>

      {/* Process Section */}
      <section className="border-b border-[#d3bb73]/10 px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
            Jak organizujemy wieczór tematyczny
          </h2>

          <div className="relative">
            <div className="absolute bottom-0 left-6 top-0 w-px bg-[#d3bb73]/20 md:left-1/2" />

            <div className="space-y-12">
              {process.map((item, idx) => (
                <div key={idx} className="relative flex gap-6 md:items-center md:gap-12">
                  <div className="relative z-10 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border-2 border-[#d3bb73] bg-[#0f1119] text-lg font-bold text-[#d3bb73]">
                    {item.step}
                  </div>
                  <div className="flex-1 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-5">
                    <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">{item.title}</h3>
                    <p className="text-sm leading-relaxed text-[#e5e4e2]/70">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
            Wieczory tematyczne w liczbach
          </h2>
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <div className="rounded-xl border border-[#d3bb73]/20 bg-[#0f1119]/50 p-6 text-center">
              <Award className="mx-auto mb-3 h-8 w-8 text-[#d3bb73]" />
              <div className="text-3xl font-bold text-[#d3bb73]">500+</div>
              <p className="mt-2 text-sm text-[#e5e4e2]/60">Zrealizowanych wieczorów tematycznych</p>
            </div>
            <div className="rounded-xl border border-[#d3bb73]/20 bg-[#0f1119]/50 p-6 text-center">
              <Users className="mx-auto mb-3 h-8 w-8 text-[#d3bb73]" />
              <div className="text-3xl font-bold text-[#d3bb73]">50 000+</div>
              <p className="mt-2 text-sm text-[#e5e4e2]/60">Zadowolonych uczestników imprez</p>
            </div>
            <div className="rounded-xl border border-[#d3bb73]/20 bg-[#0f1119]/50 p-6 text-center">
              <Star className="mx-auto mb-3 h-8 w-8 text-[#d3bb73]" />
              <div className="text-3xl font-bold text-[#d3bb73]">40+</div>
              <p className="mt-2 text-sm text-[#e5e4e2]/60">Gotowych tematyk do wyboru</p>
            </div>
            <div className="rounded-xl border border-[#d3bb73]/20 bg-[#0f1119]/50 p-6 text-center">
              <Clock className="mx-auto mb-3 h-8 w-8 text-[#d3bb73]" />
              <div className="text-3xl font-bold text-[#d3bb73]">12 lat</div>
              <p className="mt-2 text-sm text-[#e5e4e2]/60">Doświadczenia w eventach tematycznych</p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="border-b border-[#d3bb73]/10 px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
            Najczęściej zadawane pytania o wieczory tematyczne
          </h2>

          <div className="space-y-4">
            {faq.map((item, idx) => (
              <details
                key={idx}
                className="group rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]/50 transition-colors open:border-[#d3bb73]/30"
              >
                <summary className="cursor-pointer list-none px-6 py-5 text-[#e5e4e2] transition-colors hover:text-[#d3bb73]">
                  <div className="flex items-center justify-between">
                    <span className="pr-4 font-medium">{item.question}</span>
                    <span className="flex-shrink-0 text-[#d3bb73] transition-transform group-open:rotate-45">
                      +
                    </span>
                  </div>
                </summary>
                <div className="border-t border-[#d3bb73]/10 px-6 py-4">
                  <p className="leading-relaxed text-[#e5e4e2]/70">{item.answer}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Keywords-rich text section with image */}
      <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[#d3bb73]/15">
              <Image
                src="https://images.pexels.com/photos/2306281/pexels-photo-2306281.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Profesjonalne oświetlenie i efekty specjalne na imprezach tematycznych"
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
                loading="lazy"
              />
            </div>
            <div>
              <h2 className="mb-8 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                Profesjonalna organizacja imprez tematycznych
              </h2>
              <div className="space-y-5 text-base leading-relaxed text-[#e5e4e2]/70">
                <p>
                  Specjalizujemy się w organizacji wieczorów tematycznych dla firm, korporacji,
                  agencji eventowych i klientów indywidualnych. Nasze imprezy z motywem przewodnim
                  to kompletne doświadczenia sensoryczne - od scenografii i dekoracji, przez muzykę
                  i oświetlenie, po catering tematyczny i animacje angażujące wszystkich gości.
                </p>
                <p>
                  Realizujemy eventy tematyczne na terenie całej Polski - w hotelach, salach
                  bankietowych, restauracjach, loftach, plenerach i nietypowych lokalizacjach.
                  Dysponujemy własnym magazynem scenografii, pracownią dekoratorską i zespołem
                  techników.
                </p>
                <p>
                  Każdy wieczór tematyczny to autorski projekt - nie korzystamy z gotowych
                  schematów. Nasz zespół scenografów, dekoratorów, reżyserów eventowych i
                  producentów tworzy unikalne koncepty dopasowane do charakteru firmy, okazji
                  i oczekiwań klienta.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-4xl rounded-2xl border border-[#d3bb73]/30 bg-gradient-to-br from-[#1c1f33] to-[#0f1119] p-12 text-center">
          <Wine className="mx-auto mb-6 h-12 w-12 text-[#d3bb73]" />
          <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
            Zaplanujmy Twój wieczór tematyczny!
          </h2>
          <p className="mx-auto mb-8 max-w-2xl text-lg text-[#e5e4e2]/70">
            Skontaktuj się z nami - przygotujemy koncepcję wieczoru tematycznego dopasowaną
            do Twojej okazji, grupy i budżetu. Bezpłatna konsultacja i wstępna wycena w 48h.
          </p>

          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <a
              href="/#kontakt"
              className="rounded-lg bg-[#d3bb73] px-8 py-3.5 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              Zapytaj o wycene
            </a>
            <a
              href="tel:+48123456789"
              className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 px-6 py-3.5 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
            >
              <Heart className="h-4 w-4" />
              Bezplatna konsultacja
            </a>
          </div>

          <div className="mt-10 flex flex-wrap justify-center gap-6 text-sm text-[#e5e4e2]/50">
            <span>Autorskie koncepty</span>
            <span className="text-[#d3bb73]/30">|</span>
            <span>Wlasna scenografia</span>
            <span className="text-[#d3bb73]/30">|</span>
            <span>Cala Polska</span>
            <span className="text-[#d3bb73]/30">|</span>
            <span>Od 20 do 2000 osob</span>
          </div>
        </div>
      </section>
    </main>
  );
}
