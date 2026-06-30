import { CheckCircle } from 'lucide-react';
import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

const defaultBenefits = [
  {
    title: 'Autorskie formaty rozrywkowe',
    description:
      'Tworzymy unikalne scenariusze quizów i gier dopasowane do firmy, branży i okazji. Każdy event jest inny i niepowtarzalny.',
  },
  {
    title: 'Prowadzący z doświadczeniem TV',
    description:
      'Profesjonalni showmani i konferansjerzy z doświadczeniem telewizyjnym. Energetyczni, zabawni, potrafią animować każdą grupę.',
  },
  {
    title: 'Produkcja na poziomie TV',
    description:
      'Scenografia, oświetlenie, nagłośnienie i multimedia jak w prawdziwym studiu telewizyjnym. Efekt WOW gwarantowany.',
  },
  {
    title: 'Skalowalność 10-500 osób',
    description:
      'Formaty działające zarówno dla kameralnych zespołów, jak i wielkich eventów korporacyjnych. Dostosowujemy mechanikę do liczby uczestników.',
  },
  {
    title: 'Personalizacja pytań i tematów',
    description:
      'Pytania o firmie, produktach, branży, wewnętrznych żartach. Integrujemy wiedzę firmową z popkulturą i rozrywką.',
  },
  {
    title: 'Kompleksowa organizacja',
    description:
      'Od scenariusza po demontaż - zajmujemy się wszystkim. Ty cieszysz się eventem razem z zespołem, my dbamy o technikę i przebieg.',
  },
];

export default function QuizCityBenefits({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.benefits_heading ||
    `Dlaczego warto wybrać nas ${prep} ${capitalize(cityCases.locative)}`;

  const benefits =
    content?.benefits_json && Array.isArray(content.benefits_json) && content.benefits_json.length > 0
      ? content.benefits_json
      : defaultBenefits;

  return (
    <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          {heading}
        </h2>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {benefits.map((benefit: any, idx: number) => (
            <div key={idx} className="flex gap-4">
              <div className="flex-shrink-0">
                <CheckCircle className="h-6 w-6 text-[#d3bb73]" />
              </div>
              <div>
                <h3 className="mb-1 font-medium text-[#e5e4e2]">{benefit.title}</h3>
                <p className="text-sm leading-relaxed text-[#e5e4e2]/60">{benefit.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
