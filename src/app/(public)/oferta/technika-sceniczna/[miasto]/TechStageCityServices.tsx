import { Speaker, Lightbulb, Monitor, Wrench, Zap, Users } from 'lucide-react';
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
    icon: 'Speaker',
    title: 'Nagłośnienie eventowe i koncertowe',
    description:
      'Systemy liniowe L-Acoustics, d&b audiotechnik, JBL VTX. Realizacja FOH i monitorów scenicznych. Nagłośnienie konferencyjne, halowe i plenerowe od 50 do 50 000 osób.',
  },
  {
    icon: 'Lightbulb',
    title: 'Oświetlenie sceniczne',
    description:
      'Moving heady Robe, Clay Paky, Martin. Wash, spot, beam, blinder, LED bar, followspot. Konsolety grandMA2/MA3, Avolites. Projektowanie świateł i programowanie show.',
  },
  {
    icon: 'Monitor',
    title: 'Ekrany LED i multimedia',
    description:
      'Ściany LED P1.9-P5.9 indoor/outdoor. Projektory laserowe 20 000+ lm. Mapping 3D, content wideo, serwery Disguise i Resolume. Interaktywne instalacje.',
  },
  {
    icon: 'Wrench',
    title: 'Konstrukcje sceniczne i rigging',
    description:
      'Sceny mobilne, podesty Prolyte, ground support, konstrukcje aluminiowe. Rigging punktowy i liniowy do 2t/punkt. Certyfikowani riggerzy z uprawnieniami UDT.',
  },
  {
    icon: 'Zap',
    title: 'Zasilanie i infrastruktura',
    description:
      'Agregaty prądotwórcze 30-500 kVA, rozdzielnice siłowe, okablowanie. Infrastruktura sygnałowa: Dante, AES, optyka. Kompletne zaplecze techniczne eventu.',
  },
  {
    icon: 'Users',
    title: 'Kierownictwo techniczne',
    description:
      'Kierownik techniczny, operatorzy dźwięku i światła, stage managerowie. Koordynacja podwykonawców, rider management, nadzór BHP na scenie.',
  },
];

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Speaker,
  Lightbulb,
  Monitor,
  Wrench,
  Zap,
  Users,
};

export default function TechStageCityServices({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.services_heading ||
    `Usługi techniki scenicznej ${prep} ${capitalize(cityCases.locative)}`;

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
          Kompleksowa obsługa techniczna wydarzeń - od nagłośnienia po konstrukcje sceniczne
        </p>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service: any, idx: number) => {
            const IconComp = iconMap[service.icon] || Speaker;
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
