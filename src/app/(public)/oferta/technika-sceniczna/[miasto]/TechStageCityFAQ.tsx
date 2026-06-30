import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

const defaultFAQ = [
  {
    question: 'Jakie systemy nagłośnienia oferujecie?',
    answer:
      'Pracujemy na systemach liniowych L-Acoustics (KARA II, A15), d&b audiotechnik (V-Series, Y-Series) oraz JBL VTX. Dobieramy system do wielkości wydarzenia i charakterystyki akustycznej pomieszczenia - od 50 do 50 000 osób.',
  },
  {
    question: 'Czy zapewniacie oświetlenie na eventy plenerowe?',
    answer:
      'Tak, posiadamy kompletne zestawy oświetlenia outdoorowego z klasą ochrony IP65. Moving heady, wash, blinder i efekty specjalne przystosowane do pracy na zewnątrz. Dysponujemy również generatorami i UPS-ami.',
  },
  {
    question: 'Jak duże ekrany LED możecie dostarczyć?',
    answer:
      'Realizujemy ściany LED od 4m2 do ponad 200m2. Pixel pitch od 1.9mm (prezentacje, konferencje) do 5.9mm (outdoor, koncerty). Montaż w dowolnej konfiguracji - prostej, łukowej, podwieszanej.',
  },
  {
    question: 'Czy budujecie sceny mobilne?',
    answer:
      'Tak. Dysponujemy scenami mobilnymi od 6x4m do 16x12m z pełnym zadaszeniem. Podesty sceniczne, schody, barierki, rampy dla niepełnosprawnych. Montaż w 4-8h w zależności od rozmiaru.',
  },
  {
    question: 'Jakie certyfikaty posiada wasz zespół?',
    answer:
      'Nasi technicy posiadają uprawnienia UDT do obsługi urządzeń do podnoszenia, certyfikaty riggerskie (PLASA), szkolenia z pracy na wysokości, certyfikaty producentów sprzętu (L-Acoustics, MA Lighting, Robe).',
  },
  {
    question: 'Ile czasu potrzebujecie na montaż?',
    answer:
      'Zależy od skali: mały event konferencyjny to 3-4h, średni event korporacyjny to 6-8h, duży koncert to 1-2 dni montażu. Zawsze planujemy soundcheck minimum 2h przed otwarciem drzwi.',
  },
  {
    question: 'Czy obsługujecie eventy wielodniowe i festiwale?',
    answer:
      'Tak, specjalizujemy się w obsłudze festiwali i eventów wielodniowych. Zapewniamy zmianowy grafik techników, serwis 24/7, magazyn zapasowego sprzętu na miejscu i pełną koordynację techniczną.',
  },
];

export default function TechStageCityFAQ({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  const faq =
    content?.faq_json && Array.isArray(content.faq_json) && content.faq_json.length > 0
      ? content.faq_json
      : defaultFAQ;

  return (
    <section className="border-b border-[#d3bb73]/10 px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          Najczesciej zadawane pytania o technike sceniczna {prep} {capitalize(cityCases.locative)}
        </h2>

        <div className="space-y-4">
          {faq.map((item: any, idx: number) => (
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
  );
}
