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
    title: 'Konsultacja i brief',
    description:
      'Omawiamy cel imprezy, liczbę gości, budżet i preferencje. Dobieramy odpowiednią liczbę stołów i atrakcji do przestrzeni i grupy.',
  },
  {
    step: 2,
    title: 'Dobór gier i scenariusz',
    description:
      'Projektujemy program wieczoru kasynowego: kolejność gier, turnieje, przerwy, ceremonia nagród. Planujemy rozkład stołów w sali.',
  },
  {
    step: 3,
    title: 'Personalizacja i branding',
    description:
      'Przygotowujemy spersonalizowane żetony, banknoty, koło fortuny z nagrodami klienta. Projektujemy dekoracje i oprawę graficzną.',
  },
  {
    step: 4,
    title: 'Transport i montaż',
    description:
      'Dostarczamy stoły i wyposażenie na miejsce. Montaż, rozkład stołów, dekoracje, oświetlenie. Czas setup: 2-4h w zależności od skali.',
  },
  {
    step: 5,
    title: 'Wieczór kazynowy',
    description:
      'Krupierzy prowadzą gry, hostessy witają gości żetonami. Muzyka lounge, oświetlenie sceniczne. Turnieje i rywalizacja o nagrody.',
  },
  {
    step: 6,
    title: 'Ceremonia nagród i demontaż',
    description:
      'Podsumowanie wyników, ranking graczy, wręczenie nagród najlepszym. Pamiątkowe zdjęcia. Sprawny demontaż po zakończeniu eventu.',
  },
];

export default function CasinoCityProcess({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.process_heading || `Jak organizujemy kasyno ${prep} ${capitalize(cityCases.locative)}`;

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
