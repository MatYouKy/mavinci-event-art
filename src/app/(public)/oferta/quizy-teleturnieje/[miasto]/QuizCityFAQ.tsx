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
    question: 'Dla ilu osób można zorganizować quiz?',
    answer:
      'Nasze formaty działają od 10 do 500 osób. Dla mniejszych grup (10-30) sprawdzają się teleturnieje z buzzerami, dla średnich (30-100) quizy drużynowe, a dla dużych (100-500) quizy na smartfonach z rankingiem live.',
  },
  {
    question: 'Jakie formaty teleturniejów oferujecie?',
    answer:
      'Mamy w repertuarze: Familiadę, Milionerów, Jeopardy, Jeden z Dziesięciu, Koło Fortuny, Postaw na Milion, Zgadnij Melodię, a także autorskie formaty łączące elementy kilku programów. Każdy format dostosowujemy do grupy.',
  },
  {
    question: 'Czy można personalizować pytania?',
    answer:
      'Tak, to nasz standard! Pytania tworzymy od zera - o firmie, produktach, branży, wewnętrznych żartach zespołu. Mieszamy je z pytaniami z popkultury, sportu i wiedzy ogólnej, aby każdy uczestnik miał szansę.',
  },
  {
    question: 'Czy zapewniacie prowadzącego?',
    answer:
      'Tak. Nasi prowadzący mają doświadczenie telewizyjne i sceniczne. Są energetyczni, zabawni i potrafią animować każdą grupę - od integracji firmowej po gale i bankiety. Prowadzący dostępni w języku polskim i angielskim.',
  },
  {
    question: 'Ile trwa typowy teleturniej?',
    answer:
      'Standardowy format to 60-90 minut czystej gry. Z montażem, rozgrzewką i ceremonią nagród - około 2-2.5h. Możemy też przygotować krótsze rundy (30 min) jako element większego eventu.',
  },
  {
    question: 'Czy potrzebna jest specjalna lokalizacja?',
    answer:
      'Nie. Przywozimy cały sprzęt i scenografię - działamy w hotelach, salach konferencyjnych, restauracjach, plenerze. Potrzebujemy jedynie zasilania 230V i minimalnej przestrzeni 6x4m na scenę.',
  },
  {
    question: 'Czy organizujecie quizy online/hybrydowe?',
    answer:
      'Tak. Mamy platformę do quizów online z transmisją live prowadzącego. Uczestnicy zdalni grają na smartfonach i widzą ranking na żywo. Idealne dla rozproszonych zespołów i eventów hybrydowych.',
  },
];

export default function QuizCityFAQ({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  const faq =
    content?.faq_json && Array.isArray(content.faq_json) && content.faq_json.length > 0
      ? content.faq_json
      : defaultFAQ;

  return (
    <section className="border-b border-[#d3bb73]/10 px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          Najczesciej zadawane pytania o quizy {prep} {capitalize(cityCases.locative)}
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
