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
    category: 'Scenografia i dekoracje',
    items: [
      'Meble tematyczne i rekwizyty epokowe',
      'Ścianki dekoracyjne i bramy wejściowe',
      'Scenografia LED i neony tematyczne',
      'Oświetlenie architektoniczne i ambient',
      'Tkaniny, zasłony, baldachimy',
    ],
  },
  {
    category: 'Technika eventowa',
    items: [
      'Nagłośnienie i systemy audio',
      'Oświetlenie inteligentne DMX',
      'Maszyny do dymu i efekty specjalne',
      'Projektory i mapping 3D',
      'Ekrany LED i telebimy',
    ],
  },
  {
    category: 'Atrakcje i animacje',
    items: [
      'Stoły kasynowe (ruletka, blackjack, poker)',
      'Rodeo mechaniczne i symulatory',
      'Fotobudki tematyczne z rekwizytami',
      'Automaty do gier retro',
      'Strzelnice i gry zręcznościowe',
    ],
  },
  {
    category: 'Obsługa artystyczna',
    items: [
      'Aktorzy i performerzy tematyczni',
      'Zespoły muzyczne live',
      'DJ z repertuarem epokowym',
      'Tancerze i showgirls',
      'Konferansjer / prowadzący wieczoru',
    ],
  },
];

export default function ThemedPartyCityEquipment({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.equipment_heading ||
    `Co zapewniamy na wieczór tematyczny ${prep} ${capitalize(cityCases.locative)}`;

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
          Kompleksowa realizacja - przywozimy wszystko, co potrzebne do stworzenia idealnej atmosfery
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
