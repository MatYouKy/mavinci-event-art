import { Dice1, Users, Crown, CircleDot, Star, Sparkles } from 'lucide-react';
import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

const defaultServices = [
  {
    icon: 'Dice1',
    title: 'Ruletka',
    description:
      'Profesjonalne stoły do ruletki europejskiej i amerykańskiej z pełną oprawą. Autentyczne koła, żetony i doświadczeni krupierzy prowadzący grę.',
  },
  {
    icon: 'Crown',
    title: 'Blackjack',
    description:
      'Stoły do blackjacka z profesjonalnym suknem i wyposażeniem kasynowym. Krupierzy uczą zasad i prowadzą gry dla początkujących i zaawansowanych.',
  },
  {
    icon: 'Users',
    title: 'Poker Texas Hold\'em',
    description:
      'Turnieje pokerowe z profesjonalną organizacją. Stoły turniejowe, żetony clay, karty plastikowe, dealer button i doświadczeni dealerzy.',
  },
  {
    icon: 'CircleDot',
    title: 'Koło fortuny',
    description:
      'Spektakularne koło fortuny z nagrodami. Personalizowane segmenty, branding firmowy, oświetlenie sceniczne. Hit każdej imprezy integracyjnej.',
  },
  {
    icon: 'Star',
    title: 'Kości i gry stołowe',
    description:
      'Craps, Sic Bo, punto banco i inne gry stołowe. Profesjonalne stoły z obsługą krupierską. Nauka zasad w pakiecie.',
  },
  {
    icon: 'Sparkles',
    title: 'Eventy tematyczne Las Vegas',
    description:
      'Kompletna impreza w stylu Las Vegas: dekoracje, oświetlenie neonowe, hostessy, dress code, nagrody dla najlepszych graczy, oprawa muzyczna.',
  },
];

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Dice1,
  Crown,
  Users,
  CircleDot,
  Star,
  Sparkles,
};

export default function CasinoCityServices({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.services_heading ||
    `Gry kasynowe ${prep} ${capitalize(cityCases.locative)}`;

  const services =
    content?.services_json && Array.isArray(content.services_json) && content.services_json.length > 0
      ? content.services_json
      : defaultServices;

  return (
    <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-4 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          {heading}
        </h2>
        <p className="mx-auto mb-12 max-w-3xl text-center text-[#e5e4e2]/60">
          Profesjonalne stoły kasynowe z pełną obsługą krupierską na każdy event
        </p>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service: any, idx: number) => {
            const IconComp = iconMap[service.icon] || Dice1;
            return (
              <div
                key={idx}
                className="group rounded-xl border border-[#d3bb73]/10 bg-[#0f1119] p-6 transition-all duration-300 hover:border-[#d3bb73]/40 hover:shadow-lg hover:shadow-[#d3bb73]/5"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[#d3bb73]/10 transition-colors group-hover:bg-[#d3bb73]/20">
                  <IconComp className="h-6 w-6 text-[#d3bb73]" />
                </div>
                <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">{service.title}</h3>
                <p className="text-sm leading-relaxed text-[#e5e4e2]/70">{service.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
