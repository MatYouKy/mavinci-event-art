import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

const defaultEquipment = [
  {
    category: 'System quizowy',
    items: [
      'Buzzery bezprzewodowe (do 20 stanowisk)',
      'System głosowania na smartfonach (do 500 osób)',
      'Tablice wyników LED z rankingiem live',
      'Pulpity uczestników z podświetleniem',
      'Timer i countdown na ekranie',
    ],
  },
  {
    category: 'Multimedia i ekrany',
    items: [
      'Ściany LED P2.6 / P3.9 (pytania i wyniki)',
      'Monitory dla prowadzącego i uczestników',
      'System prezentacji z animacjami',
      'Kamery i realizacja na ekran live',
      'Oprawa graficzna w stylu TV show',
    ],
  },
  {
    category: 'Nagłośnienie i oświetlenie',
    items: [
      'System PA konferencyjny / koncertowy',
      'Mikrofony bezprzewodowe (prowadzący + uczestnicy)',
      'Oświetlenie sceniczne i efektowe',
      'Moving heady i wash (atmosfera show)',
      'Podświetlenie stanowisk drużyn',
    ],
  },
  {
    category: 'Scenografia i rekwizyty',
    items: [
      'Scenografia studyjna teleturnieju',
      'Podesty i pulpity dla drużyn',
      'Dekoracje tematyczne (PRL, kryminalne, filmowe)',
      'Rekwizyty i kostiumy do gier',
      'Nagrody i trofea dla zwycięzców',
    ],
  },
];

export default function QuizCityEquipment({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.equipment_heading ||
    `Co dostarczamy na event ${prep} ${capitalize(cityCases.locative)}`;

  const equipment =
    content?.equipment_json && Array.isArray(content.equipment_json) && content.equipment_json.length > 0
      ? content.equipment_json
      : defaultEquipment;

  return (
    <section className="border-b border-[#d3bb73]/10 px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-4 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          {heading}
        </h2>
        <p className="mx-auto mb-12 max-w-3xl text-center text-[#e5e4e2]/60">
          Kompletna produkcja teleturnieju - przywozimy wszystko, co potrzebne do profesjonalnego show
        </p>

        <div className="grid gap-8 md:grid-cols-2">
          {equipment.map((group: any, idx: number) => (
            <div
              key={idx}
              className="rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33]/50 p-6"
            >
              <h3 className="mb-4 border-b border-[#d3bb73]/20 pb-3 text-xl font-medium text-[#d3bb73]">
                {group.category}
              </h3>
              <ul className="space-y-2">
                {(group.items || []).map((item: string, itemIdx: number) => (
                  <li
                    key={itemIdx}
                    className="flex items-start gap-2 text-[#e5e4e2]/80"
                  >
                    <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#d3bb73]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
