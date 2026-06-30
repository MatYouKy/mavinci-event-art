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
    category: 'Nagłośnienie',
    items: [
      'L-Acoustics KARA II / A15 (systemy liniowe)',
      'd&b audiotechnik Y-Series / V-Series',
      'JBL VTX A12 / V25',
      'Subwoofery SB28 / KS28',
      'Monitory sceniczne d&b M4 / Shure PSM1000',
    ],
  },
  {
    category: 'Oświetlenie',
    items: [
      'Robe BMFL Spot / WashBeam',
      'Clay Paky Sharpy Plus / Scenius',
      'Martin ERA 800 / MAC Quantum Profile',
      'ETC Source Four LED Series 3',
      'Astera Titan Tube / AX1 (bezprzewodowe LED)',
    ],
  },
  {
    category: 'Multimedia i wyświetlanie',
    items: [
      'Ściany LED P1.9 / P2.6 / P3.9 / P5.9',
      'Projektory laserowe Panasonic 20 000+ lm',
      'Serwery medialne Disguise / Resolume',
      'Splinery, matrice HDMI/SDI, konwertery',
      'Kamery PTZ i systemy IMAG',
    ],
  },
  {
    category: 'Scena i konstrukcje',
    items: [
      'Sceny mobilne Stageco / Prolyte',
      'Podesty sceniczne 1x1m / 2x1m',
      'Kratownice aluminiowe 290mm / 400mm',
      'Motory łańcuchowe CM Lodestar 0.5-2t',
      'Ground support do 12m wysokości',
    ],
  },
];

export default function TechStageCityEquipment({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.equipment_heading ||
    `Sprzęt, który dostarczamy ${prep} ${capitalize(cityCases.locative)}`;

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
          Własny park sprzętowy najwyższej klasy - dostarczamy kompletne rozwiązania techniczne
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
