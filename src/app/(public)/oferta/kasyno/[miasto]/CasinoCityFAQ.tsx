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
    question: 'Czy to legalne kasyno z prawdziwymi pieniędzmi?',
    answer:
      'Nie - to kasyno rozrywkowe (fun casino). Uczestnicy grają na żetony bez wartości pieniężnej. Rywalizują o nagrody rzeczowe lub symboliczne. Nie wymaga to żadnych koncesji ani zezwoleń.',
  },
  {
    question: 'Ile stołów potrzebuję na event?',
    answer:
      'Rekomendujemy 1 stół na 15-20 gości. Dla 100 osób to zwykle 5-6 stołów (2x ruletka, 2x blackjack, 1x poker, 1x koło fortuny). Dobieramy optymalną liczbę po konsultacji.',
  },
  {
    question: 'Czy goście muszą znać zasady gier?',
    answer:
      'Nie - nasi krupierzy profesjonalnie uczą zasad każdej gry. Pierwsze 15-20 minut to nauka i rozgrzewka. Większość gości łapie zasady po 2-3 rozdaniach. Format jest dostosowany do osób bez doświadczenia.',
  },
  {
    question: 'Jak dużo miejsca potrzebuję na kasyno?',
    answer:
      'Jeden stół do gier wymaga około 10-12m2 powierzchni (z miejscem dla graczy). Dla 5 stołów potrzeba minimum 60-80m2. Możemy dostosować układ do nietypowych pomieszczeń.',
  },
  {
    question: 'Czy można spersonalizować kasyno pod firmę?',
    answer:
      'Tak - oferujemy żetony z logo, banknoty zabawowe z twarzami pracowników, koło fortuny z nagrodami klienta, dekoracje w kolorach firmy, branding na stołach. Pełna personalizacja w cenie.',
  },
  {
    question: 'Jak długo trwa typowy wieczór kazynowy?',
    answer:
      'Optymalna długość to 2-3 godziny gry. Z montażem i demontażem rezerwujemy 5-6h. Możemy realizować także krótsze sesje (np. 1.5h w ramach gali) lub dłuższe eventy wielogodzinne.',
  },
  {
    question: 'Co jest potrzebne od klienta?',
    answer:
      'Tylko sala z dostępem min. 2h przed eventem i zasilaniem 230V. My dostarczamy wszystko: stoły, żetony, dekoracje, oświetlenie, krupierów, muzykę. Opcjonalnie - nagrody do koła fortuny.',
  },
];

export default function CasinoCityFAQ({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  const faq =
    content?.faq_json && Array.isArray(content.faq_json) && content.faq_json.length > 0
      ? content.faq_json
      : defaultFAQ;

  return (
    <section className="border-b border-[#d3bb73]/10 px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          Najczesciej zadawane pytania o kasyno rozrywkowe {prep} {capitalize(cityCases.locative)}
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
