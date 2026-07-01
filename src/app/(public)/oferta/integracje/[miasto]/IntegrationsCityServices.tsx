import { Users, Target, Compass, Puzzle, Lightbulb, Trophy } from 'lucide-react';
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
    icon: 'Compass',
    title: 'Gry terenowe i fabularne',
    description: 'Scenariusze z fabułą, zagadkami i zadaniami zespołowymi. Gry miejskie, podchody, questy przygodowe w plenerze.',
  },
  {
    icon: 'Target',
    title: 'Integracje outdoor',
    description: 'Survival light, biegi z przeszkodami, olimpiady firmowe. Aktywny team building na świeżym powietrzu.',
  },
  {
    icon: 'Puzzle',
    title: 'Integracje indoor',
    description: 'Mobilny escape room, zagadki logiczne, gry planszowe XXL, warsztaty kreatywne. Na każdą pogodę.',
  },
  {
    icon: 'Users',
    title: 'Wieczory firmowe z programem',
    description: 'Imprezy z animatorami, konkursami, quizami i atrakcjami integracyjnymi.',
  },
  {
    icon: 'Lightbulb',
    title: 'Integracje kreatywne',
    description: 'Video challenge, warsztaty bębniarskie, gotowanie team buildingowe. Twórcze zadania.',
  },
  {
    icon: 'Trophy',
    title: 'Duże integracje 100-500+',
    description: 'Koordynacja dużych grup, strefy aktywności, profesjonalne prowadzenie i logistyka.',
  },
];

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Users,
  Target,
  Compass,
  Puzzle,
  Lightbulb,
  Trophy,
};

export default function IntegrationsCityServices({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.services_heading ||
    `Rodzaje integracji firmowych ${prep} ${capitalize(cityCases.locative)}`;

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
          Wybierz format integracji lub pozwol nam zaproponowac idealny scenariusz dla Twojego zespolu
        </p>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service: any, idx: number) => {
            const IconComp = iconMap[service.icon] || Target;
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
