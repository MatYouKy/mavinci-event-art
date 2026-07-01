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
    question: 'Ile osob moze wziac udzial w integracji?',
    answer: 'Realizujemy integracje od 10 do 500+ osob. Dostosowujemy format, liczbe animatorow i atrakcji do wielkosci grupy.',
  },
  {
    question: 'Jak wczesnie trzeba zarezerwowac termin?',
    answer: 'Rekomendujemy rezerwacje min. 3-4 tygodnie wczesniej. Dla duzych projektow zalecamy 2-3 miesiace. W trybie ekspresowym realizujemy w 7 dni.',
  },
  {
    question: 'Czy organizujecie integracje na zewnatrz i wewnatrz?',
    answer: 'Tak - mamy scenariusze outdoor, indoor i hybrydowe. Dla eventow outdoor zawsze przygotowujemy plan B na wypadek zlej pogody.',
  },
  {
    question: 'Co jest potrzebne od klienta?',
    answer: 'Potrzebujemy: date, lokalizacje lub preferencje, liczbe uczestnikow, orientacyjny budzet i cele integracji. Reszte zajmujemy sie my.',
  },
  {
    question: 'Jaki budzet potrzebny jest na integracje?',
    answer: 'Budzet zalezy od formatu: integracja 20-50 osob od 5 000 zl, sredni event 50-150 osob od 12 000 zl, duze projekty wyceniamy indywidualnie.',
  },
  {
    question: 'Czy zapewniacie transport i catering?',
    answer: 'Koordynujemy catering, transport i logistyke eventowa. Mozemy tez zorganizowac nocleg dla uczestnikow w przypadku eventow wielodniowych.',
  },
  {
    question: 'Czy mozna laczyc rozne formaty integracji?',
    answer: 'Tak! Popularne polaczenia to np. gra terenowa + wieczor firmowy, warsztaty + olimpiada, escape room + kolacja integracyjna.',
  },
];

export default function IntegrationsCityFAQ({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  const faq =
    content?.faq_json && Array.isArray(content.faq_json) && content.faq_json.length > 0
      ? content.faq_json
      : defaultFAQ;

  return (
    <section className="border-b border-[#d3bb73]/10 px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          Najczesciej zadawane pytania o integracje {prep} {capitalize(cityCases.locative)}
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
