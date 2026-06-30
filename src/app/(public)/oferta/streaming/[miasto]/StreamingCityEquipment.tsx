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
    category: 'Kamery',
    items: [
      'Sony FX6 / FX9 (Cinema 4K)',
      'Blackmagic URSA Mini Pro 12K',
      'Kamery PTZ z zdalnym sterowaniem',
      'Gimbal DJI RS4 Pro',
      'Obiektywy stałoogniskowe i zoom',
    ],
  },
  {
    category: 'Miksery wizji',
    items: [
      'Blackmagic ATEM Constellation 8K',
      'Roland V-160HD',
      'Blackmagic ATEM Mini Extreme ISO',
      'Tricaster TC1',
      'vMix Software (backup)',
    ],
  },
  {
    category: 'Streaming i enkodery',
    items: [
      'Teradek Prism / Cube',
      'LiveU Solo / LU800',
      'Enkodery NDI|HX3',
      'Bonding 4G/5G z 4 kartami SIM',
      'Dedykowane łącze fiber backup',
    ],
  },
  {
    category: 'Wyświetlanie obrazu',
    items: [
      'Ściany LED P1.9 / P2.6 / P3.9',
      'Telebimy outdoor P5.9',
      'Projektory laserowe 10.000+ lm',
      'Ekrany projekcyjne do 6m',
      'Monitory referencyjne 4K HDR',
    ],
  },
];

export default function StreamingCityEquipment({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.equipment_heading ||
    `Sprzęt, który przywozimy ${prep} ${capitalize(cityCases.locative)}`;

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
          Własny park sprzętowy - nie wynajmujemy, przywozimy gotowe rozwiązania produkcyjne
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
