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
    category: 'Stoły do gier',
    items: [
      'Ruletka europejska i amerykańska (pełnowymiarowa)',
      'Stoły do blackjacka (do 7 graczy)',
      'Stoły pokerowe turniejowe (do 10 graczy)',
      'Koło fortuny z personalizacją',
      'Stół do craps i kości',
      'Punto banco / baccarat',
    ],
  },
  {
    category: 'Wyposażenie kasynowe',
    items: [
      'Profesjonalne żetony clay (zestawy 500-5000 szt.)',
      'Karty plastikowe Copag / KEM',
      'Sukno kasynowe premium',
      'Shoe do kart i discard tray',
      'Kołowrotki i markery do ruletki',
      'Dealer button i timer pokerowy',
    ],
  },
  {
    category: 'Oprawa i dekoracje',
    items: [
      'Dekoracje w stylu Las Vegas / Monte Carlo',
      'Oświetlenie stołów LED',
      'Neony i lightboxy kasynowe',
      'Baner powitalne i branding',
      'Red carpet i słupki odgradzające',
      'Tło do zdjęć z rekwizytami',
    ],
  },
  {
    category: 'Obsługa i atrakcje',
    items: [
      'Profesjonalni krupierzy (2-15 osób)',
      'Hostessy z żetonami powitalnymi',
      'DJ z oprawą muzyczną lounge',
      'Fotobudka z rekwizytami kasynowymi',
      'Nagrody i trofea dla zwycięzców',
      'Banknoty zabawowe z logo firmy',
    ],
  },
];

export default function CasinoCityEquipment({ cityCases, content }: Props) {
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
          Kompletne wyposażenie kasyna rozrywkowego - dostarczamy wszystko na miejsce
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
