import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

const defaultProcess = [
  {
    step: 1,
    title: 'Brief i dobór formatu',
    description:
      'Omawiamy cel eventu, liczebność grupy, profil uczestników i budżet. Proponujemy najlepszy format quizu lub teleturnieju.',
  },
  {
    step: 2,
    title: 'Scenariusz i personalizacja',
    description:
      'Tworzymy autorski scenariusz z pytaniami dopasowanymi do firmy i okazji. Przygotowujemy oprawę graficzną i multimedia.',
  },
  {
    step: 3,
    title: 'Przygotowanie techniczne',
    description:
      'Konfigurujemy system quizowy, buzzery, ekrany, nagłośnienie i oświetlenie. Testujemy cały setup przed eventem.',
  },
  {
    step: 4,
    title: 'Montaż i soundcheck',
    description:
      'Montaż scenografii, ustawienie stanowisk drużyn, kalibracja systemów. Próba z prowadzącym i test techniczny.',
  },
  {
    step: 5,
    title: 'Realizacja show',
    description:
      'Prowadzący prowadzi event, technicy obsługują multimedia i efekty. Pełna energia i zabawa - Ty cieszysz się razem z grupą.',
  },
  {
    step: 6,
    title: 'Wręczenie nagród i demontaż',
    description:
      'Ceremonia wręczenia nagród, pamiątkowe zdjęcia, podsumowanie wyników. Sprawny demontaż po zakończeniu eventu.',
  },
];

export default function QuizCityProcess({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.process_heading || `Jak organizujemy teleturniej ${prep} ${capitalize(cityCases.locative)}`;

  const process =
    content?.process_json && Array.isArray(content.process_json) && content.process_json.length > 0
      ? content.process_json
      : defaultProcess;

  return (
    <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          {heading}
        </h2>

        <div className="relative">
          <div className="absolute bottom-0 left-6 top-0 w-px bg-[#d3bb73]/20 md:left-1/2" />

          <div className="space-y-12">
            {process.map((item: any, idx: number) => (
              <div
                key={idx}
                className="relative flex gap-6 md:items-center md:gap-12"
              >
                <div className="relative z-10 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border-2 border-[#d3bb73] bg-[#0f1119] text-lg font-bold text-[#d3bb73]">
                  {item.step || idx + 1}
                </div>
                <div className="flex-1 rounded-xl border border-[#d3bb73]/10 bg-[#0f1119] p-5">
                  <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-[#e5e4e2]/70">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
